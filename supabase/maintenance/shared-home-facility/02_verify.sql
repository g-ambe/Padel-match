BEGIN READ ONLY;
DO $$
DECLARE signature text:='public.save_my_home_court_selection(uuid,bigint,uuid,text,uuid)'; p record;
BEGIN
 IF to_regprocedure(signature) IS NULL OR NOT has_function_privilege('authenticated',signature,'EXECUTE') OR has_function_privilege('anon',signature,'EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc f CROSS JOIN LATERAL aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE f.oid=to_regprocedure(signature) AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION '0051_rpc_grant_invalid';END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(signature);
 IF NOT p.prosecdef OR NOT ('search_path=""'=ANY(p.proconfig)) THEN RAISE EXCEPTION '0051_rpc_security_invalid';END IF;
 IF has_table_privilege('anon','public.player_profile_private','SELECT') OR has_column_privilege('authenticated','public.player_profile_private','home_facility_id','UPDATE') OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.player_profile_private'::regclass AND relrowsecurity) THEN RAISE EXCEPTION '0051_private_access_invalid';END IF;
 IF has_table_privilege('authenticated','public.padel_facilities','UPDATE') OR has_table_privilege('authenticated','public.padel_facilities','INSERT') OR has_table_privilege('anon','public.padel_facilities','UPDATE') OR NOT has_table_privilege('authenticated','public.padel_facilities','SELECT') OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.padel_facilities'::regclass AND relrowsecurity) THEN RAISE EXCEPTION '0051_master_access_invalid';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.player_profile_private'::regclass AND conname='profile_home_facility_fkey' AND confrelid='public.padel_facilities'::regclass AND confdeltype='r' AND convalidated) THEN RAISE EXCEPTION '0051_facility_reference_invalid';END IF;
END; $$;
ROLLBACK;
