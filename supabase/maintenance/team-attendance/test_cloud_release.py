import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('attendance_release', Path(__file__).with_name('cloud_release.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class ReleaseGuards(unittest.TestCase):
    def test_reviewed_migration_is_pinned(self):
        self.assertEqual(r.hashlib.sha256(r.MIGRATION.read_bytes()).hexdigest(), r.MIGRATION_SHA)
        with patch.dict(r.os.environ, {'BACKUP_SHA256': 'changed'}):
            with self.assertRaisesRegex(r.b.BackupError, 'backup_changed'):
                r.authority()

    def test_catalog_changes_fail_closed(self):
        before = [{'sql': 'table', 'value': {'triggers': [], 'policies': ['existing'], 'acl': ['read']}}]
        after = copy.deepcopy(before)
        after[0]['value']['triggers'].append(['guard_team_lineup_attendance', 'reviewed', 'O'])
        r.check_existing_catalog(before, after)
        after[0]['value']['policies'] = ['relaxed']
        with self.assertRaisesRegex(r.b.BackupError, 'existing_security'):
            r.check_existing_catalog(before, after)

    def test_production_requires_separate_explicit_gate(self):
        with patch.dict(r.os.environ, {'PADEL_RELEASE_AUTHORIZED': ''}):
            with self.assertRaisesRegex(r.b.BackupError, 'not_authorized'):
                r.apply()

    def test_catalog_guard_raises_before_ddl(self):
        sql = r.catalog_guard([{'sql': "SELECT json_build_object('x',true)", 'value': {'x': True}}])
        self.assertIn("ERRCODE='40001'", sql)
        self.assertNotIn('DROP ', sql)
        self.assertNotIn('DELETE ', sql)


if __name__ == '__main__':
    unittest.main()
