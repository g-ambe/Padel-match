"""クラウドランナーから、認証情報を表示せずDB接続だけを確認する。"""

import json
import os
import re
import socket
import ssl
import subprocess
import sys
from urllib.parse import unquote, urlsplit


PROJECT_REF = "ntczrmvffmpjzilfebyi"
POOLER_HOST = "aws-1-ap-northeast-1.pooler.supabase.com"
POSTGRES_IMAGE = "postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
READ_ONLY_QUERY = """
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT json_build_object(
  'server_major', current_setting('server_version_num')::int / 10000,
  'read_only', current_setting('transaction_read_only')
);
ROLLBACK;
"""
PG_VARIABLES = (
    "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE",
    "PGSSLMODE", "PGSSLROOTCERT", "PGCONNECT_TIMEOUT",
)


class ProbeError(Exception):
    """秘密値を含まない固定メッセージだけを利用する。"""


def transport_probe():
    """認証前のPostgreSQL SSLRequestとTLS証明書だけを確認する。"""
    try:
        context = ssl.create_default_context()
        with socket.create_connection((POOLER_HOST, 5432), timeout=15) as connection:
            connection.settimeout(15)
            connection.sendall(bytes.fromhex("0000000804d2162f"))
            if connection.recv(1) != b"S":
                raise ProbeError("DB接続先でTLSの利用を確認できませんでした。")
            with context.wrap_socket(connection, server_hostname=POOLER_HOST):
                return {
                    "transport_connected": True, "tls_verified": True,
                    "database_credentials_sent": False, "backup_created": False,
                }
    except ssl.SSLCertVerificationError as exc:
        code = getattr(exc, "verify_code", None)
        raise ProbeError(f"DB接続先のTLS証明書を検証できませんでした。検証コード: {code}") from None
    except socket.gaierror:
        raise ProbeError("DB接続先のDNS名を解決できませんでした。SupabaseのConnectに表示されたホスト名を確認してください。") from None
    except ConnectionRefusedError:
        raise ProbeError("クラウドからDB接続先の5432番ポートへの接続が拒否されました。") from None
    except TimeoutError:
        raise ProbeError("クラウドからDB接続先へのTCP・TLS接続がタイムアウトしました。") from None
    except OSError:
        raise ProbeError("クラウドからDBへのTCP・TLS接続を確認できませんでした。") from None


def connection_environment(value):
    if not value or not value.strip():
        raise ProbeError("GitHub Secrets の PADEL_BACKUP_DB_URL が未設定です。")
    value = value.strip()
    if re.search(r"YOUR[-_ ]PASSWORD|\[PASSWORD\]|\[パスワード\]", value, re.I):
        raise ProbeError("接続URLのパスワードの仮文字を置き換えてください。")
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        username = unquote(parsed.username or "", errors="strict")
        password = unquote(parsed.password or "", errors="strict")
        database = unquote(parsed.path.lstrip("/"), errors="strict")
        pooler = bool(host and re.fullmatch(r"aws-[a-z0-9-]+\.pooler\.supabase\.com", host))
        direct = host == f"db.{PROJECT_REF}.supabase.co"
        expected_user = f"postgres.{PROJECT_REF}" if pooler else "postgres"
        valid = (
            parsed.scheme in ("postgresql", "postgres")
            and (pooler or direct)
            and (port or 5432) == 5432
            and username == expected_user
            and bool(password)
            and "\x00" not in password
            and database == "postgres"
            and parsed.fragment == ""
            and not re.search(r"\s|%(?![0-9a-fA-F]{2})", value)
        )
    except (ValueError, UnicodeError):
        valid = False
    if not valid:
        raise ProbeError("対象プロジェクトの5432番DB接続URLを確認してください。値はログに表示しません。")
    # URLのオプションから、証明書検証を無効化する設定を引き継がない。
    return {
        "PGHOST": host,
        "PGPORT": "5432",
        "PGUSER": username,
        "PGPASSWORD": password,
        "PGDATABASE": database,
        "PGSSLMODE": "verify-full",
        "PGSSLROOTCERT": "/etc/ssl/certs/ca-certificates.crt",
        "PGCONNECT_TIMEOUT": "15",
    }


def command():
    args = ["docker", "run", "--rm", "--interactive"]
    for name in PG_VARIABLES:
        args.extend(["--env", name])
    return args + [
        POSTGRES_IMAGE, "psql", "--no-psqlrc", "--quiet", "--tuples-only",
        "--no-align", "--set", "ON_ERROR_STOP=1", "--file", "-",
    ]


def probe(value, runner=subprocess.run):
    environment = {
        key: val for key, val in os.environ.items()
        if not key.startswith("PG")
        and key not in ("SUPABASE_DB_URL", "PADEL_BACKUP_PASSPHRASE")
    }
    environment.update(connection_environment(value))
    try:
        result = runner(
            command(), input=READ_ONLY_QUERY, text=True, env=environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise ProbeError("クラウドからのDB接続確認がタイムアウトしました。") from None
    except OSError:
        raise ProbeError("接続確認用コンテナを起動できませんでした。") from None
    if result.returncode:
        message = (result.stderr or "").lower()
        if "password authentication failed" in message:
            category = "DBパスワードによる認証に失敗しました。"
        elif "certificate" in message or "ssl" in message:
            category = "TLS接続・証明書の検証に失敗しました。"
        elif "timeout" in message or "timed out" in message:
            category = "DBへの通信がタイムアウトしました。"
        else:
            category = "DBへの接続に失敗しました。"
        # クライアントの生のエラーには接続情報が含まれ得るので表示しない。
        raise ProbeError(category + " 接続URL・認証情報・生のエラーはログに表示しません。")
    try:
        response = json.loads(result.stdout)
        if type(response.get("server_major")) is not int or response["server_major"] < 15:
            raise ValueError()
        if response.get("read_only") != "on":
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ProbeError("読み取り専用接続の確認結果が想定外です。") from None
    # 出力を固定項目だけに限定し、DB行や接続情報を含めない。
    return {
        "connected": True,
        "server_major": response["server_major"],
        "read_only": True,
        "tls_verification": "verify-full",
        "production_mutations": False,
        "backup_created": False,
    }


def main():
    transport_only = sys.argv[1:] == ["--transport-only"]
    try:
        result = (
            transport_probe() if transport_only
            else probe(os.environ.get("SUPABASE_DB_URL", ""))
        )
    except ProbeError as exc:
        print(str(exc), file=sys.stderr)
        if os.environ.get("GITHUB_ACTIONS") == "true":
            # 固定・非機密の理由だけをGitHub APIから確認できるようにする。
            print(f"::error title=クラウドDB接続確認::{exc}")
        return 1
    print(json.dumps(result, ensure_ascii=False))
    print(
        "認証前のTCP・TLS接続を確認しました。DB認証は未確認です。" if transport_only
        else "読み取り専用のDB認証を確認しました。"
    )
    print("バックアップ取得・復元試験・本番SQL適用は実施していません。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
