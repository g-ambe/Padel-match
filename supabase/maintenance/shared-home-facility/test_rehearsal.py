import copy, importlib.util, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('facility212_rehearsal',Path(__file__).with_name('cloud_rehearsal.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class Guards(unittest.TestCase):
 def test_reviewed_csv_24_decisions_9_sql_exact(self):
  self.assertEqual(len(r.d.reviewed_rows()),9);self.assertEqual(r.d.MIGRATION.read_text(),r.d.sql())
  for version,name,sha in r.MIGRATIONS:self.assertEqual(r.hashlib.sha256(r.migration(version,name).read_bytes()).hexdigest(),sha)
  decisions=r.json.loads(r.d.DECISIONS.read_text());self.assertEqual(sum(d['decision']=='hold' for d in decisions),15)
 def test_no_production_apply_entrypoint(self):
  self.assertFalse(hasattr(r,'apply'));self.assertNotIn('readonly=False',Path(r.__file__).read_text())
  with self.assertRaises(r.b.BackupError):r.rollback_isolated(object(),{},[])
 def test_reject_backup_failure(self):
  with patch.dict(r.os.environ,{'BACKUP_RUN_ID':'1'}),patch.object(r.b,'api',return_value={'conclusion':'failure'}):
   with self.assertRaises(r.b.BackupError):r.select_backup()
 def test_protected_rows_ignore_only_new_field_and_receipts(self):
  rows=[{'schema':'public','name':name,'rows':1,'sha256':'a'} for name in ['player_profile_private','clubs','matches','padel_facilities']]+[{'schema':'supabase_migrations','name':'schema_migrations','rows':1,'sha256':'a'}]
  old=r.rows_guard(rows);new=r.rows_guard(rows,True)
  self.assertIn('padel_facilities',old);self.assertNotIn('padel_facilities',new);self.assertIn("to_jsonb(t)-'home_facility_id'",new);self.assertNotIn("-'home_court_name'",new);self.assertIn('"public"."matches"',new);self.assertIn("NOT IN('0051','0052')",new)
 def test_catalog_changes_outside_exact_additions_fail(self):
  base={'tables':[{'schema':'public','name':'padel_facilities','definition':{'columns':[['name','text']], 'constraints':[], 'indexes':[], 'acl':['SELECT'],'policies':['read']}},{'schema':'public','name':'clubs','definition':{'columns':[['main_facility_id','uuid']], 'constraints':['FK'],'indexes':[],'acl':['old']}}],'functions':[{'schema':'public','definitions':[{'name':'save_my_home_court','arguments':'p_profile uuid, p_expected bigint, p_name text, p_ticket uuid','definition':'old','owner':'postgres','acl':['authenticated']},{'name':'other','arguments':'','definition':'unchanged'}]}],'schemas':[]}
  after=copy.deepcopy(base);after['tables'][0]['definition']['columns'] += [[f,'text'] for f in r.MASTER_FIELDS];after['functions'][0]['definitions'][0]['definition']='reviewed new';after['functions'][0]['definitions'].append({'name':'save_my_home_court_selection','arguments':r.NEW_ARGUMENTS,'definition':'new'})
  r.catalog_unchanged(base,after)
  for table,key in [(0,'acl'),(0,'policies'),(1,'acl')]:
   bad=copy.deepcopy(after);bad['tables'][table]['definition'][key].append('bad')
   with self.assertRaises(r.b.BackupError):r.catalog_unchanged(base,bad)
  for key in ['owner','arguments','acl']:
   bad=copy.deepcopy(after);bad['functions'][0]['definitions'][0][key]='bad'
   with self.assertRaises(r.b.BackupError):r.catalog_unchanged(base,bad)
  bad=copy.deepcopy(after);bad['functions'][0]['definitions'][1]['definition']='changed'
  with self.assertRaises(r.b.BackupError):r.catalog_unchanged(base,bad)
 def test_expected_facilities_keep_ids_legacy_fields_and_unlisted_row(self):
  rows=[{'id':str(i),'name':d['old_name'],'prefecture':d['old_prefecture'],'address':None,'source_url':'https://www.japanpadel.com/','created_at':'original'} for i,d in enumerate(r.d.reviewed_rows())]
  rows.append({'id':'extra','name':'協会未掲載','prefecture':'沖縄','address':None,'source_url':None,'created_at':'old'})
  result=r.expected_facilities(rows);self.assertEqual([x['id'] for x in result],[x['id'] for x in rows]);self.assertTrue(all(x['availability']=='unverified' and x['verified_on'] is None for x in result));self.assertEqual(result[-1]['name'],'協会未掲載');self.assertEqual(result[-1]['created_at'],'old')
  rows[0]['address']='unexpected'
  with self.assertRaises(r.b.BackupError):r.expected_facilities(rows)

if __name__=='__main__':unittest.main()
