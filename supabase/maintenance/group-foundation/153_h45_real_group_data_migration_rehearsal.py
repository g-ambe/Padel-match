"""TASK-08 / H45: Prod-read-only, reduced real-group-data Phase1/Phase2 test.

Only explicitly allowlisted columns from 6 small group-related tables are
read; no auth.users, email, passwords, bios, images, tokens, event scores,
notification bodies, or other tables. No source rows are printed or uploaded.
Real rows exist only in this runner's memory and network-isolated PostgreSQL
and are deleted when the job finishes. Never run on hosted Stage/Prod DB.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("task08_h44", HERE / "151_h43_cost_free_isolated_rehearsal.py")
assert spec and spec.loader
h44 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h44)
b = h44.b
require = h44.require

# Explicit allowlist: no arbitrary SELECT *, account secrets, or JWT/session rows.
FIELDS = {
    "profiles": ("id", "display_name"),
    "player_profiles": ("id", "display_name", "linked_auth_user_id", "created_at",
                        "is_active", "created_by_auth_user_id"),
    "clubs": ("id", "name", "owner_id", "created_at", "is_active",
              "visibility", "is_deleted", "deleted_at", "main_facility_id"),
    "club_members": ("id", "club_id", "profile_id", "role", "created_at",
                     "player_profile_id", "is_active", "status"),
    "join_requests": ("id", "club_id", "target_club_member_id",
                      "requester_auth_user_id", "requester_player_profile_id",
                      "status", "reviewed_by_auth_user_id", "reviewed_at",
                      "created_at", "consent_source_player_profile_id",
                      "consent_at", "expires_at", "requester_display_name_snapshot"),
    "player_profile_link_requests": (
        "id", "club_id", "source_club_member_id", "source_player_profile_id",
        "target_auth_user_id", "expected_target_player_profile_id",
        "requested_by_auth_user_id", "status", "created_at", "expires_at",
        "reviewed_by_auth_user_id", "reviewed_at"),
}
MAX_ROWS = {"profiles": 500, "player_profiles": 1000, "clubs": 100,
            "club_members": 1000, "join_requests": 500,
            "player_profile_link_requests": 500}
# Output only aggregation, not identities. Actual user rows never sent to GitHub
# artifacts, a managed staging database, or a hosted Supabase branch.

def rows_sql() -> str:
    sections = []
    for table, columns in FIELDS.items():
        fields = ",".join(b.ident(c) for c in columns)
        sections.append(
            b.literal(table) + ",coalesce((SELECT json_agg(row_to_json(q) ORDER BY q.id)"
            " FROM (SELECT " + fields + " FROM public." + b.ident(table)
            + " ORDER BY id) q),'[]'::json)"
        )
    return "SELECT json_build_object(" + ",".join(sections) + ")"

def validate(data: dict) -> None:
    require(set(data) == set(FIELDS), "H45_table_allowlist_violation")
    for table, records in data.items():
        require(isinstance(records, list) and len(records) <= MAX_ROWS[table],
                "H45_table_row_limit")
        require(all(isinstance(r, dict) and set(r) == set(FIELDS[table])
                    for r in records), "H45_column_allowlist_violation")
        require(len({str(r["id"]) for r in records}) == len(records),
                "H45_source_duplicate_ids")
    require(len(data["clubs"]) >= 3 and len(data["club_members"]) >= 10
            and len(data["player_profiles"]) >= 10,
            "H45_source_group_rows_unexpected")
    all_clubs = {r["id"] for r in data["clubs"]}
    all_players = {r["id"] for r in data["player_profiles"]}
    require(all(r["club_id"] in all_clubs and
                (r["player_profile_id"] is None or
                 r["player_profile_id"] in all_players)
                for r in data["club_members"]),
            "H45_incomplete_group_subset")
    require(all(r["club_id"] in all_clubs for r in data["join_requests"]),
            "H45_join_request_group_missing")

def digest(data: dict) -> str:
    return hashlib.sha256(json.dumps(data, ensure_ascii=False, sort_keys=True,
                                   separators=(",", ":")).encode("utf-8")).hexdigest()

def sql_literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    require(isinstance(value, str) and len(value) < 4096,
            "H45_unexpected_source_value_type_or_size")
    return b.literal(value)

def load_rows(target, data: dict) -> None:
    require(isinstance(target, b.LocalRestore), "H45_copy_target_not_isolated")
    inserts = []
    # Data is loaded with FK and audit triggers disabled ONLY inside isolated
    # Docker; auth.users is deliberately not copied. Phase SQL runs normally.
    for table, records in data.items():
        if not records:
            continue
        columns = FIELDS[table]
        cols = ",".join(b.ident(c) for c in columns)
        values = ",".join(
            "(" + ",".join(sql_literal(record[c]) for c in columns) + ")"
            for record in records
        )
        inserts.append("INSERT INTO public." + b.ident(table) +
                       "(" + cols + ") VALUES " + values + ";")
    target.sql("BEGIN; SET ROLE postgres; SET LOCAL session_replication_role=replica;\n"
               + "\n".join(inserts) +
               "\nCOMMIT;")
    verify = target.query(rows_sql())
    require(digest(verify) == digest(data), "H45_real_row_copy_not_exact")
    print("H45 group subset copied and independently re-read: "
          + ",".join(t + "=" + str(len(data[t])) for t in FIELDS), flush=True)

def preflight_stats(data: dict) -> dict:
    profiles = {r["id"]: r for r in data["player_profiles"]}
    clubs = {r["id"]: r for r in data["clubs"]}
    linked = unlinked = public_clubs = 0
    owner_null = 0
    count_by_club: dict[str, dict[str, int]] = {}
    for club in data["clubs"]:
        if club["is_active"] and not club["is_deleted"]:
            owner_null += int(club["owner_id"] is None)
        if club["is_active"] and not club["is_deleted"] and club["visibility"] == "public":
            public_clubs += 1
            count_by_club[club["id"]] = {"total": 0, "unlinked": 0}
    for m in data["club_members"]:
        c = clubs.get(m["club_id"])
        p = profiles.get(m["player_profile_id"])
        if not c or not p or c["id"] not in count_by_club:
            continue
        if m["is_active"] and m["status"] == "active" and p["is_active"]:
            count_by_club[c["id"]]["total"] += 1
            if p["linked_auth_user_id"] is None:
                unlinked += 1
                count_by_club[c["id"]]["unlinked"] += 1
            else:
                linked += 1
    return {"public_clubs": public_clubs, "public_active_linked": linked,
            "public_active_unlinked": unlinked, "owner_null_active": owner_null,
            "per_public_club": count_by_club}

def check_early(target, data: dict, baseline_hash: str) -> None:
    require(digest(target.query(rows_sql())) == baseline_hash,
            "H45_source_rows_mutated_during_phase1")
    expected = len(data["club_members"])
    refs = target.query("SELECT json_build_object('n',count(*)) FROM group_read_private.directory_refs")
    require(refs.get("n") == expected, "H45_directory_ref_backfill_mismatch")
    print("H45 Phase1: real-membership directory_refs backfill equal to membership rows", flush=True)

def check_late(target, data: dict, baseline_hash: str, counts: dict) -> None:
    require(digest(target.query(rows_sql())) == baseline_hash,
            "H45_source_rows_mutated_during_phase2")
    field_state = target.query("""SELECT json_build_object(
        'members',(SELECT count(*) FROM public.club_members),
        'new_alias_nonnull',(SELECT count(*) FROM public.club_members
            WHERE club_display_name IS NOT NULL),
        'public_name_consent_nonnull',(SELECT count(*) FROM public.club_members
            WHERE club_display_name_public_confirmed_at IS NOT NULL),
        'anon_member_select',has_any_column_privilege('anon','public.club_members','SELECT'),
        'owner_request_count',(SELECT count(*) FROM public.club_owner_transfer_requests)
    )""")
    require(field_state["members"] == len(data["club_members"]) and
            field_state["new_alias_nonnull"] == 0 and
            field_state["public_name_consent_nonnull"] == 0 and
            field_state["anon_member_select"] is False and
            field_state["owner_request_count"] == 0,
            "H45_postphase2_alias_consent_or_owner_policy_invalid")

    # Real club/member data, test-only JWT UUID; returning only counts and no names.
    # A linked member remains hidden until explicit consent, while unlinked
    # temporary members stay visible in the directory.
    for club_id, expected in counts["per_public_club"].items():
        statement = (
            "BEGIN READ ONLY; SET LOCAL ROLE authenticated;"
            "SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';"
            "SELECT json_build_object("
            "'member_count',public.get_public_club_member_count(" + b.literal(club_id) + "::uuid),"
            "'directory_count',(SELECT count(*) FROM public.get_public_club_directory(" +
            b.literal(club_id) + "::uuid)));"
            "ROLLBACK;"
        )
        raw = target.sql(statement).decode().strip()
        response = json.loads(raw)
        require(response["member_count"] == expected["total"] and
                response["directory_count"] == expected["unlinked"],
                "H45_real_public_club_count_or_consent_mismatch")
    print("H45 Phase2: old columns byte-for-byte equal; public count/consent"
          " verified for each real public club", flush=True)
    print("H45 totals: public_groups=" + str(counts["public_clubs"]) +
          " linked_hidden_until_consent=" + str(counts["public_active_linked"]) +
          " unlinked_visible=" + str(counts["public_active_unlinked"]) +
          " owner_unset=" + str(counts["owner_null_active"]), flush=True)

def main() -> None:
    require(os.getenv("GITHUB_ACTIONS") == "true" and
            os.getenv("GITHUB_REPOSITORY") == "g-ambe/Padel-match" and
            os.getenv("GITHUB_REF") == "refs/heads/codex/task-08-group-foundation",
            "H45_trusted_runner_only")
    require(os.getenv("SUPABASE_DB_URL"), "H45_readonly_Prod_URL_missing")
    root = b.workdir()
    require(str(root).startswith(os.environ["RUNNER_TEMP"] + "/"),
            "H45_runner_temp_only")
    root.mkdir(mode=0o700, exist_ok=False)
    h48 = None
    h50 = None
    h51 = None
    h50_baseline = None
    legacy_data = None
    legacy_cols = None
    if os.environ.get("TASK08_H48_REAL_LEGACY_TEST") == "1":
        module_spec = importlib.util.spec_from_file_location(
            "task08_h48", HERE / "159_h48_real_legacy_data_preservation.py")
        require(module_spec is not None and module_spec.loader is not None,
                "H48_module_not_present")
        h48 = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(h48)
    if os.environ.get("TASK08_H50_ROLLBACK_TEST") == "1":
        require(h48 is not None, "H50_requires_H48_full_legacy")
        module_spec = importlib.util.spec_from_file_location(
            "task08_h50", HERE / "162_h50_post_commit_rollback_rehearsal.py")
        require(module_spec is not None and module_spec.loader is not None,
                "H50_module_not_present")
        h50 = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(h50)
    if os.environ.get("TASK08_H51_SAFE_FORWARD_FIX_TEST") == "1":
        require(h48 is not None, "H51_requires_H48_full_legacy")
        module_spec = importlib.util.spec_from_file_location(
            "task08_h51", HERE / "165_h51_postcommit_no_loss_guard_rehearsal.py")
        require(module_spec is not None and module_spec.loader is not None,
                "H51_module_not_present")
        h51 = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(h51)
    try:
        ca = b.probe.custom_ca_file()
        require(ca is not None, "H45_CA_missing")
        env = b.clean_env()
        env.update(b.probe.connection_environment(os.environ["SUPABASE_DB_URL"]))
        env["PGSSLROOTCERT"] = "/run/padel-supabase-ca.crt"
        env["PGOPTIONS"] = "-c default_transaction_read_only=on"
        print("H45: source production is REPEATABLE READ / READ ONLY", flush=True)
        with b.Snapshot(b.source_prefix(ca), env) as snapshot:
            catalog = snapshot.query(h44.remote_schema_catalog_query())
            require(catalog["legacy_fixed_pairs"] and catalog["legacy_media"] and
                    not catalog["new_shared_rpc"], "H45_not_original_Prod_schema")
            roles = snapshot.query(b.ROLE_METADATA)
            inventory = snapshot.query(b.INVENTORY)
            function_schemas = sorted(
                x for x in inventory["schemas"] if x in b.MANAGED or
                (x not in b.EXCLUDED_SCHEMA and
                 not x.startswith(("pg_", "timescaledb_", "_timescaledb_")))
            )
            history = snapshot.query(
                "SELECT coalesce(json_agg(json_build_object('version',version,'name',name)"
                " ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations")
            data = snapshot.query(rows_sql())
            validate(data)
            if h48 is not None:
                legacy_cols = snapshot.query(h48.columns_sql(b))
                legacy_data = snapshot.query(h48.rows_sql(b))
                h48.validate(legacy_data, legacy_cols, require)
                print("H48: read-only Prod snapshot includes full legacy event/media"
                      " records in ephemeral runner memory", flush=True)
            excluded = sorted(b.EXCLUDED_SCHEMA - set(b.MANAGED)) + [
                "pg_*", "timescaledb_*", "_timescaledb_*"]
            snapshot.dump(["--schema-only", "--format=custom",
                           "--exclude-schema=" + "|".join(excluded)],
                          root / "schema.dump")
        print("H45: exact Prod schema and small group-only real-data subset captured", flush=True)
        target = b.start_isolated_database(root)
        h44.restore_schema(target, root, roles, function_schemas)
        h44.install_history(target, history)
        require(h44.query(target, h44.remote_schema_catalog_query()) == catalog,
                "H45_Prod_schema_fingerprint_mismatch")
        assert h44.gate(target)["phase1_eligible"]
        load_rows(target, data)
        baseline_hash = digest(data)
        counts = preflight_stats(data)
        h48_baseline = None
        h48_integrity = None
        if h48 is not None:
            require(legacy_data is not None and legacy_cols is not None,
                    "H48_missing_legacy_snapshot")
            h48_baseline = h48.load(target,b,legacy_data,legacy_cols,require,
                                    sys.modules[__name__])
            h48_integrity = target.query(h48.integrity_sql())
            h48.verify(target,b,legacy_data,legacy_cols,h48_baseline,
                       h48_integrity,require,sys.modules[__name__],"before_phase1")
        if h50 is not None:
            h50_baseline = h50.capture(target,sys.modules[__name__],require)
        print("H45: real subset restored; Phase1 migration begins", flush=True)
        h44.isolated(target, h44.PHASE1.read_text())
        h44.register(target, "task08_prod_phase1_additive", "20990101010001")
        check_early(target, data, baseline_hash)
        if h48 is not None:
            h48.verify(target,b,legacy_data,legacy_cols,h48_baseline,
                       h48_integrity,require,sys.modules[__name__],"after_phase1")
        require(h44.gate(target)["phase2_eligible"], "H45_phase2_gate_not_ready")
        print("H45: Phase1 real rows PASS; Phase2 migration begins", flush=True)
        h44.isolated(target, h44.PHASE2.read_text())
        h44.register(target, "task08_prod_phase2_atomic", "20990101010002")
        check_late(target, data, baseline_hash, counts)
        if h48 is not None:
            h48.verify(target,b,legacy_data,legacy_cols,h48_baseline,
                       h48_integrity,require,sys.modules[__name__],"after_phase2")
        final = h44.gate(target)
        require(final["phase1_history_entries"] == 1 and
                final["phase2_history_entries"] == 1 and
                not final["phase1_eligible"] and not final["phase2_eligible"],
                "H45_repeat_application_prevention_failed")
        print("H45 ALL PASS: real club/membership subset survived Phase1 + Phase2;"
              " no Prod/Stage writes", flush=True)
        if h51 is not None:
            require(h48_baseline is not None and h48_integrity is not None,
                    "H51_baseline_missing")
            h51.run(target,data,legacy_data,legacy_cols,h48_baseline,
                    h48_integrity,require,b,h44,sys.modules[__name__],h48)
        if h50 is not None:
            require(h50_baseline is not None and h48_baseline is not None
                    and h48_integrity is not None, "H50_baseline_missing")
            h50.run(target,root,roles,function_schemas,history,catalog,
                    data,legacy_data,legacy_cols,h48_baseline,h48_integrity,
                    h50_baseline,require,b,h44,sys.modules[__name__],h48)
        if os.environ.get("TASK08_H46_REAL_ROLE_TEST") == "1":
            spec_role = importlib.util.spec_from_file_location(
                "task08_h46", HERE / "155_h46_real_membership_role_rollback.py")
            require(spec_role is not None and spec_role.loader is not None,
                    "H46_test_module_missing")
            h46 = importlib.util.module_from_spec(spec_role)
            spec_role.loader.exec_module(h46)
            h46.run(target, data, require, b, h44, sys.modules[__name__])
    finally:
        # Personal data remains ephemeral; never upload logs, dumps or artifacts.
        shutil.rmtree(root, ignore_errors=True)

if __name__ == "__main__":
    try:
        main()
    except (b.BackupError, b.probe.ProbeError) as exc:
        print("::error title=H45 real-data isolated rehearsal::" + str(exc), flush=True)
        raise SystemExit(1)
    except Exception as exc:
        print("::error title=H45 real-data isolated rehearsal::unexpected_"
              + type(exc).__name__, flush=True)
        raise SystemExit(1)
