-- TASK-08 P0 / H24: strict read-only preflight for historical migrations 0040-0043 and 0047-0051.
-- Run on Stage and Prod without reading personal rows, object keys, passwords or JWTs.
-- This report never authorizes a migration; external backup/restore remains mandatory.
BEGIN READ ONLY;
WITH protected_tables(name) AS (
  VALUES ('events'),('event_participants'),('rounds'),('matches'),('match_players'),('match_results')
),
required_triggers(name) AS (
  VALUES ('guard_event_identity'),('guard_event_member_fields'),
         ('guard_participant_identity'),('guard_match_identity')
),
mandatory AS (
 SELECT
  (SELECT count(*) FROM protected_tables) AS required_table_count,
  (SELECT count(*) FROM protected_tables t WHERE to_regclass('public.'||t.name) IS NOT NULL) AS present_table_count,
  (SELECT count(*) FROM protected_tables t
    JOIN pg_class c ON c.oid=to_regclass('public.'||t.name)
    WHERE c.relrowsecurity) AS rls_table_count,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public'
    AND p.tablename IN (SELECT name FROM protected_tables) AND p.cmd='ALL') AS broad_all_policy_count,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='events'
    AND policyname='rls10_events_update_members') AS required_event_update_policy_count,
  (SELECT count(*) FROM pg_trigger t
    WHERE t.tgname IN (SELECT name FROM required_triggers)
    AND t.tgenabled='O'
    AND t.tgrelid IN (SELECT to_regclass('public.'||name) FROM protected_tables)
    AND NOT t.tgisinternal) AS required_guard_trigger_count
),
object_check AS (
 SELECT jsonb_build_object(
 'fixed_pair_schema',to_regnamespace('fixed_pair_private') IS NOT NULL,
 'lineup_schema',to_regnamespace('lineup_private') IS NOT NULL,
 'profile_media_schema',to_regnamespace('profile_media_private') IS NOT NULL,
 'fixed_pair_state',to_regclass('public.event_fixed_pair_state') IS NOT NULL,
 'fixed_pair_entries',to_regclass('public.event_fixed_pairs') IS NOT NULL,
 'fixed_pair_rounds',to_regclass('public.event_fixed_pair_rounds') IS NOT NULL,
 'friendly_lineup_state',to_regclass('public.friendly_round_lineup_state') IS NOT NULL,
 'friendly_match_operations',to_regclass('public.friendly_match_operations') IS NOT NULL,
 'private_profiles',to_regclass('public.player_profile_private') IS NOT NULL,
 'private_media_objects',to_regclass('public.profile_media_objects') IS NOT NULL,
 'private_media_operations',to_regclass('public.profile_media_operations') IS NOT NULL,
 'private_media_attempts',to_regclass('public.profile_media_attempts') IS NOT NULL,
 'official_video_rpc',to_regprocedure('public.save_friendly_team_match_video(uuid,uuid,text,text)') IS NOT NULL,
 'fixed_pair_rpc',to_regprocedure('public.get_event_fixed_pair_state(uuid,boolean)') IS NOT NULL,
 'lineup_rpc',to_regprocedure('public.get_friendly_lineup_versions(uuid)') IS NOT NULL,
 'private_media_rpc',to_regprocedure('public.commit_profile_image(uuid,uuid,text)') IS NOT NULL,
 'home_court_rpc',to_regprocedure('public.save_my_home_court(uuid,bigint,text,uuid)') IS NOT NULL,
 'facilities_extended',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
   AND table_name='padel_facilities' AND column_name='facility_key')
 ) AS obj
),
pending_conflicts AS (
 SELECT count(*) AS duplicate_score_matches FROM (
  SELECT match_id FROM public.match_results WHERE match_id IS NOT NULL
  GROUP BY match_id HAVING count(*)>1
 ) d
)
SELECT jsonb_build_object(
 'read_only',true,
 'migration_0040_original_guard_matches_schema',
  (m.present_table_count=m.required_table_count AND m.rls_table_count=m.required_table_count
   AND m.broad_all_policy_count=0 AND m.required_event_update_policy_count=1
   AND m.required_guard_trigger_count=7 AND to_regnamespace('fixed_pair_private') IS NULL),
 'migration_0040_prerequisite',jsonb_build_object(
   'base_tables',m.present_table_count,'rls_base_tables',m.rls_table_count,
   'broad_all_policies',m.broad_all_policy_count,
   'required_named_policy',m.required_event_update_policy_count,
   'required_enabled_guard_triggers',m.required_guard_trigger_count,
   'existing_schema',to_regnamespace('fixed_pair_private') IS NOT NULL),
 'migration_0043_duplicate_match_results',p.duplicate_score_matches,
 'historical_objects',o.obj,
 'migration_0048_stage_dry_run_does_not_prove_r2',true,
 'external_backup_restoration_verified',false,
 'production_change_authorized',false
) report
FROM mandatory m CROSS JOIN object_check o CROSS JOIN pending_conflicts p;
ROLLBACK;
