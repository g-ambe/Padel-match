"""バックアップの暗号化・公開防止・処理順を合成データだけで確認する。"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cloud_backup as backup


class BackupTests(unittest.TestCase):
    def test_missing_or_short_key_stops_before_production_access(self):
        for key in ("", "short-example", "x" * 32, "x" * 32 + "\n"):
            with patch.dict(os.environ, {"PADEL_BACKUP_PASSPHRASE": key}), patch.object(backup, "Snapshot") as snapshot:
                with self.assertRaises(backup.BackupError):
                    backup.create()
                snapshot.assert_not_called()

    def test_client_errors_never_include_credentials_or_sql(self):
        response = subprocess.CompletedProcess([], 1, b"", b"ERROR: 42501\nprivate-database-url-and-password")
        with patch.object(backup.subprocess, "run", return_value=response):
            with self.assertRaises(backup.BackupError) as caught:
                backup.run(["synthetic-client"], phase="test_failed")
        self.assertEqual(str(caught.exception), "test_failed/42501")

    def test_restore_refuses_nonisolated_container_names(self):
        with self.assertRaises(backup.BackupError):
            backup.LocalRestore("production-database")

    def test_source_sql_imports_snapshot_inside_readonly_transaction(self):
        snapshot = backup.Snapshot(["synthetic-client"], {})
        snapshot.info = {"snapshot": "00000001-00000002-1"}
        with patch.object(backup, "run", return_value=b'{"ok":true}') as runner:
            self.assertEqual(snapshot.query("SELECT json_build_object('ok',true)"), {"ok": True})
        sql = runner.call_args.kwargs["data"].decode()
        self.assertIn("REPEATABLE READ READ ONLY", sql)
        self.assertIn("SET TRANSACTION SNAPSHOT '00000001-00000002-1'", sql)
        self.assertTrue(sql.endswith("ROLLBACK;"))

    def test_production_client_default_is_readonly_before_any_dump(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "files"
            key = "test-only-random-passphrase-0123456789-ABCDEF"
            with patch.dict(os.environ, {"PADEL_BACKUP_PASSPHRASE": key}), patch.object(backup, "workdir", return_value=root), patch.object(backup.probe, "custom_ca_file", return_value="/synthetic/ca.crt"), patch.object(backup.probe, "connection_environment", return_value={}), patch.object(backup, "collect", return_value={}), patch.object(backup, "seal", return_value={}), patch.object(backup, "Snapshot") as snapshot:
                backup.create()
        self.assertEqual(snapshot.call_args.args[1]["PGOPTIONS"], "-c default_transaction_read_only=on")
        self.assertIn("PGOPTIONS", snapshot.call_args.args[0])

    def test_dump_wrappers_store_no_password_and_use_same_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "bin"
            snapshot = backup.Snapshot(["synthetic-client", "--env", "PGPASSWORD"], {"PGPASSWORD": "must-not-be-written"})
            snapshot.info = {"snapshot": "00000001-00000002-1"}
            snapshot.wrappers(root)
            text = (root / "pg_dump").read_text()
            self.assertIn("--snapshot=00000001-00000002-1", text)
            self.assertNotIn("must-not-be-written", text)

    def test_draft_release_is_never_published_by_verification(self):
        release = {"draft": True, "body": "復元確認：未完了\n\n合成データ"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "verification.json").write_text('{"restore_verified":true}')
            with patch.object(backup, "workdir", return_value=root), patch.dict(os.environ, {"BACKUP_RELEASE_ID": "1", "GITHUB_RUN_ID": "2"}), patch.object(backup, "api", side_effect=[release, {}]) as api:
                self.assertTrue(backup.mark()["restore_verified"])
                self.assertIs(api.call_args.args[2]["draft"], True)
        with patch.dict(os.environ, {"BACKUP_RELEASE_ID": "1"}), patch.object(backup, "workdir", return_value=Path("/tmp/synthetic")), patch.object(backup, "api", return_value={"draft": False}):
            with self.assertRaises(backup.BackupError):
                backup.mark()

    def test_sensitive_values_are_not_inherited_by_clients(self):
        with patch.dict(os.environ, {"SUPABASE_DB_URL": "private-uri", "PADEL_BACKUP_PASSPHRASE": "private-key", "GH_TOKEN": "private-token", "PGPASSWORD": "private-password"}):
            env = backup.clean_env()
        for name in ("SUPABASE_DB_URL", "PADEL_BACKUP_PASSPHRASE", "GH_TOKEN", "PGPASSWORD"):
            self.assertNotIn(name, env)


if __name__ == "__main__":
    unittest.main()
