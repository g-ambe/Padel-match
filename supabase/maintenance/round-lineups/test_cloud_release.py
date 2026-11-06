"""本番接続・秘密値を使わず、PR182の適用ガードを確認する。"""
import importlib.util
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).with_name('cloud_release.py')
spec = importlib.util.spec_from_file_location('lineup_release_tested', path)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class ReleaseGuards(unittest.TestCase):
    def test_authority_and_exact_migrations(self):
        with patch.dict(os.environ, {'PADEL_RELEASE_AUTHORIZED': r.AUTHORITY, 'BACKUP_SOURCE_SHA': 'a' * 40}):
            r.authority()
        with patch.dict(os.environ, {'PADEL_RELEASE_AUTHORIZED': '', 'BACKUP_SOURCE_SHA': 'a' * 40}):
            with self.assertRaises(r.b.BackupError):
                r.authority()
        changed = r.reviewed()
        changed['migrations'][r.FILES[0]] = '0' * 64
        with patch.dict(os.environ, {'PADEL_RELEASE_AUTHORIZED': r.AUTHORITY, 'BACKUP_SOURCE_SHA': 'a' * 40}), patch.object(r, 'reviewed', return_value=changed):
            with self.assertRaises(r.b.BackupError):
                r.authority()

    def test_preflight_fails_closed(self):
        value = {k: [] for k in r.SECTIONS + r.INVALID}
        value.update({'0040_present': True, '0041_present': False, '0042_present': False})
        reviewed = {'catalog': r.fingerprints(value)}
        with patch.object(r, 'reviewed', return_value=reviewed):
            r.check_preflight(value)
            for change in [{'0040_present': False}, {'0041_present': True}, {'0042_present': True}, {'invalid_cards': [{'id': 'synthetic'}]}, {'policies': [{'qual': 'true'}]}]:
                with self.subTest(change=change), self.assertRaises(r.b.BackupError):
                    r.check_preflight(dict(value, **change))

    def test_identity_checks_branch_commit_and_main(self):
        good = {'state': 'open', 'head': {'repo': {'full_name': r.b.REPOSITORY}, 'ref': 'codex/atomic-round-lineup', 'sha': 'a' * 40}}
        with patch.dict(os.environ, {'BACKUP_SOURCE_SHA': 'a' * 40}), patch.object(r.b, 'api', side_effect=[good, {'sha': 'b' * 40}]):
            self.assertEqual(r.identity(), 'b' * 40)
        good['head']['sha'] = 'c' * 40
        with patch.dict(os.environ, {'BACKUP_SOURCE_SHA': 'a' * 40}), patch.object(r.b, 'api', side_effect=[good, {'sha': 'b' * 40}]), self.assertRaises(r.b.BackupError):
            r.identity()

    def test_trigger_diagnostic_lists_only_names_and_fields(self):
        expected = r.reviewed()['triggers']
        changed = dict(expected[0], function='synthetic altered definition')
        value = {'triggers': [changed]}
        result = r.trigger_differences(value)
        self.assertTrue(result)
        self.assertNotIn('synthetic altered definition', json.dumps(result))
        self.assertIn('function_sha256', json.dumps(result))

    def test_definition_diagnostic_hides_unknown_literals_and_comments(self):
        text = "AS $function$begin -- confidential comment\nif current_setting('role')='credential-value' then perform $$dollar-secret$$;end if;end $function$"
        value = r.redacted_definition(text)
        self.assertIn("current_setting('role')", value)
        for secret in ('confidential comment', 'credential-value', 'dollar-secret'):
            self.assertNotIn(secret, value)

    def test_only_approved_reference_definition_accepts_line_endings(self):
        definition = 'known reference guard\nsecond line\n'
        expected = {'triggers': [{'trigger': 'EXECUTE FUNCTION profile_link_private.guard_reference()', 'function_sha256': r.hashlib.sha256(definition.encode()).hexdigest()}]}
        with patch.object(r, 'reviewed', return_value=expected):
            self.assertEqual(r.approved_reference_definition(definition.replace('\n', '\r\n')), definition)
            changed = definition.replace('known', 'changed').replace('\n', '\r\n')
            self.assertEqual(r.approved_reference_definition(changed), changed)

    def test_backup_context_does_not_accept_another_commit(self):
        manifest = {'release': {'backup_schema': 'round_lineup_backup_0041_r123_a1', 'source_sha': 'a' * 40, 'migrations': r.reviewed()['migrations']}}
        with patch.dict(os.environ, {'PADEL_RELEASE_AUTHORIZED': r.AUTHORITY, 'BACKUP_SOURCE_SHA': 'a' * 40}):
            r.context(manifest)
            manifest['release']['source_sha'] = 'c' * 40
            with self.assertRaises(r.b.BackupError):
                r.context(manifest)


if __name__ == '__main__':
    unittest.main()
