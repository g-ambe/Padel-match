"""No production credentials/connections; only additive migration release guards."""
import copy,importlib.util,os,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('home_court_release',Path(__file__).with_name('cloud_release.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class Guards(unittest.TestCase):
 def test_exact_sql_hash(self):self.assertEqual(r.hashlib.sha256(r.MIGRATION.read_bytes()).hexdigest(),r.SHA)
 def test_explicit_authority_before_connection(self):
  with patch.dict(os.environ,{},clear=True),patch.object(r,'authority') as check:
   with self.assertRaisesRegex(r.b.BackupError,'production_not_authorized'):r.apply()
   check.assert_not_called()
 def test_only_home_court_columns_and_trigger_are_additive(self):
  before=[{'sql':'catalog \'"public"."player_profile_private"\'','value':{'columns':[['avatar_key','text']], 'constraints':[], 'triggers':[], 'policies':['own'], 'acl':['SELECT']}},{'sql':'funcs','value':[{'name':'commit_profile_image','arguments':'uuid','definition':'old'}]}]
  after=copy.deepcopy(before);after[0]['value']['columns'] += [[k,'double precision'] for k in r.FIELDS];after[0]['value']['constraints'].extend([['profile_home_court_name_bounds'],['profile_home_court_version_bounds']]);after[0]['value']['triggers'].append(['profile_home_court_reset']);after[1]['value'].append({'name':'save_my_home_court','arguments':'uuid'});r.old_catalog_unchanged(before,after)
  for key in ['acl','policies']:
   invalid=copy.deepcopy(after);invalid[0]['value'][key].append('changed')
   with self.assertRaises(r.b.BackupError):r.old_catalog_unchanged(before,invalid)
  after[1]['value'][0]['definition']='changed'
  with self.assertRaises(r.b.BackupError):r.old_catalog_unchanged(before,after)
 def test_other_tables_cannot_gain_ignored_columns(self):
  before=[{'sql':'other table','value':{'columns':[], 'constraints':[], 'triggers':[]}}];after=copy.deepcopy(before);after[0]['value']['columns'].append(['home_court_name'])
  with self.assertRaises(r.b.BackupError):r.old_catalog_unchanged(before,after)
 def test_only_new_home_court_fields_and_0050_receipt_excluded_from_old_rows(self):
  rows=[{'schema':'public','name':'player_profile_private','rows':1,'sha256':'a'},{'schema':'public','name':'matches','rows':1,'sha256':'b'},{'schema':'supabase_migrations','name':'schema_migrations','rows':1,'sha256':'c'}]
  before=r.rows_guard(rows);after=r.rows_guard(rows,True)
  self.assertNotIn('ARRAY[',before);self.assertEqual(after.count('to_jsonb(t)-ARRAY['),1);self.assertEqual(after.count("t.version<>'0050'"),1);self.assertIn('home_court_version',r.MIGRATION.read_text());self.assertNotIn("'avatar_key'",after)
 def test_invalid_backup_fails_before_download(self):
  with patch.dict(os.environ,{'BACKUP_RUN_ID':'1'}),patch.object(r.b,'api',return_value={'conclusion':'failure'}):
   with self.assertRaisesRegex(r.b.BackupError,'actual_backup_restore_not_successful'):r.select_backup()
 def test_only_fixed_successful_backup_tool_head_attempt_and_PR_are_allowed(self):
  good={'conclusion':'success','head_sha':r.BACKUP_TOOL_SHA,'run_attempt':r.BACKUP_ATTEMPT,'path':'.github/workflows/cloud-db-backup.yml','head_repository':{'full_name':r.b.REPOSITORY},'event':'workflow_dispatch','head_branch':'main'}
  for changes in [{'head_sha':'a'*40},{'run_attempt':r.BACKUP_ATTEMPT+1},{'event':'pull_request'},{'conclusion':'failure'}]:
   with patch.dict(os.environ,{'BACKUP_RUN_ID':'44051227379'}),patch.object(r.b,'api',return_value={**good,**changes}):
    with self.assertRaisesRegex(r.b.BackupError,'actual_backup_restore_not_successful'):r.select_backup()
 def test_production_sql_has_no_R2_or_image_rewrite(self):
  sql=r.install();self.assertNotIn('DROP ',sql);self.assertNotIn('commit_secret_sha256',sql);self.assertNotIn('UPDATE public.profile_media_operations',sql)
if __name__=='__main__':unittest.main()
