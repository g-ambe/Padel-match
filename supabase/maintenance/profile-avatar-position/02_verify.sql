BEGIN READ ONLY;
DO $$
DECLARE signature text; proc record; item record;
BEGIN
 FOR signature IN SELECT unnest(ARRAY['public.save_my_avatar_position(uuid,bigint,bigint,double precision,double precision,double precision,uuid)','public.get_my_profile_group_usage()']) LOOP
  IF to_regprocedure(signature) IS NULL OR NOT has_function_privilege('authenticated',signature,'EXECUTE') OR has_function_privilege('anon',signature,'EXECUTE')
   OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure(signature) AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION '0049_rpc_grant_invalid'; END IF;
 END LOOP;
 SELECT * INTO proc FROM pg_proc WHERE oid='public.get_my_profile_group_usage()'::regprocedure;
 IF proc.prosecdef OR NOT ('search_path=""'=ANY(proc.proconfig)) THEN RAISE EXCEPTION '0049_usage_must_use_invoker_RLS'; END IF;
 SELECT * INTO proc FROM pg_proc WHERE oid='public.save_my_avatar_position(uuid,bigint,bigint,double precision,double precision,double precision,uuid)'::regprocedure;
 IF NOT proc.prosecdef OR NOT ('search_path=""'=ANY(proc.proconfig)) THEN RAISE EXCEPTION '0049_position_search_path_invalid'; END IF;
 IF has_function_privilege('anon','profile_media_private.reset_avatar_position()','EXECUTE') OR has_function_privilege('authenticated','profile_media_private.reset_avatar_position()','EXECUTE') THEN RAISE EXCEPTION '0049_private_trigger_callable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.player_profile_private'::regclass AND tgname='profile_avatar_position_reset' AND tgenabled='O')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.player_profile_private'::regclass AND conname='profile_avatar_position_bounds' AND convalidated)
 OR has_table_privilege('anon','public.player_profile_private','SELECT') OR has_table_privilege('authenticated','public.player_profile_private','UPDATE')
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.player_profile_private'::regclass AND relrowsecurity) THEN RAISE EXCEPTION '0049_table_protection_invalid'; END IF;
 FOR item IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='player_profile_private' AND column_name IN('avatar_focus_x','avatar_focus_y','avatar_zoom','avatar_pose_version') LOOP
  IF has_column_privilege('authenticated','public.player_profile_private',item.column_name,'UPDATE') THEN RAISE EXCEPTION '0049_direct_column_update_allowed'; END IF;
 END LOOP;
END; $$;
ROLLBACK;
