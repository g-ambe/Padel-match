-- H37: read-only check of 0054->0055 group-read migration dependencies.
-- Checks dependencies, not full DDL compilation or user-facing regression.
-- Run on Stage AND Prod; never use as an automatic migration trigger.
BEGIN READ ONLY;
WITH funcs(sig) AS (VALUES
('public.is_super_user()'),
('public.can_manage_player_profile_club(uuid)'),
('public.can_view_friendly_team_event_by_sides(uuid,uuid)'),
('public.preview_profile_join(uuid,uuid)'),
('public.submit_profile_join_request(uuid,uuid,text,text)'),
('profile_link_private.serialize_operations()'),
('public.can_edit_player_profile_member(uuid,text)')
),
cols(rel,col) AS (VALUES
('club_members','id'),('club_members','club_id'),('club_members','player_profile_id'),
('club_members','profile_id'),('club_members','role'),('club_members','status'),
('club_members','is_active'),('club_members','created_at'),
('events','event_mode'),('events','created_by_auth_user_id'),('events','club_id'),
('event_team_matches','team_a_player1_profile_id'),
('event_team_matches','team_b_player2_profile_id'),
('join_requests','target_club_member_id'),
('join_requests','requester_auth_user_id'),('join_requests','consent_at'),
('join_requests','requester_display_name_snapshot'),
('official_events','created_by_auth_user_id'),('profiles','display_name'),
('player_profiles','linked_auth_user_id')
)
SELECT jsonb_build_object(
 'read_only',true,
 'missing_required_funcs',(SELECT array_agg(sig ORDER BY sig) FROM funcs
                           WHERE to_regprocedure(sig) IS NULL),
 'missing_columns',(SELECT jsonb_agg(jsonb_build_object('table',rel,'column',col))
                    FROM cols WHERE NOT EXISTS(
                       SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name=rel AND column_name=col)),
 'group_read_schema_already_present',to_regnamespace('group_read_private') IS NOT NULL,
 'directory_trigger_count',(SELECT count(*) FROM pg_trigger
                     WHERE tgrelid='public.club_members'::regclass
                       AND tgname='group_directory_reference'),
 'directory_rpc_already_present',to_regprocedure('public.get_public_club_directory(uuid)') IS NOT NULL,
 'join_request_rpc_already_present',to_regprocedure('public.get_club_join_requests(uuid)') IS NOT NULL,
 'gen_random_uuid_exists',to_regprocedure('gen_random_uuid()') IS NOT NULL,
 'prod_0054_0055_schema_prereqs_only',true,
 'production_release_approved',false
) AS report;
ROLLBACK;
