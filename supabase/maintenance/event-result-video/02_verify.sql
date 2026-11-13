DO $verify$ DECLARE f oid; BEGIN
 f:=to_regprocedure('public.save_friendly_team_match_video(uuid,uuid,text,text)');
 IF f IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=f AND prosecdef
   AND pg_get_userbyid(proowner)='postgres' AND proconfig @> ARRAY['search_path=""'])
 OR NOT has_function_privilege('authenticated',f,'EXECUTE')
 OR has_function_privilege('anon',f,'EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=f AND a.grantee=0 AND a.privilege_type='EXECUTE')
 THEN RAISE EXCEPTION '0047_rpc_security_verification_failed'; END IF;
 PERFORM profile_link_private.check_reference_schema();
END $verify$;
