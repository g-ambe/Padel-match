-- TASK-08 P0 / H23: non-destructive Stage/Prod parity and anonymous ACL release gate.
-- Run verbatim on BOTH projects. No individual profile, event, token, or row content read.
-- This is inventory only; NEVER use its output to auto-apply or auto-revoke grants.
BEGIN READ ONLY;
WITH expected_tables(name,area,migration) AS (
 VALUES
 ('event_fixed_pair_rounds','fixed_pair','0040'),
 ('event_fixed_pair_state','fixed_pair','0040'),
 ('event_fixed_pairs','fixed_pair','0040'),
 ('friendly_match_operations','atomic_lineups','0041'),
 ('friendly_round_lineup_state','atomic_lineups','0041'),
 ('player_profile_private','profile_media','0048'),
 ('profile_media_attempts','profile_media','0048'),
 ('profile_media_objects','profile_media','0048'),
 ('profile_media_operations','profile_media','0048')
),
expected_columns(name,col,migration) AS (
 VALUES
 ('padel_facilities','facility_key','0051'),
 ('padel_facilities','aliases','0051'),
 ('padel_facilities','availability','0051'),
 ('padel_facilities','usage_note','0051'),
 ('padel_facilities','verified_on','0051'),
 ('user_preferences','tutorial_status','0046')
),
expected_functions(signature,area) AS (
 VALUES
 ('public.get_event_fixed_pair_state(uuid,boolean)','fixed_pair'),
 ('public.get_friendly_lineup_versions(uuid)','atomic_lineups'),
 ('public.delete_friendly_match(uuid,uuid,jsonb,uuid)','atomic_lineups'),
 ('public.save_friendly_team_match_video(uuid,uuid,text,text)','event_video'),
 ('public.prepare_profile_image(uuid,uuid,bigint,text,uuid,text)','profile_media'),
 ('public.commit_profile_image(uuid,uuid,text)','profile_media'),
 ('public.save_my_home_court(uuid,bigint,text,uuid)','home_court'),
 ('public.save_my_home_court_selection(uuid,bigint,uuid,text,uuid)','home_court'),
 ('public.get_my_profile_group_usage()','profile_media'),
 ('public.get_public_club_directory(uuid)','group_public'),
 ('public.get_public_club_member_count(uuid)','group_public'),
 ('public.respond_club_owner_transfer(uuid,text)','group_owner')
),
sensitive(name) AS (
 VALUES ('club_members'),('player_profiles'),('profiles'),
        ('events'),('event_participants'),('matches'),('match_players'),
        ('match_results'),('rounds'),('official_events'),('official_matches'),
        ('official_opponents')
),
present_tables AS (
 SELECT name,area,migration,to_regclass('public.'||name) IS NOT NULL AS present
 FROM expected_tables
),
present_columns AS (
 SELECT ec.name,ec.col,ec.migration,
 EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
 AND c.table_name=ec.name AND c.column_name=ec.col) AS present FROM expected_columns ec
),
present_functions AS (
 SELECT signature,area,to_regprocedure(signature) IS NOT NULL AS present
 FROM expected_functions
),
exposed AS (
 SELECT s.name,has_any_column_privilege('anon',format('public.%I',s.name),'SELECT') AS anon_any_select,
  has_table_privilege('anon',format('public.%I',s.name),'SELECT') AS anon_table_select,
  (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||s.name)) AS rls
 FROM sensitive s
 WHERE to_regclass('public.'||s.name) IS NOT NULL
)
SELECT jsonb_build_object(
 'read_only',true,
 'missing_feature_tables',
  (SELECT jsonb_agg(jsonb_build_object('table',name,'area',area,'source_migration',migration)
   ORDER BY migration,name) FROM present_tables WHERE NOT present),
 'missing_feature_columns',
  (SELECT jsonb_agg(jsonb_build_object('table',name,'column',col,'source_migration',migration)
   ORDER BY migration,name,col) FROM present_columns WHERE NOT present),
 'missing_feature_functions',
  (SELECT jsonb_agg(jsonb_build_object('signature',signature,'area',area)
   ORDER BY area,signature) FROM present_functions WHERE NOT present),
 'feature_parity_ready',
  (SELECT bool_and(present) FROM present_tables)
  AND (SELECT bool_and(present) FROM present_columns)
  AND (SELECT bool_and(present) FROM present_functions
       WHERE area IN ('fixed_pair','atomic_lineups','event_video','profile_media','home_court')),
 'anon_sensitive_access',
  (SELECT jsonb_agg(jsonb_build_object('table',name,'column_select_granted',anon_any_select,
   'table_select_granted',anon_table_select,'rls_enabled',rls) ORDER BY name)
   FROM exposed),
 'anon_sensitive_exposure_present',
  (SELECT bool_or(anon_any_select) FROM exposed),
 'group_rpc_ready',
  (SELECT bool_and(present) FROM present_functions WHERE area IN ('group_public','group_owner')),
 'facility_master_count',(SELECT count(*) FROM public.padel_facilities),
 'migration_history_entries',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'release_approved',false
) AS report;
ROLLBACK;
