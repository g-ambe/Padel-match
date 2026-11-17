BEGIN READ ONLY;
DO $$
DECLARE rel text;
BEGIN
 IF to_regclass('public.player_profile_private') IS NULL OR to_regnamespace('profile_media_private') IS NULL
 OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0048' AND name='private_profile_media') THEN RAISE EXCEPTION '0049_requires_0048'; END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0049' OR name='profile_avatar_position')
 OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='player_profile_private' AND column_name IN('avatar_focus_x','avatar_focus_y','avatar_zoom','avatar_pose_version'))
 OR to_regprocedure('public.get_my_profile_group_usage()') IS NOT NULL
 OR to_regprocedure('public.save_my_avatar_position(uuid,bigint,bigint,double precision,double precision,double precision,uuid)') IS NOT NULL THEN RAISE EXCEPTION '0049_already_present_or_partial_stop'; END IF;
 IF has_table_privilege('anon','public.player_profile_private','SELECT') OR has_table_privilege('authenticated','public.player_profile_private','UPDATE')
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.player_profile_private'::regclass AND relrowsecurity) THEN RAISE EXCEPTION '0049_private_protection_differs'; END IF;
 FOREACH rel IN ARRAY ARRAY['events','event_participants','match_players','event_team_matches','event_team_rounds','event_team_attendance','club_members','event_team_sides','official_events','official_opponents','official_matches','player_profiles'] LOOP
  IF to_regclass('public.'||rel) IS NULL OR NOT has_table_privilege('authenticated','public.'||rel,'SELECT') THEN RAISE EXCEPTION '0049_usage_source_not_readable'; END IF;
 END LOOP;
END; $$;
ROLLBACK;
