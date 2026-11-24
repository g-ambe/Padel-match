-- TASK-08 / legacy join submission EXECUTE closure. STAGING ONLY.
-- Do not apply to production. Minimal ACL change, with stage-only fixture guards.
-- Preserves public.submit_public_club_claim SECDEF wrapper and consent contract.
-- Prerequisite: 14_legacy_join_submit_acl_rollback_probe.sql successful in staging.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
 IF current_user <> 'postgres'
 OR NOT EXISTS (SELECT 1 FROM public.clubs WHERE name='TASK08-P0-20261119-A')
 OR NOT EXISTS (
  SELECT 1 FROM pg_proc p
   WHERE p.oid=to_regprocedure('public.submit_profile_join_request(uuid,uuid,text,text)')
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND md5(pg_get_functiondef(p.oid))='17ef49cbc3079fa06a4ccddc756ca1df'
   AND has_function_privilege('authenticated',p.oid,'EXECUTE')
 )
 OR NOT EXISTS (
  SELECT 1 FROM pg_proc p
   WHERE p.oid=to_regprocedure('public.submit_public_club_claim(uuid,uuid,text,text)')
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND md5(pg_get_functiondef(p.oid))='41a7616c55203d4bd6c9f3020ecc744e'
   AND has_function_privilege('authenticated',p.oid,'EXECUTE')
 )
 THEN RAISE EXCEPTION 'TASK08 legacy join submit staging preflight drift; abort'; END IF;
END $guard$;
REVOKE EXECUTE ON FUNCTION public.submit_profile_join_request(uuid,uuid,text,text)
 FROM PUBLIC, anon, authenticated;
COMMIT;
