"""DBを変更せずに論理バックアップを取得し、別クラウドジョブで復元確認する。"""

import hashlib
import json
import os
import re
import select
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path
from urllib.request import urlopen

import cloud_connection_probe as probe


REPOSITORY = "g-ambe/Padel-match"
CLI_URL = "https://github.com/supabase/cli/releases/download/v3.0.0/supabase_3.0.0_linux_amd64.tar.gz"
CLI_SHA256 = "eeb61edcd59a4735fcb5e58596574f25d03d420efca779f43ddb307e1cc5c754"
PROJECT = "padel_backup_restore"
MANAGED = ("auth", "storage", "supabase_functions", "supabase_migrations")
# Supabase CLI 3.0.0のdata-only除外設定。拡張の実行キューは照合対象外。
EXCLUDED_DATA = {
    "information_schema", "graphql", "graphql_public", "pgsodium", "pgsodium_masks",
    "pgtle", "repack", "tiger", "tiger_data", "topology", "vault", "etl",
    "extensions", "pgbouncer", "realtime", "_analytics", "_realtime", "_supavisor",
}
EXCLUDED_SCHEMA = EXCLUDED_DATA | {"auth", "storage", "supabase_functions", "supabase_migrations", "cron", "net", "pgmq", "dbdev"}
MIGRATION_TABLES = ("auth.schema_migrations", "storage.migrations", "supabase_functions.migrations")
DOCKER = ["env", "-u", "DOCKER_HOST", "-u", "DOCKER_CONTEXT", "-u", "DOCKER_TLS",
          "-u", "DOCKER_TLS_VERIFY", "-u", "DOCKER_CERT_PATH", "docker", "--host=unix:///var/run/docker.sock"]
PSQL = ["psql", "-X", "-qAt", "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=sqlstate", "--file", "-"]
SQL_SETTINGS = "SET LOCAL search_path=''; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, MDY'; SET LOCAL extra_float_digits=3; SET LOCAL statement_timeout='120s';"


class BackupError(Exception):
    """ログには固定の段階名だけを出す。SQL・認証情報は出さない。"""


def run(args, *, phase, env=None, data=None, output=None, timeout=180, cwd=None):
    try:
        result = subprocess.run(args, input=data, stdout=output or subprocess.PIPE,
                                stderr=subprocess.PIPE, env=env, timeout=timeout, check=False, cwd=cwd)
    except (OSError, subprocess.TimeoutExpired):
        raise BackupError(phase) from None
    if result.returncode:
        error = (result.stderr or b"").decode(errors="replace")
        state = re.search(r"(?:ERROR|FATAL):\s+([0-9A-Z]{5})(?:\s|$)", error)
        raise BackupError(phase + ("/" + state.group(1) if state else ""))
    return result.stdout if output is None else b""


