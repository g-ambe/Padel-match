import importlib.util
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('score_repair_rehearse',Path(__file__).with_name('rehearse.py'))
r=importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

class ReviewGuards(unittest.TestCase):
    def test_production_repair_entry_does_not_exist(self):
        for action in ('apply','repair','enable','merge'):
            with patch('sys.argv',['rehearse.py',action]), patch.object(r,'rehearse') as call, patch('builtins.print'):
                self.assertEqual(r.main(),1)
                call.assert_not_called()

    def test_exact_backup_and_draft_are_required(self):
        env={'PADEL_REPAIR_REVIEW':'PR182-APPROVAL-PENDING','BACKUP_RELEASE_ID':str(r.BACKUP_RELEASE),'BACKUP_ASSET_ID':str(r.BACKUP_ASSET),'BACKUP_SHA256':r.BACKUP_SHA,'BACKUP_SOURCE_SHA':'a'*40}
        pr={'draft':True,'state':'open','head':{'sha':'a'*40,'ref':'codex/atomic-round-lineup','repo':{'full_name':r.b.REPOSITORY}}}
        with patch.dict(os.environ,env),patch.object(r.b,'api',return_value=pr):r.authority()
        pr['draft']=False
        with patch.dict(os.environ,env),patch.object(r.b,'api',return_value=pr),self.assertRaises(r.b.BackupError):r.authority()
        with patch.dict(os.environ,dict(env,BACKUP_SHA256='b'*64)),self.assertRaises(r.b.BackupError):r.authority()

    def test_prod_credentials_are_refused_in_restore(self):
        with patch.object(r,'authority'),patch.dict(os.environ,{'SUPABASE_DB_URL':'not-a-real-connection'}),self.assertRaises(r.b.BackupError):r.rehearse()

    def test_approved_input_is_sql_quoted_and_missing_marker_fails(self):
        plan={'plan':[{'text':"a'b"}],'sha256':'a'*64}
        text=r.render('02_repair_reviewed.sql','00000000-0000-0000-0000-000000000001',plan)
        self.assertIn("a''b",text)
        self.assertNotIn('-- REVIEWED_INPUT',text)

if __name__=='__main__':unittest.main()
