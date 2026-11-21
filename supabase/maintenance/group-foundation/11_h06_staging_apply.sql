-- TASK-08 / H06 - STAGING ONLY. Do NOT apply to production.
-- Narrow only the direct EXECUTE privilege of the legacy full-JSON join preview.
-- Preserve SECURITY DEFINER preview_public_club_claim and the legacy function body.
-- Stage fixture + exact function hashes prevent accidental execution in production.
-- Reviewed with 10_h06_legacy_preview_acl_candidate.sql rollback-only trial.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
 IF current_user <> 'postgres'
   OR NOT EXISTS (SELECT 1 FROM public.clubs WHERE name = 'TASK08-P0-20261119-A')
   OR NOT EXISTS (
     SELECT 1 FROM pg_proc p
     WHERE p.oid=to_regprocedure('public.preview_profile_join(uuid,uuid)')
       AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
       AND md5(pg_get_functiondef(p.oid))='97a1f5de84750f0e3bf1cffa1d6805fd'
       AND has_function_privilege('authenticated',p.oid,'EXECUTE')
   )
   OR NOT EXISTS (
     SELECT 1 FROM pg_proc p
     WHERE p.oid=to_regprocedure('public.preview_public_club_claim(uuid,uuid)')
       AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
       AND md5(pg_get_functiondef(p.oid))='dfc4453b42c6a734da9acd2f48e50e31'
       AND has_function_privilege('authenticated',p.oid,'EXECUTE')
   )
 THEN RAISE EXCEPTION 'H06 staging guard mismatch; abort';
 END IF;
END $guard$;
REVOKE EXECUTE ON FUNCTION public.preview_profile_join(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
COMMIT;