def clean_env():
    return {k: v for k, v in os.environ.items()
            if not k.startswith("PG") and k not in ("SUPABASE_DB_URL", "PADEL_BACKUP_PASSPHRASE", "GH_TOKEN", "GITHUB_TOKEN")}


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def json_file(path, value):
    with Path(path).open("x", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def passphrase():
    value = os.environ.get("PADEL_BACKUP_PASSPHRASE", "")
    if not value:
        raise BackupError("backup_passphrase_missing")
    if len(value) < 32 or len(set(value)) < 12 or "\n" in value or "\r" in value or "\x00" in value:
        raise BackupError("backup_passphrase_requires_32_random_characters")
    return value


def cli():
    value = os.environ.get("SUPABASE_BIN", "")
    if not value or not Path(value).is_file():
        raise BackupError("supabase_cli_missing")
    return value


def cli_env():
    env = clean_env()
    env.update({"SUPABASE_HOME": str(Path(os.environ["RUNNER_TEMP"]) / "supabase-config"), "SUPABASE_TELEMETRY_DISABLED": "1"})
    return env


def install_cli():
    root = Path(os.environ["RUNNER_TEMP"]) / "supabase-tools"
    root.mkdir(mode=0o700, exist_ok=False)
    archive = root / "supabase.tar.gz"
    try:
        with urlopen(CLI_URL, timeout=60) as response, archive.open("xb") as output:
            shutil.copyfileobj(response, output)
    except OSError:
        raise BackupError("supabase_cli_download_failed") from None
    if hashlib.sha256(archive.read_bytes()).hexdigest() != CLI_SHA256:
        raise BackupError("supabase_cli_checksum_failed")
    with tarfile.open(archive) as bundle:
        member = bundle.getmember("supabase")
        if not member.isfile():
            raise BackupError("supabase_cli_archive_invalid")
        binary = root / "supabase"
        with binary.open("xb") as output:
            shutil.copyfileobj(bundle.extractfile(member), output)
        binary.chmod(0o700)


def source_prefix(ca):
    args = DOCKER + ["run", "--rm", "--interactive", "--mount",
                     f"type=bind,src={ca},dst=/run/padel-supabase-ca.crt,readonly"]
    for name in (*probe.PG_VARIABLES, "PGOPTIONS"):
        args += ["--env", name]
    return args + [probe.POSTGRES_IMAGE]


class Snapshot:
    def __init__(self, prefix, environment):
        self.prefix = prefix
        self.env = environment.copy()
        self.process = None
        self.info = None

    def __enter__(self):
        self.process = subprocess.Popen(self.prefix + PSQL, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=self.env)
        request = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL idle_in_transaction_session_timeout='15min'; SELECT json_build_object('snapshot',pg_export_snapshot(),'captured_at',transaction_timestamp(),'server_major',current_setting('server_version_num')::int/10000);\n"
        self.process.stdin.write(request.encode())
        self.process.stdin.flush()
        if not select.select([self.process.stdout], [], [], 40)[0]:
            self.close()
            raise BackupError("snapshot_open_failed")
        try:
            self.info = json.loads(self.process.stdout.readline())
            if not re.fullmatch(r"[0-9A-Fa-f-]+", self.info["snapshot"]):
                raise ValueError()
            if self.info["server_major"] != 17:
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            self.close()
            raise BackupError("snapshot_requires_postgresql_17") from None
        return self

    def close(self):
        if self.process:
            try:
                self.process.communicate(b"ROLLBACK;\n", timeout=10)
            except (OSError, subprocess.TimeoutExpired):
                self.process.kill()
                self.process.wait()
            self.process = None

    def __exit__(self, *args):
        self.close()

    def query(self, sql):
        wrapped = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT " + literal(self.info["snapshot"]) + ";" + SQL_SETTINGS + sql + ";ROLLBACK;"
        output = run(self.prefix + PSQL, phase="snapshot_query_failed", env=self.env, data=wrapped.encode())
        try:
            return json.loads(output)
        except ValueError:
            raise BackupError("snapshot_query_result_invalid") from None

    def dump(self, args, path):
        with Path(path).open("xb") as output:
            run(self.prefix + ["pg_dump", "--snapshot=" + self.info["snapshot"]] + args,
                phase="native_dump_failed", env=self.env, output=output, timeout=600)

    def wrappers(self, root):
        root.mkdir(mode=0o700)
        for tool in ("pg_dump", "pg_dumpall"):
            args = self.prefix + [tool]
            if tool == "pg_dump":
                args += ["--snapshot=" + self.info["snapshot"]]
            script = "#!" + sys.executable + "\nimport os,sys\nargs=" + repr(args) + "\nos.execvpe(args[0],args+sys.argv[1:],os.environ)\n"
            file = root / tool
            file.write_text(script)
            file.chmod(0o700)


def official_dump(snapshot, mode, output, root):
    args = [cli(), "db", "dump", "--remote=postgresql://postgres:synthetic-only@127.0.0.1:5432/postgres", "--dry-run"]
    if mode == "roles":
        args += ["--role-only"]
    elif mode == "data":
        args += ["--data-only", "--use-copy"]
    else:
        args += ["--keep-comments"]
    generated = run(args, phase="official_dump_script_failed", env=cli_env(), cwd=root).decode()
    # 固定したCLIのドライランだけを使用。実認証情報をファイルへ展開しない。
    for name in ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"):
        generated, count = re.subn(r"^export " + name + r"=.*\n", "", generated, flags=re.M)
        if count != 1:
            raise BackupError("official_dump_script_changed")
    env = snapshot.env.copy()
    env["PATH"] = str(root / "bin") + os.pathsep + env.get("PATH", "")
    with Path(output).open("xb") as destination:
        run(["bash"], phase="official_" + mode + "_dump_failed", env=env,
            data=generated.encode(), output=destination, timeout=600)


INVENTORY = """
SELECT json_build_object(
 'tables',coalesce((SELECT json_agg(json_build_object('schema',n.nspname,'name',c.relname) ORDER BY n.nspname,c.relname)
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname !~ '^(pg_|information_schema$)'
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')),'[]'::json),
 'schemas',coalesce((SELECT json_agg(nspname ORDER BY nspname) FROM pg_catalog.pg_namespace WHERE nspname !~ '^(pg_|information_schema$)'),'[]'::json),
 'extensions',coalesce((SELECT json_agg(json_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname) FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace),'[]'::json),
 'large_objects',(SELECT count(*) FROM pg_catalog.pg_largeobject_metadata),
 'foreign_tables',(SELECT count(*) FROM pg_catalog.pg_foreign_table)
)
"""

ROLE_METADATA = """
SELECT coalesce(json_agg(json_build_object(
 'name',r.rolname,'superuser',r.rolsuper,'inherit',r.rolinherit,'create_role',r.rolcreaterole,
 'create_database',r.rolcreatedb,'login',r.rolcanlogin,'replication',r.rolreplication,'bypass_rls',r.rolbypassrls,
 'config',coalesce((SELECT json_agg(v ORDER BY v COLLATE "C") FROM unnest(r.rolconfig) v),'[]'::json),
 'members',coalesce((SELECT json_agg(json_build_array(m.rolname,a.admin_option,a.inherit_option,a.set_option) ORDER BY m.rolname COLLATE "C") FROM pg_catalog.pg_auth_members a JOIN pg_catalog.pg_roles m ON m.oid=a.member WHERE a.roleid=r.oid),'[]'::json)
) ORDER BY r.rolname COLLATE "C"),'[]'::json)
FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
 OR (r.rolname !~ '^(pg_|supabase_|cli_login_)' AND r.rolname NOT IN ('postgres','authenticator','dashboard_user','pgbouncer','pgtle_admin','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker'))
"""


def included_tables(inventory):
    return [t for t in inventory["tables"] if t["schema"] not in EXCLUDED_DATA
            and not t["schema"].startswith(("pg_", "timescaledb_", "_timescaledb_"))]


def row_fingerprints(query, tables):
    result = []
    for table in tables:
        name = ident(table["schema"]) + "." + ident(table["name"])
        sql = "SELECT json_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE \"C\"),''),'UTF8')),'hex')) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM " + name + " t) rows"
        result.append(dict(table, **query(sql)))
    return result


def catalog(query, tables, schemas):
    result = {"tables": [], "functions": [], "schemas": []}
    for table in tables:
        relation = ident(table["schema"]) + "." + ident(table["name"])
        oid = literal(relation) + "::regclass"
        sql = """SELECT json_build_object(
         'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_catalog.pg_get_userbyid(c.relowner),
         'columns',(SELECT json_agg(json_build_array(a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_catalog.pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
         'constraints',coalesce((SELECT json_agg(json_build_array(k.conname,pg_catalog.pg_get_constraintdef(k.oid),k.convalidated) ORDER BY k.conname) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),'[]'::json),
         'indexes',coalesce((SELECT json_agg(json_build_array(i.relname,pg_catalog.pg_get_indexdef(x.indexrelid),x.indisvalid) ORDER BY i.relname) FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid WHERE x.indrelid=c.oid),'[]'::json),
         'triggers',coalesce((SELECT json_agg(json_build_array(g.tgname,pg_catalog.pg_get_triggerdef(g.oid),g.tgenabled) ORDER BY g.tgname) FROM pg_catalog.pg_trigger g WHERE g.tgrelid=c.oid AND NOT g.tgisinternal),'[]'::json),
         'policies',coalesce((SELECT json_agg(json_build_object('name',p.policyname,'cmd',p.cmd,'permissive',p.permissive,'roles',(SELECT json_agg(r ORDER BY r) FROM unnest(p.roles) r),'qual',p.qual,'with_check',p.with_check) ORDER BY p.policyname) FROM pg_catalog.pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname),'[]'::json),
         'acl',coalesce((SELECT json_agg(json_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,pg_catalog.pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type) FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a),'[]'::json),
         'column_acl',coalesce((SELECT json_agg(json_build_array(v.attname,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,pg_catalog.pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) ORDER BY v.attname,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type) FROM pg_catalog.pg_attribute v CROSS JOIN LATERAL pg_catalog.aclexplode(v.attacl) a WHERE v.attrelid=c.oid AND v.attnum>0 AND NOT v.attisdropped),'[]'::json)
        ) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=""" + oid
        definition = query(sql)
        for key in ("constraints", "indexes", "triggers", "policies", "acl", "column_acl"):
            definition[key].sort(key=lambda value: json.dumps(value, sort_keys=True, ensure_ascii=False))
        result["tables"].append(dict(table, definition=definition))
    for schema in schemas:
        schema_sql = """SELECT json_build_object('owner',pg_catalog.pg_get_userbyid(n.nspowner),'acl',coalesce((SELECT json_agg(json_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,pg_catalog.pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type) FROM pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a),'[]'::json)) FROM pg_catalog.pg_namespace n WHERE n.nspname=""" + literal(schema)
        schema_definition = query(schema_sql)
        schema_definition["acl"].sort(key=lambda value: json.dumps(value, sort_keys=True, ensure_ascii=False))
        result["schemas"].append({"schema": schema, "definition": schema_definition})
        sql = """SELECT coalesce(json_agg(json_build_object('name',p.proname,'arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),'definition',pg_catalog.pg_get_functiondef(p.oid),'owner',pg_catalog.pg_get_userbyid(p.proowner),'acl',coalesce((SELECT json_agg(json_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,pg_catalog.pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,a.privilege_type) FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a),'[]'::json)) ORDER BY p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid)),'[]'::json) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p') AND n.nspname=""" + literal(schema) + " AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')"
        definitions = query(sql)
        for definition in definitions:
            definition["acl"].sort(key=lambda value: json.dumps(value, sort_keys=True, ensure_ascii=False))
        definitions.sort(key=lambda value: (value["name"], value["arguments"]))
        result["functions"].append({"schema": schema, "definitions": definitions})
    return result


def gpg(source, destination, decrypt=False):
    key = passphrase()
    env = clean_env()
    directory = Path(os.environ["RUNNER_TEMP"]) / "backup-gnupg"
    directory.mkdir(mode=0o700, exist_ok=True)
    env["GNUPGHOME"] = str(directory)
    args = ["gpg", "--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-fd", "0", "--output", str(destination)]
    args += ["--decrypt", str(source)] if decrypt else ["--symmetric", "--cipher-algo", "AES256", "--s2k-digest-algo", "SHA512", "--s2k-count", "65011712", str(source)]
    run(args, phase="backup_decryption_failed" if decrypt else "backup_encryption_failed", env=env, data=(key + "\n").encode(), timeout=300)


def workdir():
    root = Path(os.environ["PADEL_BACKUP_WORKDIR"])
    if not root.is_absolute() or root.resolve().is_relative_to(Path(__file__).resolve().parents[3]):
        raise BackupError("backup_workdir_must_be_outside_repository")
    return root


def collect(snapshot, root):
    files = root / "files"
    files.mkdir(mode=0o700)
    inventory = snapshot.query(INVENTORY)
    if inventory["large_objects"]:
        raise BackupError("large_objects_require_separate_backup_plan")
    if inventory["foreign_tables"]:
        raise BackupError("foreign_tables_require_separate_backup_plan")
    tables = included_tables(inventory)
    required = {"public." + name for name in ["player_profiles", "profiles", "clubs", "club_members", "events", "event_participants", "rounds", "matches", "match_players", "match_results"]} | {"auth.users", "auth.identities"}
    if not required.issubset({t["schema"] + "." + t["name"] for t in tables}):
        raise BackupError("required_backup_tables_missing")
    schemas = [s for s in MANAGED if s in inventory["schemas"]]
    function_schemas = sorted(s for s in inventory["schemas"] if s in MANAGED or (s not in EXCLUDED_SCHEMA and not s.startswith(("pg_", "timescaledb_", "_timescaledb_"))))
    snapshot.wrappers(root / "bin")
    for mode, name in [("roles", "roles.sql"), ("schema", "schema.sql"), ("data", "data.sql")]:
        official_dump(snapshot, mode, files / name, root)
    # 管理スキーマをまたぐFK・関数・トリガーをpg_restoreの依存順で再構築する。
    # 標準CLIの3ファイルも改変せず併せて保管する。
    excluded = sorted(EXCLUDED_SCHEMA - set(MANAGED)) + ["pg_*", "timescaledb_*", "_timescaledb_*"]
    snapshot.dump(["--schema-only", "--format=custom", "--exclude-schema=" + "|".join(excluded)], files / "schema.dump")
    if schemas:
        flags = ["--schema=" + ident(s) for s in schemas]
        snapshot.dump(["--schema-only", "--section=pre-data"] + flags, files / "managed-pre.sql")
        snapshot.dump(["--schema-only", "--section=post-data"] + flags, files / "managed-post.sql")
    else:
        (files / "managed-pre.sql").write_text("")
        (files / "managed-post.sql").write_text("")
    extra = [t for t in tables if t["schema"] == "supabase_migrations" or t["schema"] + "." + t["name"] in MIGRATION_TABLES]
    if extra:
        snapshot.dump(["--data-only"] + ["--table=" + ident(t["schema"]) + "." + ident(t["name"]) for t in extra], files / "migration-data.sql")
    else:
        (files / "migration-data.sql").write_text("")
    json_file(files / "rows.json", row_fingerprints(snapshot.query, tables))
    json_file(files / "catalog.json", catalog(snapshot.query, tables, function_schemas))
    json_file(files / "roles.json", snapshot.query(ROLE_METADATA))
    info = dict(snapshot.info, project_ref=probe.PROJECT_REF, tables=tables, managed_schemas=schemas, function_schemas=function_schemas, extensions=inventory["extensions"], tool="Supabase CLI 3.0.0 / PostgreSQL 17", production_mutations=False)
    json_file(files / "manifest.json", info)
    return info


def seal(root, info):
    files = root / "files"
    tables = info["tables"]
    hashes = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(files.iterdir())}
    json_file(files / "SHA256SUMS.json", hashes)
    archive = root / "backup.tar"
    with tarfile.open(archive, "w") as bundle:
        for file in sorted(files.iterdir()):
            bundle.add(file, arcname=file.name)
    encrypted = root / "backup.tar.gpg"
    gpg(archive, encrypted)
    record = {"sha256": hashlib.sha256(encrypted.read_bytes()).hexdigest(), "bytes": encrypted.stat().st_size, "captured_at": info["captured_at"], "project_ref": probe.PROJECT_REF, "server_major": 17, "table_count": len(tables)}
    json_file(root / "record.json", record)
    return {"dump_encrypted": True, "table_count": len(tables), "production_mutations": False, "restore_verified": False}


