"""Guard tests only; no production credentials or connections."""
import copy,importlib.util,os,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('release207',Path(__file__).with_name('cloud_release.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class ReleaseGuards(unittest.TestCase):
    def test_reviewed_sql_hash(self):
        self.assertEqual(r.hashlib.sha256(r.MIGRATION.read_bytes()).hexdigest(),r.SHA)
    def test_authority_before_any_production_connection(self):
        with patch.dict(os.environ,{},clear=True),patch.object(r,'authority') as check:
            with self.assertRaisesRegex(r.b.BackupError,'production_not_authorized'):r.apply()
            check.assert_not_called()
    def test_only_expected_rpc_and_triggers_are_additive(self):
        before=[{'sql':'table','value':{'rls':True,'triggers':[['old','old definition','O']],'acl':['SELECT']}},{'sql':'functions','value':[{'name':'score','arguments':'uuid','definition':'old'}]}]
        after=copy.deepcopy(before)
        after[0]['value']['triggers'].append(['profile_media_detach','new','O'])
        after[1]['value'].append({'name':'prepare_profile_image','arguments':'uuid'})
        r.old_catalog_unchanged(before,after)
        after[0]['value']['acl'].append('UPDATE')
        with self.assertRaises(r.b.BackupError):r.old_catalog_unchanged(before,after)
    def test_existing_functions_cannot_change(self):
        before=[{'sql':'functions','value':[{'name':'score','arguments':'uuid','definition':'old'}]}]
        after=copy.deepcopy(before);after[0]['value'][0]['definition']='changed'
        with self.assertRaises(r.b.BackupError):r.old_catalog_unchanged(before,after)
    def test_only_0048_history_row_is_excluded(self):
        rows=[{'schema':'supabase_migrations','name':'schema_migrations','rows':2,'sha256':'a'},{'schema':'public','name':'matches','rows':3,'sha256':'b'}]
        self.assertNotIn("t.version<>'0048'",r.rows_guard(rows))
        self.assertEqual(r.rows_guard(rows,True).count("t.version<>'0048'"),1)
    def test_failed_or_unrestored_backup_is_rejected(self):
        with patch.dict(os.environ,{'BACKUP_RUN_ID':'1'}),patch.object(r.b,'api',return_value={'conclusion':'failure'}):
            with self.assertRaisesRegex(r.b.BackupError,'actual_backup_restore_not_successful'):r.select_backup()
    def test_secret_value_not_embedded_in_install_sql(self):
        self.assertIn(r.SECRET_SHA,r.install())
        self.assertIn('decode(',r.install())
        self.assertNotIn('DROP ',r.install())

if __name__=='__main__':unittest.main()
