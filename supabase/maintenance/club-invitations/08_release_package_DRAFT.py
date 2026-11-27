"""TASK-08-02 offline release package compiler DRAFT. Never applies SQL.
Use a version allocated by Supabase CLI in a disposable workspace after
checking main, open PRs and approved target history. Output is maintenance
SQL for separately reviewed manual release, not an auto-applied migration.
The local-test gate must use an explicitly reviewed synthetic baseline copy.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "05_formal_install_CANDIDATE.sql"
SOURCE_SHA256 = "69e565b8a1fe0ba68207ba129b94c32c4c239f97062695e29443e9755a524e6b"
NAME = "task08_club_invitations"
BASELINE = (
    ("0047", "event_result_video"),
    ("0048", "private_profile_media"),
    ("0049", "profile_avatar_position"),
    ("0050", "private_profile_home_court"),
    ("0051", "shared_home_facility"),
    ("0052", "jpa_existing_facility_corrections"),
    ("0053", "jpa_add_15_facilities"),
    ("20261026080052", "security_emergency_revoke_anon_writes_official_open_access_20261026"),
    ("20261030013638", "rls01_clubs_update_main_admin"),
    ("20261030015325", "rls02_clubs_delete_denied"),
    ("20261030023350", "rls03_clubs_insert_self"),
    ("20261030033535", "rls04a_shared_official_club_name"),
    ("20261030040526", "rls04c_clubs_select_visible"),
    ("20261030043914", "events_identity_guard"),
    ("20261030050944", "rls_batch01_event_insert_delete_and_truncate"),
    ("20261030054948", "close_unused_player_stats_client_access"),
    ("20261030072912", "restrict_event_participants_insert_update"),
    ("20261030080501", "restrict_match_data_delete_and_guard_identities"),
    ("20261030084101", "restrict_match_data_insert_update"),
    ("20261102024320", "restrict_event_updates_preserve_member_operations"),
    ("20261102050844", "restrict_event_scope_select_and_shared_tokens"),
    ("20261102054001", "allow_active_members_to_rename_friendly_events"),
    ("20261124044001", "task08_prod_phase1_additive"),
    ("20261124044002", "task08_prod_phase2_atomic"),
    ("20261124044003", "task08_prod_share_anon_close"),
    ("20261124091915", "task08_allow_active_members_to_manage_friendly_sharing"),
    ("20261124230702", "group_member_avatar_read"),
    ("20261125010835", "nonfixed_round_lineup_protection"),
    ("20261125010859", "home_court_master_only"),
    ("20261125032915", "group_member_public_choice"),
)
# Current production metadata read-only 2026-11-27; the RPC prosrc also
# exactly matches 0041. Definition hashes include function configuration.
SCORE_DEFINITIONS = (
    ("lineup_private.can_operate(uuid)", "cd62e47daeeac96d017655e9ef1a20fe"),
    ("lineup_private.check_direct(uuid, uuid, text, uuid)", "0fee9af50d4003350e5093209fc3308c"),
    ("lineup_private.guard_direct()", "59403885ef1ce569d1c4fd03b0399209"),
    ("lineup_private.lock_event(uuid)", "31ca9b4f784db9765197f5874061f4e9"),
    ("lineup_private.players(uuid)", "6fb2cfe476249348262fc889e4b7d6af"),
    ("lineup_private.revision(uuid)", "d563895827556e7fd9d5bdbfbca52194"),
    ("lineup_private.score(uuid)", "d3cf20fc49c2ca136dd4487b1de7ff63"),
    ("lineup_private.snapshot(uuid, uuid)", "51b75a6994d2fe95861c6295b9835d9e"),
    ("public.get_friendly_lineup_versions(uuid)", "5120762f97a0d8d45636feb038ff0649"),
    ("public.get_friendly_round_lineup(uuid, uuid)", "e377870b9fd6d12753e1c0381983b12d"),
    ("public.save_friendly_match_score(uuid, uuid, bigint, jsonb, jsonb, integer, integer, uuid)", "8adf6144a9e8a5b48cb6d2c1160c9508"),
)

def require(ok, message):
    if not ok:
        raise ValueError(message)

def quote(s):
    return "'" + s.replace("'", "''") + "'"

def dollar(s, tag):
    d = "$" + tag + "$"
    require(d not in s, "history dollar delimiter collision")
    return d + s + d

def history_gate(expected, tag):
    expected_json = json.dumps(expected, separators=(",", ":"))
    return f"""DO ${tag}$
