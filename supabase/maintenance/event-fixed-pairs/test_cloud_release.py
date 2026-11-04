"""承認・ハッシュ・バックアップ・原子的な適用範囲の回帰試験。"""

import os
import unittest
from unittest.mock import patch

import cloud_backup as b
import cloud_release as release


class ReleaseTests(unittest.TestCase):
    def test_unapproved_operation_never_opens_production_connection(self):
        with patch.dict(os.environ, {'PADEL_RELEASE_AUTHORIZED': ''}), patch.object(release, 'source_sql') as sql:
            with self.assertRaises(b.BackupError):
                release.prepare()
            sql.assert_not_called()

    def test_only_reviewed_migration_bytes_are_accepted(self):
        with patch.dict(os.environ, {'PADEL_RELEASE_AUTHORIZED': 'PR176-0040-20261105'}):
            release.authority()
            with patch.object(release.MIGRATION.__class__, 'read_bytes', return_value=b'changed SQL'):
                with self.assertRaises(b.BackupError):
                    release.authority()

    def test_backup_names_are_unique_per_run_and_attempt(self):
        with patch.dict(os.environ, {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2'}):
            self.assertEqual(release.schema_name(), 'event_fixed_pair_backup_r123_a2')
        with patch.dict(os.environ, {'GITHUB_RUN_ID': '123;DROP', 'GITHUB_RUN_ATTEMPT': '2'}):
            with self.assertRaises(b.BackupError):
                release.schema_name()

    def test_migration_and_guards_share_one_transaction(self):
        manifest = {'tables': [{'schema': 'public', 'name': 'events'}], 'release': {'backup_schema': 'event_fixed_pair_backup_r123_a1'}}
        rows = [{'schema': 'public', 'name': 'events', 'rows': 0, 'sha256': 'a' * 64}]
        sql = release.application_sql(manifest, rows)
        self.assertTrue(sql.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ;'))
        self.assertTrue(sql.endswith('COMMIT;'))
        self.assertEqual(sql.count('COMMIT;'), 1)
        self.assertLess(sql.index('LOCK TABLE'), sql.index('DO $row_guard$'))
        self.assertLess(sql.index('DO $row_guard$'), sql.index('create schema fixed_pair_private'))
        self.assertLess(sql.index('DO $unchanged$'), sql.index('COMMIT;'))

    def test_transaction_boundaries_are_removed_only_from_temporary_copy(self):
        original = release.MIGRATION.read_bytes()
        self.assertNotIn('\ncommit;', release.body(release.MIGRATION))
        self.assertEqual(release.MIGRATION.read_bytes(), original)

    def test_scope_requires_same_commit_and_expected_backup(self):
        manifest = {'release': {'migration_sha256': release.MIGRATION_SHA, 'backup_schema': 'event_fixed_pair_backup_r123_a1', 'source_sha': 'a' * 40}}
        with patch.dict(os.environ, {'PADEL_RELEASE_AUTHORIZED': 'PR176-0040-20261105', 'BACKUP_SOURCE_SHA': 'b' * 40}):
            with self.assertRaises(b.BackupError):
                release.context_check(manifest)


if __name__ == '__main__':
    unittest.main()
