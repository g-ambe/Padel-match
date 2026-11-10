"""マージ後0045の適用対象・承認ガード。DB接続なし。"""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('postmerge191', Path(__file__).with_name('post_merge_apply.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PostMergeAuthorization(unittest.TestCase):
    def test_unauthorized_apply_never_connects(self):
        with patch.dict(m.os.environ, {}, clear=True), patch.object(m, 'authority') as auth:
            with self.assertRaisesRegex(m.b.BackupError, 'not_authorized'):
                m.apply()
            auth.assert_not_called()

    def test_different_migration_is_rejected_before_api(self):
        with patch.object(m.r, 'MIGRATION', Mock(read_bytes=lambda: b'changed')), patch.object(m.b, 'api') as api:
            with self.assertRaisesRegex(m.b.BackupError, 'migration_changed'):
                m.authority()
            api.assert_not_called()

    def test_wrong_merge_target_is_rejected(self):
        with patch.object(m.b, 'api', return_value={'merged': True, 'merge_commit_sha': 'wrong'}):
            with self.assertRaisesRegex(m.b.BackupError, 'merged_application_changed'):
                m.authority()

    def test_main_advance_is_rejected(self):
        pr = {'merged': True, 'merge_commit_sha': m.MAIN, 'head': {'sha': m.APP_HEAD}}
        with patch.object(m.b, 'api', side_effect=[pr, {'sha': 'unexpected'}]):
            with self.assertRaisesRegex(m.b.BackupError, 'main_changed'):
                m.authority()


if __name__ == '__main__':
    unittest.main()