def create():
    passphrase()  # 暗号化用Secretの準備前に本番データを取得しない。
    root = workdir()
    root.mkdir(mode=0o700, exist_ok=False)
    ca = probe.custom_ca_file()
    if not ca:
        raise BackupError("official_ca_required")
    environment = clean_env()
    environment.update(probe.connection_environment(os.environ.get("SUPABASE_DB_URL", "")))
    environment["PGSSLROOTCERT"] = "/run/padel-supabase-ca.crt"
    environment["PGOPTIONS"] = "-c default_transaction_read_only=on"
    with Snapshot(source_prefix(ca), environment) as snapshot:
        info = collect(snapshot, root)
    return seal(root, info)


def github(args, data=None, output=None):
    # APIやCLIの生のエラーには署名付きURLが含まれ得るので出力しない。
    return run(["gh"] + args, phase="github_backup_storage_failed", data=data, output=output, timeout=600)


def api(path, method="GET", body=None):
    args = ["api", "--method", method, "repos/" + REPOSITORY + path]
    data = None
    if body is not None:
        args += ["--input", "-"]
        data = json.dumps(body, ensure_ascii=False).encode()
    return json.loads(github(args, data))


def publish():
    root = workdir()
    record = json.loads((root / "record.json").read_text())
    encrypted = root / "backup.tar.gpg"
    if hashlib.sha256(encrypted.read_bytes()).hexdigest() != record["sha256"]:
        raise BackupError("encrypted_backup_checksum_failed")
    run_id = os.environ["GITHUB_RUN_ID"]
    sha = os.environ["BACKUP_SOURCE_SHA"]
    if not run_id.isdigit() or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise BackupError("backup_source_identity_invalid")
    attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "1")
    if not attempt.isdigit():
        raise BackupError("backup_attempt_invalid")
    tag = "db-backup-" + run_id + "-" + attempt
    body = "DB外論理バックアップの非公開保管です。アプリのリリース・公開・デプロイには使用しません。\n\n復元確認：未完了\n\n" + json.dumps(record, ensure_ascii=False, sort_keys=True)
    release = api("/releases", "POST", {"tag_name": tag, "target_commitish": sha, "name": "DBバックアップ（非公開・復元確認待ち） " + run_id, "body": body, "draft": True, "prerelease": False})
    if not release.get("draft"):
        raise BackupError("backup_release_must_remain_draft")
    asset = json.loads(github(["api", "--method", "POST", "https://uploads.github.com/repos/" + REPOSITORY + "/releases/" + str(int(release["id"])) + "/assets?name=backup.tar.gpg", "--header", "Content-Type: application/octet-stream", "--input", str(encrypted)]))
    stored = dict(record, release_id=int(release["id"]), asset_id=int(asset["id"]), tag=tag)
    json_file(root / "storage.json", stored)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for key in ("release_id", "asset_id", "sha256"):
            output.write(key + "=" + str(stored[key]) + "\n")
    return {"encrypted_backup_stored": True, "release_id": stored["release_id"], "draft": True, "restore_verified": False}


