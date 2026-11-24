"""Focused real Auth/PostgREST/OpenNext/R2-local integration; no hosted access.
Uses an already-started fresh CLI project in a private temp directory.
Never captures production schema/data, never runs db push or deploy.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import secrets
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlsplit

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
TEMP = pathlib.Path(os.environ["RUNNER_TEMP"])
spec = importlib.util.spec_from_file_location("local_auth", HERE.parent / "group-foundation/172_h55_local_auth_http_environment.py")
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)
local.ROOT = TEMP / "stack"
local.DB = "supabase_db_group-avatar-final"
local.ENV.update(SUPABASE_HOME=str(TEMP / "supabase-config"))
URL = "http://127.0.0.1:54321"
MIGRATION = REPO / "supabase/migrations/20261124104619_group_member_avatar_read.sql"
EXPECTED = "c58d8b7de3e4540486f578b295a705609797a41c2dadd0708a6fbde6a93f4dc6"
release_spec = importlib.util.spec_from_file_location("avatar_release", HERE / "04_render_manual_release.py")
release = importlib.util.module_from_spec(release_spec)
release_spec.loader.exec_module(release)

def require(ok, phase):
    local.require(ok, phase)

def query(sql):
    return json.loads(local.sql(sql))

def call(args, phase, env=None, data=None, timeout=60):
    r = subprocess.run([str(x) for x in args], cwd=REPO, env=env or local.ENV,
                       input=data, text=True, capture_output=True, timeout=timeout)
    require(r.returncode == 0, phase + "_exit_" + str(r.returncode))
    return r.stdout

def main():
    require(TEMP == pathlib.Path("/tmp/group-avatar-final"), "dedicated_temp_required")
    config = (TEMP / "stack/supabase/config.toml").read_text()
    require('project_id = "group-avatar-final"' in config, "local_project_required")
    info = json.loads(local.cli(["status", "--output", "json"], "local_status"))
    api = urlsplit(info.get("API_URL", ""))
    require(api.hostname in ("127.0.0.1", "localhost") and api.port == 54321, "local_api_target")
    key = info.get("ANON_KEY")
    require(isinstance(key, str), "local_anon_key_missing")
    # Supabase 3 also supplies publishable keys; use its legacy anon JWT here.
    import base64
    token_data = json.loads(base64.urlsafe_b64decode(key.split(".")[1] + "=="))
    require(token_data.get("role") == "anon", "anon_key_role")
    status, _ = local.request(URL, "/auth/v1/health", key)
    require(status == 200, "real_auth_health_http_" + str(status))
    print("PASS: direct local Auth HTTP health (Docker probe status is separate)", flush=True)
    network = json.loads(local.run(local.DOCKER + ["network", "inspect", "group-avatar-final-local"], "inspect_network"))[0]
    containers = list(network.get("Containers", {}))
    require(containers, "local_network_empty")
    for container in json.loads(local.run(local.DOCKER + ["inspect", *containers], "inspect_containers")):
        require(container["Name"].endswith("_group-avatar-final"), "unexpected_project")
        for bindings in (container["NetworkSettings"]["Ports"] or {}).values():
            require(all(b["HostIp"] in ("127.0.0.1", "::1") for b in bindings or []), "non_loopback_service")
    require(query("SELECT to_json(to_regclass('public.player_profiles') IS NULL)") is True, "fresh_synthetic_database_required")
    require(hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == EXPECTED, "migration_hash")
    actors = []
    for role in ("owner", "viewer", "outsider", "admin"):
        actor = {"role": role, "email": "avatar-" + secrets.token_hex(5) + "@example.test", "password": secrets.token_urlsafe(24)}
        status, value = local.request(URL, "/auth/v1/signup", key, body={"email": actor["email"], "password": actor["password"]})
        require(status == 200 and value.get("user", {}).get("id"), "real_signup_" + role)
        actor["uid"] = str(uuid.UUID(value["user"]["id"]))
        actors.append(actor)
    print("PASS: four disposable real Auth signups", flush=True)
    ids = {a["role"]: a["uid"] for a in actors}
    ids.update({k: str(uuid.uuid4()) for k in ("owner_profile", "viewer_profile", "admin_profile", "outsider_profile", "club", "other_club", "target", "viewer_member", "admin_member")})
    literal = lambda value: "'" + str(uuid.UUID(value)) + "'::uuid"
    local.sql((REPO / "tests/fixtures/group-avatar-local-schema.sql").read_text())
    for filename in ("0048_private_profile_media.sql", "0049_profile_avatar_position.sql"):
        local.sql((REPO / "supabase/migrations" / filename).read_text())
    source = (REPO / "supabase/migrations/0054_group_read_interfaces.sql").read_text()
    local.sql(source[source.index("CREATE FUNCTION group_read_private.member("):source.index("CREATE FUNCTION group_read_private.require_member(")])
    local.sql("""REVOKE ALL ON FUNCTION group_read_private.member(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION group_read_private.member(uuid) TO authenticated;
ALTER TABLE public.player_profile_private ADD COLUMN home_court_name text, ADD COLUMN home_court_version bigint NOT NULL DEFAULT 0,
 ADD COLUMN home_facility_id uuid CONSTRAINT profile_home_facility_fkey REFERENCES public.padel_facilities(id);
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON public.clubs TO authenticated;
GRANT SELECT,UPDATE(is_active) ON public.club_members TO authenticated;
CREATE POLICY synthetic_clubs_read ON public.clubs FOR SELECT TO authenticated USING(visibility='public' OR owner_id=auth.uid() OR group_read_private.member(id));
CREATE POLICY synthetic_clubs_update ON public.clubs FOR UPDATE TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
CREATE POLICY synthetic_members_read ON public.club_members FOR SELECT TO authenticated USING(group_read_private.member(club_id));
CREATE POLICY synthetic_members_update ON public.club_members FOR UPDATE TO authenticated USING(EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=club_id AND c.owner_id=auth.uid())) WITH CHECK(EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=club_id AND c.owner_id=auth.uid()));""")
    for actor in actors:
        local.sql(f"INSERT INTO public.player_profiles VALUES({literal(ids[actor['role']+'_profile'])},{literal(actor['uid'])},'Synthetic {actor['role']}',true);")
    local.sql(f"""INSERT INTO public.clubs VALUES({literal(ids['club'])},{literal(ids['admin'])},'Synthetic private',true,false,'private'),({literal(ids['other_club'])},{literal(ids['outsider'])},'Other group',true,false,'private');
