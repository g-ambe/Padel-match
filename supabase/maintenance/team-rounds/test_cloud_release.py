"""0045専用リリースガード。ネットワーク・本番接続は使用しない。"""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('release191',Path(__file__).with_name('cloud_release.py'))
r=importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class ReleaseGuards(unittest.TestCase):
    def test_reviewed_migration_is_pinned(self):
        self.assertEqual(r.hashlib.sha256(r.MIGRATION.read_bytes()).hexdigest(),r.MIGRATION_SHA)

    def test_new_columns_only_removed_from_team_cards(self):
        self.assertIn('to_jsonb(t)-ARRAY[',r.expression('"public"."event_team_matches"'))
        self.assertNotIn('-ARRAY[',r.expression('"public"."matches"'))
        self.assertNotIn('-ARRAY[',r.expression('"public"."rounds"'))

    def test_existing_grants_cannot_change(self):
        before=[{'sql':'SELECT existing_table','value':{'acl':[['authenticated','SELECT']]}}]
        after=copy.deepcopy(before);after[0]['value']['acl'].append(['anon','UPDATE'])
        with self.assertRaises(r.b.BackupError):r.old_catalog_unchanged(before,after)

    def test_existing_function_cannot_change(self):
        before=[{'sql':'SELECT existing_functions','value':[{'name':'score_rpc','arguments':'uuid','definition':'original'}]}]
        after=copy.deepcopy(before);after[0]['value'][0]['definition']='changed'
        with self.assertRaises(r.b.BackupError):r.old_catalog_unchanged(before,after)

    def test_apply_requires_explicit_authorized_job(self):
        with patch.dict(r.os.environ,{},clear=True):
            with self.assertRaisesRegex(r.b.BackupError,'production_not_authorized'):r.apply()

if __name__=='__main__':unittest.main()