def download():
    root = workdir()
    root.mkdir(mode=0o700, exist_ok=False)
    release_id = int(os.environ["BACKUP_RELEASE_ID"])
    asset_id = int(os.environ["BACKUP_ASSET_ID"])
    release = api("/releases/" + str(release_id))
    asset = next((a for a in release["assets"] if a["id"] == asset_id), None)
    if not release.get("draft") or not asset or asset["name"] != "backup.tar.gpg":
        raise BackupError("backup_storage_identity_failed")
    with (root / "backup.tar.gpg").open("xb") as output:
        github(["api", "repos/" + REPOSITORY + "/releases/assets/" + str(asset_id), "--header", "Accept: application/octet-stream"], output=output)
    if hashlib.sha256((root / "backup.tar.gpg").read_bytes()).hexdigest() != os.environ["BACKUP_SHA256"]:
        raise BackupError("stored_backup_checksum_failed")
    return {"stored_archive_downloaded": True, "checksum_verified": True}


def unpack(root):
    gpg(root / "backup.tar.gpg", root / "backup.tar", decrypt=True)
    files = root / "files"
    files.mkdir(mode=0o700)
    expected = {"roles.sql", "schema.sql", "schema.dump", "data.sql", "managed-pre.sql", "managed-post.sql", "migration-data.sql", "rows.json", "catalog.json", "roles.json", "manifest.json", "SHA256SUMS.json"}
    with tarfile.open(root / "backup.tar") as archive:
        members = archive.getmembers()
        if {m.name for m in members} != expected or len(members) != len(expected) or sum(m.size for m in members) > 2 * 1024**3 or any(not m.isfile() for m in members):
            raise BackupError("backup_archive_members_invalid")
        archive.extractall(files, filter="data")
    hashes = json.loads((files / "SHA256SUMS.json").read_text())
    if set(hashes) != expected - {"SHA256SUMS.json"}:
        raise BackupError("backup_manifest_invalid")
    for name, digest in hashes.items():
        if hashlib.sha256((files / name).read_bytes()).hexdigest() != digest:
            raise BackupError("backup_inner_checksum_failed")
    manifest = json.loads((files / "manifest.json").read_text())
    if manifest["project_ref"] != probe.PROJECT_REF or manifest["server_major"] != 17:
        raise BackupError("backup_project_or_version_mismatch")
    return files, manifest


