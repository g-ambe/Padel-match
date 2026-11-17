BEGIN READ ONLY;
SELECT jsonb_build_object(
 'database',current_database(),
 'parent_columns',(SELECT jsonb_agg(jsonb_build_array(column_name,data_type)) FROM information_schema.columns WHERE table_schema='public' AND table_name='player_profiles' AND column_name IN ('id','linked_auth_user_id','is_active')),
 'parent_rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.player_profiles'::regclass),
 'parent_indexes',(SELECT jsonb_agg(indexdef ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='player_profiles'),
 'parent_policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='player_profiles'),
 'existing_grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants g WHERE table_schema='public' AND table_name='player_profiles'),
 'latest_video_rpc',to_regprocedure('public.save_friendly_team_match_video(uuid,uuid,text,text)') IS NOT NULL,
 'new_schema_exists',to_regnamespace('profile_media_private') IS NOT NULL,
 'new_table_exists',to_regclass('public.player_profile_private') IS NOT NULL,
 'history_exists',to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
 'parent_data_sha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') FROM public.player_profiles p)
) AS profile_media_preflight;
ROLLBACK;
