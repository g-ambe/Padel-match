-- TASK-08 / H38: READ-ONLY release prerequisite for legacy -> new group/link UI.
-- Run unchanged on Stage and Prod. No user names/IDs/tokens/row bodies are returned.
BEGIN READ ONLY;
SELECT jsonb_build_object(
 'read_only',true,
 'legacy_last_main_guard_exists',
   to_regprocedure('public.guard_group_last_main_admin()') IS NOT NULL,
 'legacy_main_trigger_count',
   (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.club_members'::regclass
     AND tgname='guard_group_last_main_admin' AND tgenabled IN ('O','A')),
 'stage_last_main_helper_exists',
   to_regprocedure('security_private.task08_guard_last_main_member()') IS NOT NULL,
 'status_only_bridge_exists',
   (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.club_members'::regclass
     AND tgname='task08_block_last_main_status' AND tgenabled IN ('O','A')),
 'legacy_anon_club_members_select',
   has_any_column_privilege('anon','public.club_members','SELECT'),
 'anon_member_column_grants_exist',
   (SELECT count(*) FROM pg_attribute WHERE attrelid='public.club_members'::regclass
     AND attnum>0 AND NOT attisdropped AND attacl::text LIKE '%anon=%')>0,
 'group_read_private_exists',to_regnamespace('group_read_private') IS NOT NULL,
 'club_roster_rpc_exists',to_regprocedure('public.get_club_roster(uuid)') IS NOT NULL,
 'public_directory_rpc_exists',to_regprocedure('public.get_public_club_directory(uuid)') IS NOT NULL,
 'club_display_name_column_exists',
   EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='club_members' AND column_name='club_display_name'),
 'leave_my_club_rpc_exists',to_regprocedure('public.leave_my_club(uuid,uuid)') IS NOT NULL,
 'scoped_preview_helper_exists',
   to_regprocedure('profile_link_private.scoped_preview(uuid,uuid,uuid)') IS NOT NULL,
 'link_detail_uses_scoped_preview',
   COALESCE((SELECT position('profile_link_private.scoped_preview(' IN pg_get_functiondef(p.oid))>0
    FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_player_profile_link_request(uuid)')),false),
 'link_detail_is_authenticated_only',
   NOT has_function_privilege('anon','public.get_player_profile_link_request(uuid)','EXECUTE')
   AND has_function_privilege('authenticated','public.get_player_profile_link_request(uuid)','EXECUTE'),
 'profile_link_merge_fn_exists',
   to_regprocedure('profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)') IS NOT NULL,
 'owner_transfer_table_exists',to_regclass('public.club_owner_transfer_requests') IS NOT NULL,
 'named_review_rpc_exists',
   to_regprocedure('public.review_player_profile_link_named(uuid,text,text,text,boolean)') IS NOT NULL,
 'fixed_pairs_exist',to_regclass('public.event_fixed_pair_state') IS NOT NULL,
 'profile_media_exists',to_regclass('public.profile_media_objects') IS NOT NULL,
 'club_count',(SELECT count(*) FROM public.clubs),
 'membership_count',(SELECT count(*) FROM public.club_members),
 'event_count',(SELECT count(*) FROM public.events),
 'official_event_count',(SELECT count(*) FROM public.official_events),
 'prod_release_approved',false
) AS report;
ROLLBACK;
