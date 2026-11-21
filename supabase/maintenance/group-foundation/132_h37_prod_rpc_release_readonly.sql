-- TASK-08 / H37: READ ONLY prerequisite audit for staged production RPC additions.
-- Same script is safe to run in Stage and Prod. Does not read tokens/names/row data.
-- A PASS for token_click_ready does not approve production app deployment.
BEGIN READ ONLY;
WITH h12_tables(name) AS (
 VALUES ('events'),('event_participants'),('matches'),('match_players'),('match_results'),
 ('rounds'),('event_team_sides'),('event_team_matches'),('event_team_guests'),
 ('event_video_links'),('official_events'),('official_opponents'),('official_matches'),
 ('clubs'),('player_profiles'),('profiles')
),
h12_team_columns(name) AS (
 VALUES ('round_id'),('round_number'),('court_number'),('generation_mode'),('pair_1_score'),
 ('pair_2_score'),('pair_result'),('team_a_player1_guest_id'),('team_a_player2_guest_id'),
 ('team_b_player1_guest_id'),('team_b_player2_guest_id'),('team_a_player1_source_side'),
 ('team_a_player2_source_side'),('team_b_player1_source_side'),('team_b_player2_source_side')
),
click_tables(name) AS (
 VALUES ('events'),('matches'),('event_video_clicks'),('event_video_links'),
 ('event_video_link_clicks'),('official_events'),('official_matches'),('official_video_clicks')
),
legacy_click_funcs(sig) AS (
 VALUES ('public.record_event_video_click(uuid,text,text)'),
 ('public.record_event_video_link_click(uuid,text,text)'),
 ('public.record_official_video_click(uuid,text,text)')
),
new_click_funcs(sig) AS (
 VALUES ('public.record_event_video_click_by_token(uuid,text,text,text)'),
 ('public.record_event_video_link_click_by_token(uuid,text,text,text)'),
 ('public.record_official_video_click_by_token(uuid,text,text,text)')
),
prereqs AS (
 SELECT
   (SELECT count(*) FROM h12_tables WHERE to_regclass('public.'||name) IS NULL) AS missing_h12_tables,
   (SELECT count(*) FROM h12_team_columns WHERE NOT EXISTS
     (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.event_team_matches')
      AND attname=name AND attnum>0 AND NOT attisdropped)) AS missing_h12_columns,
   (SELECT count(*) FROM click_tables WHERE to_regclass('public.'||name) IS NULL) AS missing_click_tables,
   (SELECT count(*) FROM legacy_click_funcs WHERE to_regprocedure(sig) IS NULL) AS missing_legacy_click_rpc,
   (SELECT count(*) FROM new_click_funcs WHERE to_regprocedure(sig) IS NOT NULL) AS existing_new_click_rpc,
   (SELECT count(*) FROM click_tables WHERE name LIKE '%clicks' AND coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||name)),false)=false) AS click_tables_without_rls
)
SELECT jsonb_build_object(
 'read_only',true,
 'h12_missing_tables',missing_h12_tables,
 'h12_missing_team_columns',missing_h12_columns,
 'h12_shared_rpc_exists',to_regprocedure('public.get_shared_event(text,text)') IS NOT NULL,
 'h12_candidate_prerequisites_met',missing_h12_tables=0 AND missing_h12_columns=0,
 'token_click_missing_tables',missing_click_tables,
 'token_click_missing_legacy_rpc',missing_legacy_click_rpc,
 'token_click_existing_new_rpc',existing_new_click_rpc,
 'token_click_tables_without_rls',click_tables_without_rls,
 'token_click_additive_ready',missing_click_tables=0 AND missing_legacy_click_rpc=0
   AND existing_new_click_rpc=0 AND click_tables_without_rls=0,
 'group_read_private_exists',to_regnamespace('group_read_private') IS NOT NULL,
 'anon_can_read_club_members',has_any_column_privilege('anon','public.club_members','SELECT'),
 'display_name_0056_requires_anon_acl_change',
   has_any_column_privilege('anon','public.club_members','SELECT'),
 'last_main_guard_exists',to_regprocedure('security_private.task08_guard_last_main_member()') IS NOT NULL,
 'h19_0062_requires_last_main_guard',
   to_regprocedure('security_private.task08_guard_last_main_member()') IS NULL,
 'fixed_pair_feature_present',to_regclass('public.event_fixed_pair_state') IS NOT NULL,
 'profile_media_feature_present',to_regclass('public.profile_media_objects') IS NOT NULL,
 'facility_rows',(SELECT count(*) FROM public.padel_facilities),
 'event_rows',(SELECT count(*) FROM public.events),
 'official_event_rows',(SELECT count(*) FROM public.official_events),
 'production_deploy_approved',false
) AS report FROM prereqs;
ROLLBACK;
