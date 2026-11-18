"""Read-only transport guards. No real database or credentials are used."""
import contextlib,importlib.util,io,json,os,pathlib,tempfile,types,unittest
from unittest.mock import patch
path=pathlib.Path(__file__).with_name('read_catalog.py')
spec=importlib.util.spec_from_file_location('task08_read_catalog',path)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ReadCatalogTests(unittest.TestCase):
 def execute(self,result,ca=True):
  with tempfile.TemporaryDirectory() as directory:
   target=pathlib.Path(directory)/'catalog.json';out=io.StringIO();err=io.StringIO()
   with patch.dict(os.environ,{'TASK08_CATALOG_OUTPUT':str(target)}),patch.object(m,'connection_environment',return_value={'PGSSLMODE':'verify-full'}),patch.object(m,'custom_ca_file',return_value=pathlib.Path('/safe-ca.crt') if ca else None),patch.object(m,'command',return_value=['synthetic-client']),patch.object(m.subprocess,'run',return_value=result) as run,contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
    status=m.main()
   return status,json.loads(target.read_text()) if target.exists() else None,out.getvalue()+err.getvalue(),run.call_args
 def test_catalog_is_only_read_only_metadata(self):
  sql=path.with_name('01_preflight.sql').read_text().lower()
  self.assertIn('begin read only;',sql);self.assertTrue(sql.rstrip().endswith('rollback;'))
  self.assertNotIn('from public.',sql)
  for word in ('insert into','update public.','delete from','alter table','grant ','revoke ','create function'):
   self.assertNotIn(word,sql)
 def test_no_ca_means_no_query(self):
  status,data,log,call=self.execute(None,False)
  self.assertEqual(status,1);self.assertIsNone(data);self.assertIsNone(call)
 def test_client_error_is_not_logged(self):
  status,data,log,_=self.execute(types.SimpleNamespace(returncode=1,stderr='synthetic-password',stdout=''))
  self.assertEqual(status,1);self.assertIsNone(data);self.assertNotIn('synthetic-password',log)
 def test_writable_transaction_is_rejected(self):
  status,data,_,_=self.execute(types.SimpleNamespace(returncode=0,stdout=json.dumps({'read_only':'off'})))
  self.assertEqual(status,1);self.assertIsNone(data)
 def test_definitions_are_hashed_and_metadata_is_not_logged(self):
  status,data,log,call=self.execute(types.SimpleNamespace(returncode=0,stdout=json.dumps({'read_only':'on','functions':[{'name':'fixture','definition':'sensitive-definition'}]})))
  self.assertEqual(status,0);self.assertNotIn('definition',data['functions'][0]);self.assertEqual(len(data['functions'][0]['definition_sha256']),64)
  self.assertNotIn('sensitive-definition',log);self.assertNotIn('definition_sha256',log)
  self.assertEqual(call.kwargs['env']['PGSSLMODE'],'verify-full')
if __name__=='__main__':unittest.main()
