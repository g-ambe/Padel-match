import importlib.util
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('approved_repair',Path(__file__).with_name('release_approved.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)


class ApprovedReleaseGuards(unittest.TestCase):
    def test_exact_approved_scope_and_sql_are_pinned(self):
        value=a.approval()
        self.assertEqual(value['plan_sha256'],a.PLAN)
        self.assertEqual(value['removed_rows'],122)
        value['removed_rows']=123
        with patch.object(a.lineup,'require_score_repair_approval'),patch.object(a.json,'loads',return_value=value),self.assertRaises(a.b.BackupError):a.approval()

    def test_changed_plan_counts_conflicts_and_references_fail_closed(self):
        audit={'totals':{'matches':91,'rows':213,'extra_rows':122,'conflicting':0},'repair_plan_sha256':a.PLAN,'incoming_foreign_keys':[],'null_match_rows':0,'orphan_rows':0}
        plan={'sha256':a.PLAN}
        a.scope(audit,plan)
        for field in ('matches','rows','extra_rows','conflicting'):
            other=json.loads(json.dumps(audit));other['totals'][field]+=1
            with self.assertRaises(a.b.BackupError):a.scope(other,plan)
        with self.assertRaises(a.b.BackupError):a.scope(audit,{'sha256':'a'*64})
        for field in ('incoming_foreign_keys','null_match_rows','orphan_rows'):
            other=dict(audit);other[field]=1
            with self.assertRaises(a.b.BackupError):a.scope(other,plan)

    def test_restore_refuses_production_connection_before_unpack(self):
        with patch.object(a,'identity'),patch.dict(os.environ,{'SUPABASE_DB_URL':'forbidden'}),patch.object(a.b,'unpack') as unpack,self.assertRaises(a.b.BackupError):
            a.rehearse()
        unpack.assert_not_called()

    def test_apply_refuses_missing_restore_proof_before_any_db_access(self):
        manifest={'approved_repair':{}}
        ctx={'main_before_sha':'a'*40,'source_sha':'b'*40,'sql_sha256':{}}
        with patch.object(a,'identity',return_value='a'*40),patch.object(a.b,'workdir'),patch.object(a.b,'unpack',return_value=(None,manifest)),patch.object(a,'context',return_value=ctx),patch.object(a.b,'api',return_value={'draft':True,'body':'未完了'}),patch.dict(os.environ,{'BACKUP_RELEASE_ID':'1','BACKUP_SHA256':'c'*64}),patch.object(a.common,'source_sql') as sql,self.assertRaises(a.b.BackupError):a.apply()
        sql.assert_not_called()

    def test_unsupported_branch_protection_never_bypassed(self):
        pr={'draft':True,'mergeable':True}
        with patch.object(a,'approval'),patch.dict(os.environ,{'PADEL_APPROVED_REPAIR':a.PLAN}),patch.object(a.lineup,'identity',return_value='a'*40),patch.object(a.b,'api',side_effect=[pr,[{'type':'required_status_checks'}]]),self.assertRaises(a.b.BackupError):a.identity()


    def test_independent_restore_gets_github_token_but_never_db_connection(self):
        text=(a.ROOT/'.github/workflows/approved-score-repair.yml').read_text()
        step=text.split('- name: 本番接続を渡さず隔離復元・0041・0042・03を試験')[1].split('\n  apply:')[0]
        self.assertIn('GH_TOKEN: ${{ github.token }}',step)
        self.assertNotIn('SUPABASE_DB_URL',step)


if __name__=='__main__':unittest.main()
