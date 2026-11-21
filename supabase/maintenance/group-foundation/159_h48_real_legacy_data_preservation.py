"""H48: FULL legacy event, fixed-pair and media DB rows on isolated Prod schema.

Complement H45's limited six group tables. This deliberately reads the FULL
records of 18 additional public legacy tables (which can include share tokens,
YouTube links, private media object keys and guest names), only into memory.
No raw records are logged, written to files, uploaded, printed, or copied to
Stage. Docker is network-disconnected before insert. Only table counts and
fixed PASS codes reach Actions logs. The source uses Prod READ ONLY snapshot.
This is a schema+record integrity test, NOT R2 blob/content verification.
"""
from __future__ import annotations
import json

TABLES = (
    "events", "rounds", "event_participants", "matches", "match_players",
    "match_results", "event_team_matches", "official_events", "official_matches",
    "event_fixed_pair_state", "event_fixed_pairs", "event_fixed_pair_rounds",
    "friendly_match_operations", "player_profile_private",
    "profile_media_objects", "profile_media_operations",
    "profile_media_attempts", "padel_facilities",
)
MAX_ROWS = {
    "events": 1500, "rounds": 10000, "event_participants": 20000,
    "matches": 30000, "match_players": 120000, "match_results": 30000,
    "event_team_matches": 5000, "official_events": 1000,
    "official_matches": 20000, "event_fixed_pair_state": 3000,
    "event_fixed_pairs": 15000, "event_fixed_pair_rounds": 30000,
    "friendly_match_operations": 30000, "player_profile_private": 15000,
    "profile_media_objects": 15000, "profile_media_operations": 30000,
    "profile_media_attempts": 30000, "padel_facilities": 15000,
}
# Large snapshots should fail closed instead of silently truncating.
MIN_REQUIRED = {"events":80, "matches":400, "match_results":300,
                "event_fixed_pair_state":1, "event_fixed_pair_rounds":1,
                "profile_media_objects":1, "padel_facilities":10}

def columns_sql(b) -> str:
    tables = ",".join(b.literal(t) for t in TABLES)
    return ("SELECT coalesce(jsonb_object_agg(table_name, columns),'{}'::jsonb) "
            "FROM (SELECT table_name,jsonb_agg(column_name ORDER BY ordinal_position) columns "
            "FROM information_schema.columns WHERE table_schema='public' AND table_name IN (" +
            tables + ") GROUP BY table_name) c")

def rows_sql(b, added_columns: dict[str, list[str]] | None = None) -> str:
    expressions = []
    for table in TABLES:
        added = (added_columns or {}).get(table, [])
        drop_cols = (" - ARRAY[" + ",".join(b.literal(x) for x in added)
                     + "]::text[]" if added else "")
        expressions.append(
            b.literal(table) + ",coalesce((SELECT jsonb_agg(record ORDER BY md5(record::text)) "
            " FROM (SELECT (to_jsonb(t)" + drop_cols + ") record "
            "FROM public." + b.ident(table) + " t) x),'[]'::jsonb)")
    return "SELECT jsonb_build_object(" + ",".join(expressions) + ")"

def validate(source, cols, require) -> None:
    require(set(source) == set(TABLES) and set(cols) == set(TABLES),
            "H48_legacy_table_inventory_mismatch")
    for name in TABLES:
        rows = source[name]
        require(isinstance(rows, list) and len(rows) <= MAX_ROWS[name],
                "H48_legacy_table_exceeds_limit_" + name)
        require(len(rows) >= MIN_REQUIRED.get(name, 0),
                "H48_required_production_rows_missing_" + name)
        require(isinstance(cols[name], list) and len(cols[name]) >= 2,
                "H48_missing_prod_legacy_columns_" + name)
        require(all(isinstance(row, dict) and
                    set(row) == set(cols[name]) for row in rows),
                "H48_legacy_column_incomplete_" + name)

def added_columns(target, b, source_cols, require) -> dict[str, list[str]]:
    now = target.query(columns_sql(b))
    require(set(now) == set(source_cols), "H48_lost_legacy_table")
    extras = {}
    for table in TABLES:
        old = set(source_cols[table])
        current = set(now[table])
        require(old.issubset(current), "H48_legacy_original_column_removed_" + table)
        extras[table] = sorted(current - old)
    return extras

def legacy_signature(target, b, source_cols, require, h45) -> str:
    extras = added_columns(target, b, source_cols, require)
    return h45.digest(target.query(rows_sql(b, extras)))

def load(target, b, source, source_cols, require, h45) -> str:
    require(isinstance(target, b.LocalRestore), "H48_target_must_be_isolated")
    # A single transaction, triggers/FKs disabled ONLY here. No hosted DB DDL.
    # jsonb_populate_record round-trips PostgreSQL composite values including
    # JSONB, arrays, timestamps, bytea, UUID and enum columns.
    statements = ["BEGIN;", "SET LOCAL ROLE postgres;",
                  "SET LOCAL session_replication_role=replica;"]
    for table in TABLES:
        rows = source[table]
        if not rows:
            continue
        value = b.literal(json.dumps(rows, ensure_ascii=False,
                                     sort_keys=True, separators=(",", ":")))
        statements.append("INSERT INTO public." + b.ident(table) +
                          " SELECT (jsonb_populate_record(NULL::public." +
                          b.ident(table) + ",r.row)).* "
                          "FROM jsonb_array_elements(" + value + "::jsonb) AS r(row);")
    statements.append("COMMIT;")
    target.sql("\n".join(statements))
    full_digest = h45.digest(source)
    require(legacy_signature(target,b,source_cols,require,h45) == full_digest,
            "H48_prod_legacy_copy_mismatch")
    print("H48 full legacy snapshot imported and hash-matched: " +
          "tables=" + str(len(TABLES)) + " rows=" +
          str(sum(map(len,source.values()))), flush=True)
    return full_digest

