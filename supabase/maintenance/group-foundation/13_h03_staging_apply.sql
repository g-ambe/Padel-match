-- TASK-08 / H03: STAGING ONLY - close global linked-profile view SELECT.
-- Do NOT apply to production. Stage has this legacy view; prod does not.
-- Verified via 12_h03_public_player_profiles_view_acl_candidate.sql ROLLBACK trial.
-- No changes to view definition, private profile records, RLS, or new RPCs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
 IF current_user <> 'postgres'
 OR NOT EXISTS (SELECT 1 FROM public.clubs WHERE name='TASK08-P0-20261119-A')
 OR NOT EXISTS (
  SELECT 1 FROM pg_class c
  WHERE c.oid=to_regclass('public.public_player_profiles') AND c.relkind='v'
    AND pg_get_userbyid(c.relowner)='postgres'
    AND md5(pg_get_viewdef(c.oid,true))='42f906073d724e0636cbd0e4e1c7b909'
    AND has_table_privilege('anon',c.oid,'SELECT')
    AND has_table_privilege('authenticated',c.oid,'SELECT')
 ) THEN RAISE EXCEPTION 'H03 staging guard mismatch; abort'; END IF;
END $guard$;
REVOKE SELECT ON TABLE public.public_player_profiles
  FROM PUBLIC, anon, authenticated;
COMMIT;
