-- TASK-08 / P0-H27: Stage/Prod authorization parity (READ ONLY).
-- Run the exact same SQL on padel-hub-staging and padel-hub.
-- Metadata and role privileges only; no user records, JWT, secret, row data or updates.
-- Does not authorize migration, REVOKE/GRANT or production cutover.
-- This is a SELECT-only statement. Review its output before any further action.

WITH critical AS (
  SELECT c.oid, c.relname, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname IN (
      'clubs', 'club_members', 'profiles', 'player_profiles',
      'events', 'event_participants', 'rounds', 'matches',
      'match_players', 'match_results', 'official_events',
      'official_matches', 'official_opponents'
    )
),
anon_acl AS (
  SELECT relname AS table_name, relrowsecurity AS rls_enabled,
    has_table_privilege('anon', oid, 'SELECT') AS anon_table_select,
    has_any_column_privilege('anon', oid, 'SELECT') AS anon_any_column_select
  FROM critical
),
event_policy AS (
  SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'
),
other_policy AS (
  SELECT tablename, policyname, permissive, roles, cmd
  FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('event_participants', 'rounds', 'matches', 'match_players', 'match_results')
),
identity_trigger AS (
  SELECT c.relname AS table_name, t.tgname AS trigger_name,
    t.tgenabled AS enabled, pn.nspname || '.' || p.proname AS function_name,
    pg_get_triggerdef(t.oid) AS trigger_definition
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace cn ON cn.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace pn ON pn.oid = p.pronamespace
  WHERE cn.nspname = 'public' AND NOT t.tgisinternal
    AND c.relname IN ('events', 'event_participants', 'rounds', 'matches', 'match_players', 'match_results')
),
auth_columns AS (
  SELECT table_name, column_name,
    has_column_privilege('authenticated', format('public.%I', table_name), column_name, 'SELECT') AS authenticated_select,
    has_column_privilege('authenticated', format('public.%I', table_name), column_name, 'UPDATE') AS authenticated_update
  FROM information_schema.columns
  WHERE table_schema = 'public' AND (
    (table_name = 'events' AND column_name IN ('id', 'club_id', 'created_by_auth_user_id', 'created_at', 'name', 'status'))
    OR (table_name = 'event_participants' AND column_name IN ('id', 'event_id', 'profile_id', 'player_profile_id', 'participant_type', 'status'))
    OR (table_name = 'rounds' AND column_name IN ('id', 'event_id', 'round_number'))
    OR (table_name = 'matches' AND column_name IN ('id', 'event_id', 'round_id', 'completed'))
    OR (table_name = 'match_players' AND column_name IN ('id', 'match_id', 'participant_id', 'team'))
    OR (table_name = 'match_results' AND column_name IN ('id', 'match_id', 'score_a', 'score_b'))
  )
)
SELECT jsonb_build_object(
  'anon_table_and_column_acl',
    (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.table_name), '[]'::jsonb) FROM anon_acl x),
  'events_policies',
    (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tablename, x.policyname), '[]'::jsonb) FROM event_policy x),
  'other_event_related_policy_names',
    (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.tablename, x.policyname), '[]'::jsonb) FROM other_policy x),
  'event_related_triggers',
    (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.table_name, x.trigger_name), '[]'::jsonb) FROM identity_trigger x),
  'authenticated_column_acl',
    (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.table_name, x.column_name), '[]'::jsonb) FROM auth_columns x),
  'migration_object_presence', jsonb_build_object(
    'fixed_pair_private', to_regnamespace('fixed_pair_private') IS NOT NULL,
    'lineup_private', to_regnamespace('lineup_private') IS NOT NULL,
    'profile_media_private', to_regnamespace('profile_media_private') IS NOT NULL
  )
) AS authorization_parity_readonly;