class LocalRestore:
    def __init__(self, container, user="supabase_admin"):
        if container != "supabase_db_" + PROJECT and not container.startswith("padel-backup-test-"):
            raise BackupError("restore_container_not_isolated")
        self.container = container
        self.prefix = DOCKER + ["exec", "--interactive", "--env", "PGHOST=/var/run/postgresql", "--env", "PGUSER=" + user, "--env", "PGDATABASE=postgres", "--env", "PGPASSWORD=postgres", container]

    def sql(self, sql):
        return run(self.prefix + PSQL, phase="isolated_restore_sql_failed", data=sql.encode(), timeout=600)

    def query(self, sql):
        result = self.sql("BEGIN READ ONLY;" + SQL_SETTINGS + sql + ";ROLLBACK;")
        try:
            return json.loads(result)
        except ValueError:
            raise BackupError("isolated_query_result_invalid") from None

    def file(self, path, replica=False):
        data = path.read_bytes()
        # この接続は隔離コンテナ内のUnix socketだけを使用する。
        if replica:
            data = b"SET session_replication_role=replica;\n" + data + b"\nSET session_replication_role=origin;\n"
        run(self.prefix + PSQL + ["--single-transaction"], phase="isolated_restore_file_failed/" + path.name, data=data, timeout=600)