BEGIN
 IF current_user<>'postgres' OR
 (SELECT coalesce(jsonb_agg(jsonb_build_array(version,name) ORDER BY version),'[]'::jsonb)
    FROM supabase_migrations.schema_migrations) IS DISTINCT FROM {quote(expected_json)}::jsonb
 THEN RAISE EXCEPTION 'TASK-08-02 exact version/name history mismatch; STOP'; END IF;
END ${tag}$;
"""

def score_gate(tag):
    vals = ",\n  ".join("(" + quote(sig) + "," + quote(h) + ")" for sig, h in SCORE_DEFINITIONS)
    return f"""DO ${tag}$
DECLARE r record; o oid; saved_path text:=current_setting('search_path');
BEGIN
 PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
 FOR r IN SELECT * FROM (VALUES
  {vals}
 ) AS v(signature,expected_hash) LOOP
  o:=pg_catalog.to_regprocedure(r.signature);
  IF o IS NULL OR pg_catalog.md5(pg_catalog.pg_get_functiondef(o)) IS DISTINCT FROM r.expected_hash
  THEN RAISE EXCEPTION 'TASK-08-02 score dependency drift: %',r.signature; END IF;
 END LOOP;
 PERFORM pg_catalog.set_config('search_path',saved_path,true);
END ${tag}$;
"""

def render(version):
    require(re.fullmatch(r"[0-9]{14}", version), "Use the CLI-allocated UTC timestamp version")
    datetime.datetime.strptime(version, "%Y%m%d%H%M%S")
    require(version > max(v for v, _ in BASELINE), "version must follow target history")
    require(len(BASELINE) == 30 and len(set(v for v, _ in BASELINE)) == 30
            and tuple(sorted(BASELINE)) == BASELINE, "baseline drift")
    raw = SOURCE.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == SOURCE_SHA256, "reviewed candidate drift")
    src = raw.decode("utf-8")
    marker = "END $formal_install_gate$;\n"
    require(src.count(marker) == 1 and src.count("\nBEGIN;\n") == 1
            and src.count("\nCOMMIT;") == 1 and src.rstrip().endswith("COMMIT;"),
            "transaction or gate drift")
    require("ADD CONSTRAINT club_invite_review_send_off CHECK (NOT send_enabled);" in src,
            "hard send-off missing")
    # Existing formal opt-in and catalog gates execute before the history lock.
    # The full history is checked under the lock before the first application DDL.
    history_pre = ("SET LOCAL standard_conforming_strings=on;\n"
                   "LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;\n"
                   + history_gate(BASELINE, "invite_history_before")
                   + score_gate("invite_score_before"))
    src = src.replace(marker, marker + "\n" + history_pre, 1)
    post = score_gate("invite_score_after") + history_gate(BASELINE + ((version, NAME),), "invite_history_after")
    # H61 convention: store exact ordered SQL sections excluding the outer
    # transaction and the INSERT which records them. No old-history repairs.
    split = src.index("\nBEGIN;\n")
    end = src.rindex("\nCOMMIT;")
    body = src[split + len("\nBEGIN;\n"):end] + "\n"
    register = ("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES("
                + quote(version) + "," + quote(NAME) + ",ARRAY["
                + dollar(body,"invite_history_body") + ","
                + dollar(post,"invite_history_post") + "]::text[]);\n")
    return ("-- DRAFT: separately authorized manual release only. Not db push.\n"
            + src[:split] + "\nBEGIN;\n" + body + register + post + "COMMIT;\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="UTC version allocated by Supabase CLI; collision check required")
    args = parser.parse_args()
    sys.stdout.write(render(args.version))
