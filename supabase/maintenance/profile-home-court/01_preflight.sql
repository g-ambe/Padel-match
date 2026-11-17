BEGIN READ ONLY;
DO $$ BEGIN
 IF to_regclass('public.player_profile_private') IS NULL OR NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0049' AND name='profile_avatar_position') THEN RAISE EXCEPTION '0050_requires_0049';END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0050' OR name='private_profile_home_court') OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='player_profile_private' AND column_name IN('home_court_name','home_court_version'))
 OR to_regprocedure('public.save_my_home_court(uuid,bigint,text,uuid)') IS NOT NULL OR to_regprocedure('profile_media_private.reset_home_court()') IS NOT NULL THEN RAISE EXCEPTION '0050_already_present_or_partial_stop';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.player_profile_private'::regclass AND relrowsecurity) OR has_table_privilege('anon','public.player_profile_private','SELECT') OR has_table_privilege('authenticated','public.player_profile_private','UPDATE') THEN RAISE EXCEPTION '0050_private_protection_differs';END IF;
 IF to_regclass('public.padel_facilities') IS NULL OR NOT has_column_privilege('authenticated','public.padel_facilities','name','SELECT') THEN RAISE EXCEPTION '0050_facility_source_unavailable';END IF;
END; $$;
ROLLBACK;