def verify_foreign_keys(target, tables):
    for table in tables:
        relation = ident(table["schema"]) + "." + ident(table["name"])
        constraints = target.query("""SELECT coalesce(json_agg(json_build_object(
          'parent_schema',pn.nspname,'parent_table',p.relname,'match',k.confmatchtype,
          'columns',(SELECT json_agg(a.attname ORDER BY u.ord) FROM unnest(k.conkey) WITH ORDINALITY u(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=u.num),
          'parent_columns',(SELECT json_agg(a.attname ORDER BY u.ord) FROM unnest(k.confkey) WITH ORDINALITY u(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=u.num)
        ) ORDER BY k.conname),'[]'::json) FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class p ON p.oid=k.confrelid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.relnamespace WHERE k.contype='f' AND k.conrelid=""" + literal(relation) + "::regclass")
        for constraint in constraints:
            columns = ["c." + ident(c) for c in constraint["columns"]]
            parent = ident(constraint["parent_schema"]) + "." + ident(constraint["parent_table"])
            equality = " AND ".join(c + "=p." + ident(p) for c, p in zip(columns, constraint["parent_columns"]))
            missing = "NOT EXISTS(SELECT 1 FROM " + parent + " p WHERE " + equality + ")"
            if constraint["match"] == "f":
                predicate = "(" + " OR ".join(c + " IS NOT NULL" for c in columns) + ") AND ((" + " OR ".join(c + " IS NULL" for c in columns) + ") OR " + missing + ")"
            elif constraint["match"] == "s":
                predicate = " AND ".join(c + " IS NOT NULL" for c in columns) + " AND " + missing
            else:
                raise BackupError("unsupported_foreign_key_match_type")
            if target.query("SELECT to_json(count(*)) FROM " + relation + " c WHERE " + predicate):
                raise BackupError("restored_foreign_key_integrity_failed")


