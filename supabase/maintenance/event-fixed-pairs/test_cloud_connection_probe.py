"""接続情報の誤送信・ログ漏えい・書込みを防ぐ確認。実DBには接続しない。"""

import subprocess
import ssl
import hashlib
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import cloud_connection_probe as target


URL = "postgresql://postgres.ntczrmvffmpjzilfebyi:example%40test%23pass@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"


class ConnectionProbeTests(unittest.TestCase):
    def certificate_fixture(self):
        bundle = Path(ssl.get_default_verify_paths().cafile).read_text()
        return (re.search(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", bundle, re.S).group() + "\n").encode()

    def ca_response(self, data, url=target.CA_URL):
        response = MagicMock()
        response.__enter__.return_value = response
        response.geturl.return_value = url
        response.read.return_value = data
        return response

    def test_official_ca_is_verified_and_mounted_readonly(self):
        data = self.certificate_fixture()
        fingerprint = hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public-ca.crt"
            with patch.dict(os.environ, {"PADEL_BACKUP_CA_FILE": str(path)}), patch.object(target, "EXPECTED_CA_SHA256", fingerprint), patch.object(target, "urlopen", return_value=self.ca_response(data)) as opener:
                self.assertEqual(target.prepare_ca()["ca_sha256"], fingerprint)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(target.custom_ca_file(), path)
                opener.assert_called_once_with(target.CA_URL, timeout=20)
                self.assertIn(f"type=bind,src={path},dst=/run/padel-supabase-ca.crt,readonly", target.command(path))

    def test_ca_checksum_mismatch_stops_before_authentication(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public-ca.crt"
            path.write_bytes(self.certificate_fixture())
            with patch.dict(os.environ, {"PADEL_BACKUP_CA_FILE": str(path)}), patch.object(target, "EXPECTED_CA_SHA256", "0" * 64):
                runner = MagicMock()
                with self.assertRaises(target.ProbeError):
                    target.probe(URL, runner)
                runner.assert_not_called()

    def test_ca_redirect_and_invalid_pem_are_not_trusted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "public-ca.crt"
            for response in [self.ca_response(b"not a certificate"), self.ca_response(self.certificate_fixture(), "http://untrusted.invalid/ca")]:
                with patch.dict(os.environ, {"PADEL_BACKUP_CA_FILE": str(path)}), patch.object(target, "urlopen", return_value=response):
                    with self.assertRaises(target.ProbeError):
                        target.prepare_ca()
                self.assertFalse(path.exists())

    def test_transport_probe_uses_tls_validation_without_credentials(self):
        connection = MagicMock()
        connection.recv.return_value = b"S"
        socket_context = MagicMock()
        socket_context.__enter__.return_value = connection
        context = ssl.create_default_context()
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        tls_context = MagicMock(wraps=context)
        tls_context.wrap_socket.return_value = MagicMock()
        with patch.object(target.socket, "create_connection", return_value=socket_context), patch.object(target.ssl, "create_default_context", return_value=tls_context):
            result = target.transport_probe()
        connection.sendall.assert_called_once_with(bytes.fromhex("0000000804d2162f"))
        tls_context.wrap_socket.assert_called_once_with(connection, server_hostname=target.POOLER_HOST)
        self.assertFalse(result["database_credentials_sent"])

    def test_transport_refusal_fails_without_credential_output(self):
        with patch.object(target.socket, "create_connection", side_effect=ConnectionRefusedError("private details")):
            with self.assertRaises(target.ProbeError) as caught:
                target.transport_probe()
        self.assertNotIn("private details", str(caught.exception))

    def test_password_is_decoded_only_in_environment(self):
        env = target.connection_environment(URL)
        self.assertEqual(env["PGPASSWORD"], "example@test#pass")
        self.assertNotIn(URL, " ".join(target.command()))
        self.assertNotIn(env["PGPASSWORD"], " ".join(target.command()))

    def test_tls_verification_cannot_be_disabled_by_url(self):
        env = target.connection_environment(URL + "?sslmode=disable")
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertEqual(env["PGSSLROOTCERT"], "/etc/ssl/certs/ca-certificates.crt")

    def test_other_projects_transaction_pooler_and_empty_password_are_rejected(self):
        candidates = [
            "", URL.replace("ntczrmvffmpjzilfebyi", "another-project"),
            URL.replace(":5432/", ":6543/"),
            URL.replace("example%40test%23pass", ""),
            URL.replace("pooler.supabase.com", "attacker.invalid"),
            URL.replace("example%40test%23pass", "[YOUR-PASSWORD]"),
            URL.replace("example%40test%23pass", "bad%xx"),
            URL.replace("example%40test%23pass", "bad%4x"),
            URL.replace("example%40test%23pass", "bad%00pass"),
        ]
        for value in candidates:
            with self.subTest(value="非公開の不正入力"):
                with self.assertRaises(target.ProbeError) as caught:
                    target.connection_environment(value)
                self.assertNotIn("example%40test%23pass", str(caught.exception))

    def test_success_report_cannot_include_unexpected_server_fields(self):
        def runner(args, **options):
            self.assertIn("BEGIN READ ONLY", options["input"])
            self.assertIn("ROLLBACK", options["input"])
            self.assertNotIn("--network", args)
            self.assertEqual(options["env"]["PGSSLMODE"], "verify-full")
            self.assertNotIn("SUPABASE_DB_URL", options["env"])
            self.assertNotIn("PADEL_BACKUP_PASSPHRASE", options["env"])
            return subprocess.CompletedProcess(args, 0, '{"server_major":17,"read_only":"on","password":"should-not-appear"}', "")
        result = target.probe(URL, runner)
        self.assertTrue(result["connected"])
        self.assertFalse(result["backup_created"])
        self.assertFalse(result["production_mutations"])
        self.assertNotIn("should-not-appear", str(result))

    def test_client_error_is_redacted(self):
        def runner(args, **options):
            return subprocess.CompletedProcess(args, 2, "", "password authentication failed " + URL)
        with self.assertRaises(target.ProbeError) as caught:
            target.probe(URL, runner)
        self.assertNotIn(URL, str(caught.exception))
        self.assertIn("認証", str(caught.exception))

    def test_timeout_and_non_readonly_response_fail(self):
        def timeout(args, **options):
            raise subprocess.TimeoutExpired(args, 180, output=URL)
        with self.assertRaises(target.ProbeError) as caught:
            target.probe(URL, timeout)
        self.assertNotIn(URL, str(caught.exception))
        def writable(args, **options):
            return subprocess.CompletedProcess(args, 0, '{"server_major":17,"read_only":"off"}', "")
        with self.assertRaises(target.ProbeError):
            target.probe(URL, writable)


if __name__ == "__main__":
    unittest.main()