INSERT INTO public.club_members VALUES({literal(ids['target'])},{literal(ids['club'])},{literal(ids['owner_profile'])},{literal(ids['owner'])},true,'member'),({literal(ids['viewer_member'])},{literal(ids['club'])},{literal(ids['viewer_profile'])},{literal(ids['viewer'])},true,'member'),({literal(ids['admin_member'])},{literal(ids['club'])},{literal(ids['admin_profile'])},{literal(ids['admin'])},true,'main_admin');""")
    # History scaffold is local-only when absent, never a production migration.
    local.sql("CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);")
    history_before = query("SELECT coalesce(json_agg(to_jsonb(t) ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations t")
    catalog_sql = """SELECT json_build_object(
 'relations',(SELECT json_agg(json_build_array(n.nspname,c.relname,c.relacl::text,c.relrowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','profile_media_private','group_read_private') AND c.relkind IN ('r','p')),
 'policies',(SELECT json_agg(to_jsonb(t) ORDER BY schemaname,tablename,policyname) FROM pg_policies t WHERE schemaname IN ('public','profile_media_private','group_read_private')),
 'existing_functions',(SELECT json_agg(json_build_array(p.oid::int,md5(pg_get_functiondef(p.oid)),p.proacl::text) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','profile_media_private','group_read_private') AND p.prokind='f' AND p.proname<>'get_group_member_avatar_for_worker'))"""
    catalog_before = query(catalog_sql)
    # Test the exact manual package, including rollback of a final-statement failure.
    package = release.render()
    try:
        local.sql(package.rsplit("COMMIT;", 1)[0] + "SELECT 1/0; COMMIT;")
    except RuntimeError as error:
        require("22012" in str(error), "unexpected_injection_failure")
    else:
        require(False, "injection_not_rejected")
    require(query("SELECT to_json(to_regprocedure('public.get_group_member_avatar_for_worker(uuid,uuid,text)') IS NULL)") is True, "failed_ddl_survived")
    require(query("SELECT coalesce(json_agg(to_jsonb(t) ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations t") == history_before, "failed_history_survived")
    local.sql(package)
    require(query(catalog_sql) == catalog_before, "existing_acl_policy_or_function_changed")
    history_after = query("SELECT coalesce(json_agg(to_jsonb(t) ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations t")
    require(history_after[:-1] == history_before and history_after[-1]["version"] == release.VERSION and history_after[-1]["name"] == release.NAME, "history_registration")
    contract = query("""SELECT json_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'stable',provolatile='s','search_path',proconfig @> ARRAY['search_path=""'],
 'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE'))
 FROM pg_proc WHERE oid='public.get_group_member_avatar_for_worker(uuid,uuid,text)'::regprocedure;""")
    require(contract == {"owner": "postgres", "definer": True, "stable": True, "search_path": True, "anon": False, "authenticated": True, "service": False}, "sql_contract")
    proof = secrets.token_hex(32)
    hashed = hashlib.sha256(proof.encode()).hexdigest()
    local.sql("INSERT INTO profile_media_private.settings VALUES(true,decode('" + hashed + "','hex')); NOTIFY pgrst,'reload schema';")
    print("PASS: exact Migration/PostgreSQL owner, types, ACL and private proof contract", flush=True)
    env = {**local.ENV, "PATH": "/tmp/task08-h62-bun/node_modules/.bin:" + local.ENV["PATH"],
           "NEXT_PUBLIC_SUPABASE_URL": URL, "NEXT_PUBLIC_SUPABASE_ANON_KEY": key,
           "NEXT_TELEMETRY_DISABLED": "1", "WRANGLER_SEND_METRICS": "false", "CI": "true",
           "WRANGLER_LOG_PATH": str(TEMP / "wrangler"), "NODE_PATH": "/tmp/group-avatar-browser/node_modules"}
    # Reuse an earlier successful build only if source, local public key and BUILD_ID match.
    paths = call(["git", "ls-files", "app", "components", "lib", "scripts", "package.json", "bun.lock", "next.config.ts", "open-next.config.ts", "wrangler.jsonc"], "build_sources").splitlines()
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.encode() + b"\0" + (REPO / path).read_bytes())
    context = {"url": URL, "key_hash": hashlib.sha256(key.encode()).hexdigest(), "code_hash": digest.hexdigest()}
    previous = TEMP / "build-context.json"
    cached = json.loads(previous.read_text()) if previous.exists() else {}
    build_id = REPO / ".next/BUILD_ID"
    reusable = all(cached.get(k) == v for k, v in context.items()) and build_id.exists() and cached.get("build_id") == build_id.read_text().strip()
    if not reusable:
        call(["npm", "run", "cf:build"], "real_local_key_build", env, timeout=600)
    call(["node", "-e", "if(!require('./scripts/ensure-cloudflare-worker.cjs').current())process.exit(1)"], "build_id", env)
    previous.write_text(json.dumps({**context, "build_id": build_id.read_text().strip()}))
    print("PASS: actual-local-key OpenNext " + ("build reused" if reusable else "build") + "; no deployment", flush=True)
    with (TEMP / "worker.log").open("w") as log:
        worker = subprocess.Popen([str(REPO / "node_modules/.bin/wrangler"), "dev", "--local", "--ip", "127.0.0.1", "--port", "3070", "--persist-to", str(TEMP / "r2-state"), "--config", str(REPO / "wrangler.jsonc"), "--var", "PROFILE_MEDIA_COMMIT_SECRET:" + proof], cwd=REPO, env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for _ in range(90):
                require(worker.poll() is None, "local_worker_exited")
                try:
                    with opener.open("http://127.0.0.1:3070/login", timeout=2) as response:
                        if response.status == 200: break
                except (OSError, urllib.error.URLError): pass
                time.sleep(1)
            else: require(False, "local_worker_timeout")
            payload = json.dumps({"url": URL, "key": key, "actors": actors, "ids": ids, "proof": proof})
            # Synthetic local credentials only; private temporary checkpoint, removed in cleanup.
            checkpoint = TEMP / "fixture.json"
            with open(checkpoint, "w", opener=lambda path, flags: os.open(path, flags, 0o600)) as output:
                output.write(payload)
            report = json.loads(call(["node", str(REPO / "tests/integration/group-member-avatars-real.cjs")], "real_http", env, data=payload, timeout=180))
            if report.get("ok") is not True:
                print("FAIL: integration phase=" + str(report.get("phase")) + " status=" + str(report.get("httpStatus")) + " checks=" + str(report.get("checks")), flush=True)
                require(False, "real_http_assertion")
            print("PASS: real Auth/PostgREST/Worker/R2-local checks=" + str(report["checks"]), flush=True)
            invariant = query("SELECT json_build_object('committed',(SELECT count(*)=3 FROM profile_media_operations WHERE status='committed'),'viewer_quota_untouched',(SELECT count(*)=0 FROM profile_media_attempts WHERE actor_id=" + literal(ids["viewer"]) + "),'image_deleted',(SELECT avatar_key IS NULL AND avatar_version=3 FROM player_profile_private WHERE profile_id=" + literal(ids["owner_profile"]) + ")); ")
            require(all(v is True for v in invariant.values()), "postconditions")
            print("PASS: independent DB confirms owner edits and no reader mutation quota", flush=True)
        finally:
            if worker.poll() is None:
                os.killpg(worker.pid, signal.SIGTERM)
                try: worker.wait(timeout=15)
                except subprocess.TimeoutExpired: os.killpg(worker.pid, signal.SIGKILL); worker.wait()

if __name__ == "__main__":
    try: main()
    except Exception as error:
        # No raw responses, emails, credentials, proof, keys or SQL text in logs.
        print("FAIL: " + (str(error) if isinstance(error, RuntimeError) else type(error).__name__), flush=True)
        sys.exit(1)