def restore_application_roles(target, expected):
    # 標準CLIが除外するanon等も、隔離DBの初期値ではなく取得元の設定へ揃える。
    # この処理はLocalRestoreのUnix socket接続以外から呼び出さない。
    actual = {role["name"]: role for role in target.query(ROLE_METADATA)}
    options = (("superuser", "SUPERUSER"), ("inherit", "INHERIT"),
               ("create_role", "CREATEROLE"), ("create_database", "CREATEDB"),
               ("login", "LOGIN"), ("replication", "REPLICATION"), ("bypass_rls", "BYPASSRLS"))
    for role in expected:
        name = role["name"]
        if name not in actual:
            raise BackupError("restore_role_not_initialized")
        flags = " ".join(("" if role[key] else "NO") + option for key, option in options)
        target.sql("ALTER ROLE " + ident(name) + " " + flags + "; ALTER ROLE " + ident(name) + " RESET ALL;")
        for entry in role["config"]:
            key, separator, value = entry.partition("=")
            if not separator:
                raise BackupError("backup_role_config_invalid")
            # FROM CURRENTはsearch_pathなどのリスト設定も再解釈せず保存できる。
            target.sql("SELECT pg_catalog.set_config(" + literal(key) + "," + literal(value) + ",false); ALTER ROLE " + ident(name) + " SET " + ident(key) + " FROM CURRENT;")
        for member, *_ in actual[name]["members"]:
            target.sql("REVOKE " + ident(name) + " FROM " + ident(member) + " CASCADE;")
    for role in expected:
        for member, admin, inherit, can_set in role["members"]:
            flags = ", ".join(key + (" TRUE" if value else " FALSE") for key, value in (("ADMIN", admin), ("INHERIT", inherit), ("SET", can_set)))
            target.sql("GRANT " + ident(role["name"]) + " TO " + ident(member) + " WITH " + flags + ";")


def restore_files(target, files, manifest):
    target.file(files / "roles.sql")
    expected_roles = json.loads((files / "roles.json").read_text())
    restore_application_roles(target, expected_roles)
    target.sql("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated;")
    # 新規の隔離コンテナ内だけを初期化する。本番接続先を引数に取らない。
    for schema in manifest["function_schemas"]:
        if schema.startswith("pg_") or schema in EXCLUDED_SCHEMA - set(MANAGED):
            raise BackupError("restore_schema_not_allowlisted")
        target.sql("DROP SCHEMA IF EXISTS " + ident(schema) + " CASCADE;")
    # pg_dumpはinitdb標準のpublicスキーマ定義を省略するため、その初期状態を再現する。
    target.sql("CREATE SCHEMA IF NOT EXISTS public AUTHORIZATION pg_database_owner; GRANT USAGE ON SCHEMA public TO PUBLIC;")
    expected_catalog = json.loads((files / "catalog.json").read_text())
    public_schema = next(s for s in expected_catalog["schemas"] if s["schema"] == "public")
    target.sql("ALTER SCHEMA public OWNER TO " + ident(public_schema["definition"]["owner"]) + ";")
    # --cleanはここで作った隔離DBに限る。原本schema.dumpにはDROPを追加しない。
    schema_sql = run(DOCKER + ["run", "--rm", "--interactive", "--network", "none", probe.POSTGRES_IMAGE,
                              "pg_restore", "--clean", "--if-exists", "--file", "-"],
                     phase="isolated_schema_render_failed", data=(files / "schema.dump").read_bytes(), timeout=300)
    native_schema = files.parent / "isolated-schema.sql"
    native_schema.write_bytes(schema_sql)
    target.file(native_schema, replica=True)
    target.file(files / "data.sql", replica=True)
    target.file(files / "migration-data.sql", replica=True)
    expected_rows = json.loads((files / "rows.json").read_text())
    if row_fingerprints(target.query, manifest["tables"]) != expected_rows:
        raise BackupError("restored_rows_or_values_mismatch")
    if catalog(target.query, manifest["tables"], manifest["function_schemas"]) != expected_catalog:
        raise BackupError("restored_rls_acl_or_definitions_mismatch")
    if target.query(ROLE_METADATA) != expected_roles:
        raise BackupError("restored_application_roles_mismatch")
    verify_foreign_keys(target, manifest["tables"])
    if target.query("SELECT to_json(current_setting('session_replication_role'))") != "origin":
        raise BackupError("restore_triggers_not_enabled")
    return {"restore_verified": True, "table_count": len(manifest["tables"]), "rows_and_values_match": True, "rls_acl_definitions_match": True, "production_mutations": False}


