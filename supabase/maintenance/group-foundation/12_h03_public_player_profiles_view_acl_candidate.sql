-- TASK-08 / H03: staging-only view SELECT ACL closure candidate.
-- This is an explicit rollback-only experiment, NOT a production migration.
-- Keep the original view definition/owner/security_barrier/underlying RLS unchanged.
-- Close direct Data API access to the legacy global linked-profile name/avatar view.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
 IF current_user <> 'postgres'
 OR NOT EXISTS (
   SELECT 1 FROM pg_class c
   WHERE c.oid=to_regclass('public.public_player_profiles') AND c.relkind='v'
   AND pg_get_userbyid(c.relowner)='postgres'
   AND md5(pg_get_viewdef(c.oid,true))='42f906073d724e0636cbd0e4e1c7b909'
   AND has_table_privilege('anon',c.oid,'SELECT')
   AND has_table_privilege('authenticated',c.oid,'SELECT')
 )
 OR NOT EXISTS (SELECT 1 FROM public.clubs WHERE name='TASK08-P0-20261119-A')
 THEN RAISE EXCEPTION 'H03 staging view preflight drift; stop before ACL change';
 END IF;
END $guard$;
REVOKE SELECT ON TABLE public.public_player_profiles
  FROM PUBLIC, anon, authenticated;
ROLLBACK;
