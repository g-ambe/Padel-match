BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.player_stats IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.player_stats'::regclass)
 OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='player_stats')<>1
 OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='player_stats'
  AND policyname='dev_all_player_stats' AND cmd='ALL' AND permissive='PERMISSIVE'
  AND roles::text='{anon,authenticated}' AND qual='true' AND with_check='true')
 THEN RAISE EXCEPTION 'player_stats policy drift; stop'; END IF;
END $guard$;
DO $guard$ BEGIN
 IF NOT has_table_privilege('anon','public.player_stats','SELECT')
 OR NOT has_table_privilege('anon','public.player_stats','TRUNCATE')
 OR has_table_privilege('anon','public.player_stats','INSERT')
 OR has_table_privilege('anon','public.player_stats','UPDATE')
 OR has_table_privilege('anon','public.player_stats','DELETE')
 OR NOT has_table_privilege('authenticated','public.player_stats','SELECT')
 OR NOT has_table_privilege('authenticated','public.player_stats','INSERT')
 OR NOT has_table_privilege('authenticated','public.player_stats','UPDATE')
 OR NOT has_table_privilege('authenticated','public.player_stats','DELETE')
 OR NOT has_table_privilege('authenticated','public.player_stats','TRUNCATE')
 THEN RAISE EXCEPTION 'player_stats privilege drift; stop'; END IF;
END $guard$;
REVOKE SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.player_stats FROM anon,authenticated;
DROP POLICY dev_all_player_stats ON public.player_stats;
DO $guard$ DECLARE r text; p text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
   IF has_table_privilege(r,'public.player_stats',p) THEN RAISE EXCEPTION 'Unexpected inherited privilege: % %',r,p; END IF;
  END LOOP;
 END LOOP;
END $guard$;
COMMIT;