def start_isolated_database(root):
    directory = root / "supabase-local"
    directory.mkdir(mode=0o700)
    env = cli_env()
    env["DOCKER_HOST"] = "unix:///var/run/docker.sock"
    for key in ("DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
        env.pop(key, None)
    run([cli(), "init", "--workdir", str(directory)], phase="isolated_supabase_init_failed", env=env, cwd=directory)
    config = directory / "supabase/config.toml"
    text = config.read_text()
    text, count = re.subn(r'^project_id\s*=.*$', 'project_id = "' + PROJECT + '"', text, flags=re.M)
    if count != 1:
        raise BackupError("isolated_project_config_invalid")
    text, count = re.subn(r'^major_version\s*=.*$', 'major_version = 17', text, flags=re.M)
    if count != 1:
        raise BackupError("isolated_postgres_config_invalid")
    config.write_text(text)
    run([cli(), "start", "--workdir", str(directory), "--exclude", "gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor"], phase="isolated_supabase_start_failed", env=env, cwd=directory, timeout=900)
    database = "supabase_db_" + PROJECT
    names = run(DOCKER + ["ps", "--all", "--format", "{{.Names}}"], phase="isolated_container_inventory_failed").decode().splitlines()
    for name in names:
        if name != database and name.endswith("_" + PROJECT):
            run(DOCKER + ["stop", name], phase="isolated_service_stop_failed", timeout=120)
    networks = json.loads(run(DOCKER + ["inspect", database, "--format", "{{json .NetworkSettings.Networks}}"], phase="isolated_network_inventory_failed"))
    for network in networks:
        run(DOCKER + ["network", "disconnect", network, database], phase="isolated_network_disconnect_failed")
    # SQLを読み込む前に外向き通信がないことを確認する。
    remaining = json.loads(run(DOCKER + ["inspect", database, "--format", "{{json .NetworkSettings.Networks}}"], phase="isolated_network_check_failed"))
    if remaining:
        raise BackupError("restore_database_must_have_no_network")
    target = LocalRestore(database)
    target.sql("ALTER SYSTEM SET cron.launch_active_jobs=off;")
    target.sql("SELECT pg_reload_conf();")
    return target


def restore():
    root = workdir()
    files, manifest = unpack(root)
    target = start_isolated_database(root)
    result = restore_files(target, files, manifest)
    json_file(root / "verification.json", result)
    return result


def mark():
    root = workdir()
    release_id = int(os.environ["BACKUP_RELEASE_ID"])
    release = api("/releases/" + str(release_id))
    if not release.get("draft"):
        raise BackupError("backup_release_must_remain_draft")
    success = (root / "verification.json").is_file()
    status = "復元確認：成功（件数・値・RLS・権限・定義を照合）" if success else "復元確認：未完了・失敗（本番適用不可）"
    body = re.sub(r"復元確認：[^\n]*", status, release["body"], count=1)
    api("/releases/" + str(release_id), "PATCH", {"body": body, "draft": True, "name": "DBバックアップ（非公開・" + ("復元確認済み" if success else "要確認") + "） " + os.environ["GITHUB_RUN_ID"]})
    return {"release_id": release_id, "draft": True, "restore_verified": success}


def main():
    os.umask(0o077)
    actions = {"install-cli": install_cli, "create": create, "publish": publish, "download": download, "restore": restore, "mark": mark,
               "readiness": lambda: (passphrase() and probe.connection_environment(os.environ.get("SUPABASE_DB_URL", "")) and {"backup_configuration_ready": True})}
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in actions:
            raise BackupError("unknown_backup_action")
        result = actions[sys.argv[1]]()
        if result is not None:
            print(json.dumps(result, ensure_ascii=False))
            if os.environ.get("GITHUB_ACTIONS") == "true":
                print("::notice title=クラウドDBバックアップ::" + json.dumps(result, ensure_ascii=False))
    except (BackupError, probe.ProbeError) as exc:
        print("::error title=クラウドDBバックアップ::" + str(exc))
        return 1
    except Exception:
        # 例外の変数・SQL・外部応答は公開ログへ出さない。
        print("::error title=クラウドDBバックアップ::unexpected_backup_failure")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