def integrity_sql() -> str:
    return """SELECT jsonb_build_object(
     'result_orphans',(SELECT count(*) FROM public.match_results r
        LEFT JOIN public.matches m ON m.id=r.match_id WHERE m.id IS NULL),
     'duplicate_results',(SELECT count(*) FROM
        (SELECT match_id FROM public.match_results GROUP BY match_id HAVING count(*)>1) x),
     'completed_without_result',(SELECT count(*) FROM public.matches m
        WHERE m.completed AND NOT EXISTS(SELECT 1 FROM public.match_results r WHERE r.match_id=m.id)),
     'results_on_incomplete',(SELECT count(*) FROM public.match_results r
        JOIN public.matches m ON m.id=r.match_id WHERE NOT m.completed),
     'team_event_orphan',(SELECT count(*) FROM public.event_team_matches m
        LEFT JOIN public.events e ON e.id=m.event_id WHERE e.id IS NULL),
     'fixed_state_event_orphan',(SELECT count(*) FROM public.event_fixed_pair_state m
        LEFT JOIN public.events e ON e.id=m.event_id WHERE e.id IS NULL),
     'fixed_pair_event_orphan',(SELECT count(*) FROM public.event_fixed_pairs m
        LEFT JOIN public.events e ON e.id=m.event_id WHERE e.id IS NULL),
     'fixed_round_event_orphan',(SELECT count(*) FROM public.event_fixed_pair_rounds m
        LEFT JOIN public.events e ON e.id=m.event_id WHERE e.id IS NULL),
     'fixed_round_round_orphan',(SELECT count(*) FROM public.event_fixed_pair_rounds m
        LEFT JOIN public.rounds r ON r.id=m.round_id WHERE m.round_id IS NOT NULL AND r.id IS NULL),
     'official_event_orphan',(SELECT count(*) FROM public.official_matches m
        LEFT JOIN public.official_events e ON e.id=m.official_event_id WHERE e.id IS NULL),
     'avatar_object_mismatch',(SELECT count(*) FROM public.player_profile_private p
        JOIN public.profile_media_objects o ON o.object_key=p.avatar_key
        WHERE p.profile_id IS DISTINCT FROM o.profile_id OR o.state<>'active'),
     'media_profile_orphan',(SELECT count(*) FROM public.profile_media_objects o
        LEFT JOIN public.player_profiles pp ON pp.id=o.profile_id
        WHERE o.profile_id IS NOT NULL AND pp.id IS NULL),
     'private_owner_mismatch',(SELECT count(*) FROM public.player_profile_private p
        JOIN public.player_profiles pp ON pp.id=p.profile_id
        WHERE p.owner_id IS DISTINCT FROM CASE WHEN pp.is_active THEN pp.linked_auth_user_id ELSE NULL END),
     'tie_saved_nondraw',(SELECT count(*) FROM public.match_results
        WHERE score_a=score_b AND winner_team<>'draw'),
     'negative_scores',(SELECT count(*) FROM public.match_results
        WHERE score_a<0 OR score_b<0),
     'fixed_rls',(SELECT relrowsecurity FROM pg_class
        WHERE oid='public.event_fixed_pairs'::regclass),
     'media_rls',(SELECT relrowsecurity FROM pg_class
        WHERE oid='public.profile_media_objects'::regclass),
     'fixed_anon_read',has_table_privilege('anon','public.event_fixed_pairs','SELECT'),
     'media_anon_read',has_table_privilege('anon','public.profile_media_objects','SELECT')
     )"""

def verify(target,b,source,source_cols,full_digest,initial_integrity,
           require,h45,phase: str):
    require(legacy_signature(target,b,source_cols,require,h45) == full_digest,
            "H48_legacy_full_rows_changed_" + phase)
    latest = target.query(integrity_sql())
    require(latest == initial_integrity,
            "H48_legacy_integrity_changed_" + phase)
    require(latest["result_orphans"] == 0 and latest["duplicate_results"] == 0
            and latest["completed_without_result"] == 0
            and latest["results_on_incomplete"] == 0
            and latest["fixed_pair_event_orphan"] == 0
            and latest["fixed_round_event_orphan"] == 0
            and latest["fixed_round_round_orphan"] == 0
            and latest["avatar_object_mismatch"] == 0
            and latest["media_profile_orphan"] == 0
            and latest["private_owner_mismatch"] == 0
            and latest["fixed_rls"] is True and latest["media_rls"] is True
            and latest["fixed_anon_read"] is False
            and latest["media_anon_read"] is False,
            "H48_existing_integrity_bad_" + phase)
    print("H48 PASS: " + phase + " 18 legacy tables original columns identical;"
          " scores, fixed-pair, official, media integrity and RLS unchanged",
          flush=True)
