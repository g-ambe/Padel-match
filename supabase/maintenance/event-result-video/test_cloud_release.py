"""0047の適用ガードのみ。接続情報・ネットワーク・実データは使用しない。"""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release202', Path(__file__).with_name('cloud_release.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class ReleaseGuards(unittest.TestCase):
    def test_reviewed_sql_hash(self):
        self.assertEqual(r.hashlib.sha256(r.MIGRATION.read_bytes()).hexdigest(), r.SHA)

    def test_authorization_required_before_connection(self):
        with patch.dict(r.os.environ, {}, clear=True), patch.object(r, 'authority') as check:
            with self.assertRaisesRegex(r.b.BackupError, 'production_not_authorized'):
                r.apply()
            check.assert_not_called()

    def test_only_new_rpc_can_be_added(self):
        before = [{'sql': 'functions', 'value': [{'name': 'score', 'arguments': 'uuid', 'definition': 'old'}]}]
        after = copy.deepcopy(before)
        after[0]['value'].append({'name': r.RPC, 'arguments': 'uuid,uuid,text,text'})
        r.old_catalog_unchanged(before, after)
        after[0]['value'][0]['definition'] = 'changed'
        with self.assertRaises(r.b.BackupError):
            r.old_catalog_unchanged(before, after)

    def test_table_grants_and_rls_must_match(self):
        before = [{'sql': 'table', 'value': {'rls': True, 'acl': ['SELECT']}}]
        after = copy.deepcopy(before)
        after[0]['value']['acl'].append('UPDATE')
        with self.assertRaises(r.b.BackupError):
            r.old_catalog_unchanged(before, after)

    def test_only_intentional_history_receipt_is_excluded(self):
        rows = [{'schema': 'supabase_migrations', 'name': 'schema_migrations', 'rows': 2, 'sha256': 'a'},
                {'schema': 'public', 'name': 'matches', 'rows': 3, 'sha256': 'b'}]
        self.assertNotIn("t.version<>'0047'", r.rows_guard(rows))
        self.assertEqual(r.rows_guard(rows, True).count("t.version<>'0047'"), 1)
        self.assertNotIn('CREATE TABLE', r.history_insert(False))

    def test_unrestored_backup_is_rejected(self):
        run = {'conclusion': 'failure', 'head_sha': r.MAIN, 'run_attempt': 1,
               'path': '.github/workflows/cloud-db-backup.yml'}
        with patch.dict(r.os.environ, {'BACKUP_RUN_ID': '43419491756'}), patch.object(r.b, 'api', return_value=run):
            with self.assertRaisesRegex(r.b.BackupError, 'actual_backup_restore_not_successful'):
                r.select_backup()


if __name__ == '__main__':
    unittest.main()
