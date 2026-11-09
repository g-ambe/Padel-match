import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('attendance_release', Path(__file__).with_name('cloud_release.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class ReleaseGuards(unittest.TestCase):
    def test_default_alignment_is_isolated_and_rejects_unknown_grants(self):
        with self.assertRaisesRegex(r.b.BackupError, 'requires_isolated'):
            r.align_isolated_defaults(object())
        target = r.b.LocalRestore.__new__(r.b.LocalRestore)
        target.query = lambda _: [{'owner':'supabase_admin','schema':'supabase_functions','kind':'r','acl':[]}]
        target.sql = lambda _: self.fail('未知の初期権限は変更しない')
        with self.assertRaisesRegex(r.b.BackupError, 'bootstrap_defaults_changed'):
            r.align_isolated_defaults(target)

    def test_default_alignment_keeps_application_defaults(self):
        original = {'owner':'postgres','schema':'public','kind':'r','acl':[['service_role','postgres','SELECT',False]]}
        values = [original] + [{'owner':'supabase_admin','schema':'supabase_functions','kind':kind,
            'acl':[[role,'supabase_admin',privilege,False] for role in ('anon','authenticated','postgres','service_role') for privilege in rights]}
            for kind,rights in [('S',['SELECT','UPDATE','USAGE']),('f',['EXECUTE']),('r',['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'])]]
        target = r.b.LocalRestore.__new__(r.b.LocalRestore)
        target.query = lambda _: values
        commands = []
        def execute(sql):
            commands.append(sql)
            if len(commands)==3:
                values[:]=[original]
        target.sql = execute
        r.align_isolated_defaults(target)
        self.assertEqual(values,[original])
        self.assertEqual(len(commands),3)
        self.assertTrue(all('REVOKE ALL ON' in c and 'IN SCHEMA supabase_functions' in c for c in commands))

    def test_reviewed_migration_is_pinned(self):
        self.assertEqual(r.hashlib.sha256(r.MIGRATION.read_bytes()).hexdigest(), r.MIGRATION_SHA)
        with patch.dict(r.os.environ, {'BACKUP_SHA256': 'changed'}):
            with self.assertRaisesRegex(r.b.BackupError, 'backup_changed'):
                r.authority()

    def test_catalog_changes_fail_closed(self):
        before = [{'sql': 'table', 'value': {'triggers': [], 'policies': ['existing'], 'acl': ['read']}}]
        after = copy.deepcopy(before)
        after[0]['value']['triggers'].append(['guard_team_lineup_attendance', 'reviewed', 'O'])
        r.check_existing_catalog(before, after)
        after[0]['value']['policies'] = ['relaxed']
        with self.assertRaisesRegex(r.b.BackupError, 'existing_security'):
            r.check_existing_catalog(before, after)

    def test_production_requires_separate_explicit_gate(self):
        with patch.dict(r.os.environ, {'PADEL_RELEASE_AUTHORIZED': ''}):
            with self.assertRaisesRegex(r.b.BackupError, 'not_authorized'):
                r.apply()

    def test_catalog_guard_raises_before_ddl(self):
        sql = r.catalog_guard([{'sql': "SELECT json_build_object('x',true)", 'value': {'x': True}}])
        self.assertIn("ERRCODE='40001'", sql)
        self.assertNotIn('DROP ', sql)
        self.assertNotIn('DELETE ', sql)


if __name__ == '__main__':
    unittest.main()
