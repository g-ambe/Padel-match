-- TASK-08 P0: staging public_player_profiles view risk experiment only.
-- Not a fix, not a migration. Changing security_invoker alone can break public profile reads.
-- Operates inside ONE transaction, always ROLLBACK. Do not apply to production.
-- Only counts the TASK08 synthetic fixture names: no IDs, email, avatar URL or real names returned.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
BEGIN
 IF current_user <> 'postgres'
 OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='public_player_profiles' AND c.relkind='v'
       AND c.reloptions @> ARRAY['security_barrier=true']::text[]) <> 1
 OR (SELECT count(*) FROM public.player_profiles pp
     WHERE pp.display_name LIKE 'TASK08-P0 %' AND pp.linked_auth_user_id IS NOT NULL) <> 3
 THEN RAISE EXCEPTION 'View fixture changed: stop before any test ALTER';
 END IF;
END $guard$;
SET LOCAL ROLE anon;
DO $baseline$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.public_player_profiles
 WHERE display_name LIKE 'TASK08-P0 %';
 PERFORM set_config('task08.anon_view_before',n::text,true);
END $baseline$;
RESET ROLE;
ALTER VIEW public.public_player_profiles SET (security_invoker = true);
SET LOCAL ROLE anon;
DO $trial$
DECLARE n integer;
BEGIN
 BEGIN
   SELECT count(*) INTO n FROM public.public_player_profiles
   WHERE display_name LIKE 'TASK08-P0 %';
   PERFORM set_config('task08.anon_view_trial',format('returned_%s',n),true);
 EXCEPTION WHEN insufficient_privilege THEN
   PERFORM set_config('task08.anon_view_trial','denied_42501',true);
 END;
END $trial$;
RESET ROLE;
SELECT jsonb_build_object(
 'baseline_anon_fixture_names',current_setting('task08.anon_view_before')::int,
 'security_invoker_trial',current_setting('task08.anon_view_trial'),
 'rollback_only',true
) AS result;
ROLLBACK;
