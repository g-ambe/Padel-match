-- TASK-08 / H06: staging-only isolation candidate, never apply to production.
-- Purpose: block direct legacy preview_profile_join EXECUTE while preserving
-- the SECDEF preview_public_club_claim minimal DTO wrapper and its consent token.
-- TEST-ONLY transaction: default ROLLBACK, NOT a committed migration.
-- Do NOT revoke submit_profile_join_request or alter helper/RLS/table permissions.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_user <> 'postgres'
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.preview_profile_join(uuid,uuid)')
        AND pg_get_userbyid(p.proowner)='postgres'
        AND p.prosecdef
        AND md5(pg_get_functiondef(p.oid))='97a1f5de84750f0e3bf1cffa1d6805fd'
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.preview_public_club_claim(uuid,uuid)')
        AND pg_get_userbyid(p.proowner)='postgres'
        AND p.prosecdef
        AND md5(pg_get_functiondef(p.oid))='dfc4453b42c6a734da9acd2f48e50e31'
        AND has_function_privilege('authenticated',p.oid,'EXECUTE')
    )
  THEN
    RAISE EXCEPTION 'H06 staging preflight drift: stop; no ACL update';
  END IF;
END $guard$;
-- The owner (postgres) can still call legacy preview internally via SECURITY DEFINER.
-- PUBLIC/anon/authenticated must not call it directly after this ACL change.
REVOKE EXECUTE ON FUNCTION public.preview_profile_join(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
ROLLBACK;
