"""TASK-08 H44: cost-free, schema-only Prod migration rehearsal.

Prod access is READ ONLY. No live user rows are dumped, copied to Stage, or
uploaded as GitHub artifacts. The Postgres schema/ACL/roles/migration names are
read in one snapshot and tested inside an ephemeral network-isolated Supabase
Postgres Docker container. All writes occur solely inside that container.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "supabase/maintenance/event-fixed-pairs"))
import cloud_backup as b  # noqa: E402

PHASE1 = HERE / "147_h41_prod_phase1_additive_candidate.sql"
PHASE2 = HERE / "145_h40_prod_phase2_atomic_cutover_candidate.sql"
GATE = HERE / "149_h42_prod_migration_replay_gate_readonly.sql"

def require(test: bool, code: str) -> None:
    if not test:
        raise b.BackupError(code)

def remote_schema_catalog_query() -> str:
    # Only metadata, never source record rows or tokens.
    return """SELECT json_build_object(
       'public_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),
       'public_functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'),
       'public_rls',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity),
       'public_policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public'),
       'legacy_owner_trigger',(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.club_members'::regclass AND tgname='guard_group_last_main_admin'),
       'legacy_anon_member_select',has_any_column_privilege('anon','public.club_members','SELECT'),
       'legacy_fixed_pairs',to_regclass('public.event_fixed_pair_state') IS NOT NULL,
       'legacy_media',to_regclass('public.profile_media_objects') IS NOT NULL,
       'new_shared_rpc',to_regprocedure('public.get_shared_event(text,text)') IS NOT NULL
    )"""

def isolated(target: b.LocalRestore, sql: str) -> str:
    require(isinstance(target, b.LocalRestore), "H44_nonisolated_target")
    return target.sql("SET ROLE postgres;\n" + sql + "\n").decode().strip()

def query(target: b.LocalRestore, sql: str):
    raw = isolated(target, "BEGIN READ ONLY;\n" + sql.strip().rstrip(";") + ";\nROLLBACK;")
    return json.loads(raw)

def gate(target: b.LocalRestore) -> dict:
    r = query(target, GATE.read_text().replace("BEGIN READ ONLY;", "").replace("ROLLBACK;", "").replace(";", ";"))
    # Gate SQL is a SELECT with JSONB report. When wrapped in BEGIN/ROLLBACK,
    # its DO/CTE statements can be read through the existing psql helper.
    return r["report"]

def restore_schema(target: b.LocalRestore, root: Path, expected_roles: list, function_schemas: list[str]):
    require(isinstance(target, b.LocalRestore), "H44_restore_not_isolated")
    b.restore_application_roles(target, expected_roles)
    target.sql("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated;")
    # Match the already-verified cloud_backup.restore_files sequence:
    # remove packaged Supabase initialization schemas *inside isolated Docker*
    # before restoring their real Prod equivalents. CASCADE never runs on Prod.
    require("public" in function_schemas and
            all(x and not x.startswith("pg_") and
                x not in b.EXCLUDED_SCHEMA - set(b.MANAGED)
                for x in function_schemas),
            "H44_unsafe_schema_inventory")
    for schema in function_schemas:
        target.sql("DROP SCHEMA IF EXISTS " + b.ident(schema) + " CASCADE;")
    target.sql("CREATE SCHEMA IF NOT EXISTS public AUTHORIZATION pg_database_owner; GRANT USAGE ON SCHEMA public TO PUBLIC;")
    # Use the same tested pg_restore rendering and network isolation as
    # cloud_backup.restore_files. No SQL is ever sent to Prod.
    sql_bytes = b.run(
        b.DOCKER + ["run", "--rm", "--interactive", "--network", "none",
                    b.probe.POSTGRES_IMAGE, "pg_restore",
                    "--clean", "--if-exists", "--file", "-"],
        phase="H44_schema_render_failed",
        data=(root / "schema.dump").read_bytes(), timeout=300
    )
    schema_file = root / "schema-only.sql"
    schema_file.write_bytes(sql_bytes)
    target.file(schema_file, replica=True)

def install_history(target: b.LocalRestore, history: list[dict]):
    # Only inside local container. The name/version pairs are Prod metadata;
    # no original migration SQL or user row is copied.
    require(len(history) >= 10 and
            all(isinstance(x.get("version"), str) and isinstance(x.get("name"), str)
                for x in history), "H44_migration_history_invalid")
    values = ",".join("(" + b.literal(x["version"]) + "," + b.literal(x["name"]) +
        ",ARRAY['H44 ephemeral schema-only history']::text[])" for x in history)
    isolated(target, "BEGIN; TRUNCATE supabase_migrations.schema_migrations; "
             "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES "
             + values + "; COMMIT;")

def register(target: b.LocalRestore, name: str, version: str):
    require(name in ("task08_prod_phase1_additive", "task08_prod_phase2_atomic"),
            "H44_unknown_history_name")
    require(version in ("20990101010001", "20990101010002"),
            "H44_unknown_test_version")
    isolated(target, "BEGIN; INSERT INTO supabase_migrations.schema_migrations(version,name,statements)"
             " VALUES (" + b.literal(version) + "," + b.literal(name) +
             ",ARRAY['H44 ephemeral schema-only phase test']::text[]); COMMIT;")

def run() -> None:
    require(os.environ.get("GITHUB_ACTIONS") == "true" and
            os.environ.get("GITHUB_REPOSITORY") == "g-ambe/Padel-match" and
            os.environ.get("GITHUB_REF") == "refs/heads/codex/task-08-group-foundation",
            "H44_trusted_runner_only")
    require(os.environ.get("SUPABASE_DB_URL"), "H44_readonly_DB_secret_missing")
    root = b.workdir()
    require(str(root).startswith(os.environ["RUNNER_TEMP"] + "/"),
            "H44_runner_temp_only")
    root.mkdir(mode=0o700, exist_ok=False)
    try:
        ca = b.probe.custom_ca_file()
        require(ca is not None, "H44_official_CA_required")
        env = b.clean_env()
        env.update(b.probe.connection_environment(os.environ["SUPABASE_DB_URL"]))
        env["PGSSLROOTCERT"] = "/run/padel-supabase-ca.crt"
        env["PGOPTIONS"] = "-c default_transaction_read_only=on"
        print("H44 step 1: Prod schema-only snapshot (no user data rows)", flush=True)
        with b.Snapshot(b.source_prefix(ca), env) as snapshot:
            catalog = snapshot.query(remote_schema_catalog_query())
            require(catalog["legacy_fixed_pairs"] and catalog["legacy_media"] and
                    not catalog["new_shared_rpc"],
                    "H44_not_expected_Prod_baseline")
            roles = snapshot.query(b.ROLE_METADATA)
            inventory = snapshot.query(b.INVENTORY)
            function_schemas = sorted(
                x for x in inventory["schemas"]
                if x in b.MANAGED or
                (x not in b.EXCLUDED_SCHEMA and not x.startswith(("pg_", "timescaledb_", "_timescaledb_")))
            )
            history = snapshot.query(
                "SELECT coalesce(json_agg(json_build_object('version',version,'name',name)"
                " ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations")
            excluded = sorted(b.EXCLUDED_SCHEMA - set(b.MANAGED)) + [
                "pg_*", "timescaledb_*", "_timescaledb_*"]
            snapshot.dump(["--schema-only", "--format=custom",
                           "--exclude-schema=" + "|".join(excluded)],
                          root / "schema.dump")
        print("H44 step 1 PASS: Prod schema/roles/migration names, zero user records", flush=True)
        print("H44 step 2: Start network-isolated Postgres and restore schema", flush=True)
        target = b.start_isolated_database(root)
        restore_schema(target, root, roles, function_schemas)
        install_history(target, history)
        actual = query(target, remote_schema_catalog_query())
        require(actual == catalog, "H44_Prod_schema_metadata_differs")
        print("H44 step 2 PASS: Prod schema fingerprint matches; no external DB writes", flush=True)
        first = gate(target)
        require(first["phase1_eligible"] and not first["phase2_eligible"],
                "H44_Phase1_not_eligible")
        print("H44 step 3: Run actual 6-section Phase1 SQL", flush=True)
        isolated(target, PHASE1.read_text())
        register(target, "task08_prod_phase1_additive", "20990101010001")
        middle = gate(target)
        require(middle["phase2_eligible"] and not middle["phase1_eligible"],
                "H44_Phase1_history_or_Phase2_preflight_failed")
        print("H44 step 3 PASS: Phase1 SQL and migration replay gate", flush=True)
        print("H44 step 4: Run actual 11-section Phase2 SQL", flush=True)
        isolated(target, PHASE2.read_text())
        register(target, "task08_prod_phase2_atomic", "20990101010002")
        after = gate(target)
        require(after["phase1_history_entries"] == 1 and
                after["phase2_history_entries"] == 1 and
                not after["phase1_eligible"] and
                not after["phase2_eligible"] and
                after["owner_transfer_exists"] and
                after["member_count_exists"],
                "H44_Phase2_replay_or_postflight_failed")
        require(query(target, "SELECT json_build_object('n', count(*)) FROM public.events")["n"] == 0,
                "H44_synthetic_baseline_contaminated")
        print("H44 ALL PASS: Phase1+Phase2 SQL on isolated Prod schema, replay guarded", flush=True)
    finally:
        # No backup objects uploaded or persisted after runner exits.
        shutil.rmtree(root, ignore_errors=True)

if __name__ == "__main__":
    try:
        run()
    except (b.BackupError, b.probe.ProbeError) as exc:
        print("::error title=H44 schema-only rehearsal::" + str(exc), flush=True)
        sys.exit(1)
    except Exception as exc:
        # Only Python exception type, never raw exception messages or secrets.
        print("::error title=H44 schema-only rehearsal::unexpected_" +
              type(exc).__name__, flush=True)
        sys.exit(1)
