"""TASK-08 H43: verified production snapshot -> network-isolated local DB.
NO writes to production, staging, GitHub releases or R2; no secrets in log.
A trusted GitHub Actions runner only. Uses existing cloud_backup.py's verified
snapshot/restore pipeline, not a duplicate backup implementation.
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
import cloud_backup as backup  # noqa: E402


PHASE1 = HERE / "147_h41_prod_phase1_additive_candidate.sql"
PHASE2 = HERE / "145_h40_prod_phase2_atomic_cutover_candidate.sql"
GATE = HERE / "149_h42_prod_migration_replay_gate_readonly.sql"

# These are deliberately synthetic versions only within the disposable DB.
SIMULATED_PHASE1_VERSION = "20990101010001"
SIMULATED_PHASE2_VERSION = "20990101010002"


def require(condition: bool, code: str) -> None:
    if not condition:
        raise backup.BackupError(code)


def under_postgres(target: backup.LocalRestore, sql: str) -> str:
    require(isinstance(target, backup.LocalRestore), "not_isolated_local_restore")
    return target.sql("SET ROLE postgres;\n" + sql + "\nRESET ROLE;").decode().strip()


def gate(target: backup.LocalRestore) -> dict:
    raw = under_postgres(target, GATE.read_text())
    result = json.loads(raw)
    report = result.get("report")
    require(isinstance(report, dict), "migration_gate_result_invalid")
    return report


def history(target: backup.LocalRestore, version: str, name: str) -> None:
    # Simulate MCP apply_migration's version/name registration in the
    # disposable DB only, to validate Phase2's dependency guard.
    require(version in {SIMULATED_PHASE1_VERSION, SIMULATED_PHASE2_VERSION},
            "unexpected_synthetic_history_version")
    require(name in {"task08_prod_phase1_additive", "task08_prod_phase2_atomic"},
            "unexpected_history_name")
    under_postgres(target, "INSERT INTO supabase_migrations.schema_migrations"
                   "(version,name,statements) VALUES ("
                   + backup.literal(version) + ","
                   + backup.literal(name) + ","
                   + "ARRAY['H43 ephemeral replay-test; no production SQL']::text[]);")


def only_count_snapshot(target: backup.LocalRestore, manifest: dict) -> list:
    # Include no auth secrets or individual rows in log/return value.
    # For authenticated users, policies, data and constraints, actual restored
    # tables remain intact; new Phase1 directory_refs is intentionally additive.
    keep = [t for t in manifest["tables"]
            if t["schema"] != "supabase_migrations"]
    return backup.row_fingerprints(target.query, keep)


def run() -> None:
    require(os.environ.get("GITHUB_ACTIONS") == "true", "ci_only")
    require(os.environ.get("GITHUB_REPOSITORY") == "g-ambe/Padel-match", "wrong_repository")
    require(os.environ.get("GITHUB_REF") == "refs/heads/codex/task-08-group-foundation", "wrong_branch")
    require(os.environ.get("SUPABASE_DB_URL") and
            os.environ.get("PADEL_BACKUP_PASSPHRASE"),
            "required_existing_secrets_missing")
    for f in (PHASE1, PHASE2, GATE):
        require(f.is_file(), "missing_rehearsal_source")
    root = backup.workdir()
    require(str(root).startswith(os.environ["RUNNER_TEMP"] + "/"),
            "workdir_must_be_runner_temp")
    print("H43 source: verified PostgreSQL 17 production READ-ONLY snapshot; no Stage mutation", flush=True)
    try:
        # Existing trusted method: opens REPEATABLE READ READ ONLY transaction,
        # dumps schema/roles and encrypted data only inside runner temp.
        print("H43 step1: encrypted snapshot, no prod writes", flush=True)
        backup.create()
        files, manifest = backup.unpack(root)
        require(manifest["project_ref"] == backup.probe.PROJECT_REF,
                "unexpected_prod_reference")
        require(manifest["server_major"] == 17, "unexpected_postgres_major")

        # The existing implementation disconnects ALL container networks and
        # strictly compares restored data/row hashes, RLS, ACL and foreign keys.
        print("H43 step2: isolated restore and strict baseline equality", flush=True)
        target = backup.start_isolated_database(root)
        restored = backup.restore_files(target, files, manifest)
        require(restored.get("restore_verified") and
                restored.get("production_mutations") is False,
                "isolated_baseline_not_verified")
        print("H43 restore PASS; isolated container with no network", flush=True)

        before_rows = only_count_snapshot(target, manifest)
        initial = gate(target)
        require(initial["phase1_eligible"] is True and
                initial["phase2_eligible"] is False and
                initial["phase1_history_entries"] == 0,
                "production_baseline_migration_gate_not_ready")

        print("H43 step3: execute real Phase1 SQL on isolated Prod snapshot", flush=True)
        under_postgres(target, PHASE1.read_text())
        require(only_count_snapshot(target, manifest) == before_rows,
                "phase1_modified_existing_rows")
        history(target, SIMULATED_PHASE1_VERSION, "task08_prod_phase1_additive")
        middle = gate(target)
        require(middle["phase1_eligible"] is False and
                middle["phase2_eligible"] is True and
                middle["phase1_history_entries"] == 1,
                "phase1_commit_or_phase2_dependency_invalid")
        print("H43 Phase1 PASS: 6 steps, original data unchanged, Phase2 now eligible", flush=True)

        print("H43 step4: execute real Phase2 SQL on the same isolated database", flush=True)
        under_postgres(target, PHASE2.read_text())
        require(only_count_snapshot(target, manifest) == before_rows,
                "phase2_modified_existing_rows")
        history(target, SIMULATED_PHASE2_VERSION, "task08_prod_phase2_atomic")
        after = gate(target)
        require(after["phase1_eligible"] is False and
                after["phase2_eligible"] is False and
                after["phase1_history_entries"] == 1 and
                after["phase2_history_entries"] == 1 and
                after["owner_transfer_exists"] is True and
                after["member_count_exists"] is True,
                "phase2_postflight_or_replay_guard_invalid")
        print("H43 Phase2 PASS: 11 steps, existing data unchanged; replay rejected by gate", flush=True)
        print("H43 ALL PASS: no external DB writes, no permanent Cloud resource, no extra Supabase branch", flush=True)
    finally:
        # Do not publish, upload or retain user data or the backup archive.
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    try:
        run()
    except (backup.BackupError, backup.probe.ProbeError) as err:
        # Trusted helpers return fixed error codes only, not SQL or DB URLs.
        print("::error title=H43 isolated rehearsal::" + str(err), flush=True)
        sys.exit(1)
    except Exception:
        print("::error title=H43 isolated rehearsal::unexpected_error_details_hidden", flush=True)
        sys.exit(1)
