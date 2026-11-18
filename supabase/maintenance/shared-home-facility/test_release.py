import importlib.util, os, tempfile, unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('facility212_release',Path(__file__).with_name('cloud_release.py'))
s=importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

def proof():
 p={'head':'head','main':s.r.MAIN,'migrations':[list(x) for x in s.r.MIGRATIONS],'backup':'backup','production_mutations':False,'existing_ids_and_rows_preserved':True,'held_new_facilities':15,'manifest':{'captured_at':datetime.now(timezone.utc).isoformat(),'tables':[{'schema':'public','name':'clubs'},{'schema':'supabase_migrations','name':'schema_migrations'}]},'before':[],'after':[],'rows':[],'expected_facilities':[],'atomic_apply_rehearsed':True}
 p['atomic_sql_sha256']=s.hashlib.sha256(s.apply_sql(p).encode()).hexdigest()
 return p

class Guards(unittest.TestCase):
 def test_atomic_rehearsal_preserves_exclusive_original_receipt_and_creates_new_receipt(self):
  p=proof();p.update(isolation_container='padel-backup-test-fixture',before_catalog={},original_facilities=[]);p.pop('atomic_apply_rehearsed');p.pop('atomic_sql_sha256')
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);s.b.json_file(root/'212-rehearsal-proof.json',p);original=(root/'212-rehearsal-proof.json').read_bytes()
   with patch.dict(os.environ,{'BACKUP_SOURCE_SHA':'head','BACKUP_SHA256':'backup'}),patch.object(s.r,'authority'),patch.object(s.r,'select_backup'),patch.object(s.r,'rollback_isolated'),patch.object(s.b,'workdir',return_value=root),patch.object(s.b,'LocalRestore') as target,patch('builtins.print'):
    s.rehearse_apply();self.assertEqual(target.return_value.sql.call_count,3)
    result=s.json.loads((root/'212-atomic-proof.json').read_text());s.check_proof(result)
   self.assertEqual((root/'212-rehearsal-proof.json').read_bytes(),original)
 def test_authorization_before_any_connection(self):
  with patch.dict(os.environ,{},clear=True),patch.object(s.r,'authority') as called:
   with self.assertRaisesRegex(s.b.BackupError,'not_authorized'):s.apply()
   called.assert_not_called()
 def test_same_head_backup_migrations_and_recent_real_rehearsal_required(self):
  with patch.dict(os.environ,{'BACKUP_SOURCE_SHA':'head','BACKUP_SHA256':'backup'}):
   s.check_proof(proof())
   for k,v in [('head','other'),('main','other'),('migrations',[]),('backup','old'),('production_mutations',True),('existing_ids_and_rows_preserved',False),('held_new_facilities',0),('atomic_apply_rehearsed',False),('atomic_sql_sha256','changed')]:
    p=proof();p[k]=v
    with self.assertRaises(s.b.BackupError):s.check_proof(p)
   p=proof();p['manifest']['captured_at']=(datetime.now(timezone.utc)-timedelta(hours=5)).isoformat()
   with self.assertRaisesRegex(s.b.BackupError,'not_recent'):s.check_proof(p)
 def test_atomic_sql_locks_expected_tables_and_only_installs_approved_migrations(self):
  sql=s.apply_sql(proof());self.assertTrue(sql.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ;'));self.assertTrue(sql.endswith('COMMIT;'));self.assertIn('SHARE ROW EXCLUSIVE MODE',sql);self.assertIn("lock_timeout='5s'",sql);self.assertIn('212005152',sql)
  self.assertNotIn('DROP ',sql);self.assertNotIn('INSERT INTO public.padel_facilities',sql);self.assertNotIn('UPDATE public.clubs',sql);self.assertIn('212_migration_receipt_changed',sql)
  for version,name,_ in s.r.MIGRATIONS:self.assertIn(name,sql);self.assertIn(version,sql)
 def test_failed_postcheck_never_rolls_back_or_reapplies_production(self):
  p=proof();calls=[]
  def source(sql,**kwargs):
   calls.append(kwargs)
   if len(calls)==2:raise s.b.BackupError('postcheck_failed')
  with patch.object(s,'authority'),patch.object(s.r,'select_backup'),patch.object(s,'check_proof'),patch.object(s,'apply_sql',return_value='APPLY'),patch.object(s,'postconditions',return_value='VERIFY'),patch.object(s.b,'workdir',return_value=Path('/unused')),patch.object(Path,'read_text',return_value=s.json.dumps(p)),patch.object(s.c,'source_sql',side_effect=source):
   with self.assertRaisesRegex(s.b.BackupError,'postcheck_failed'):s.apply()
  self.assertEqual(len(calls),2);self.assertEqual(sum(c.get('readonly') is False for c in calls),1)

if __name__=='__main__':unittest.main()
