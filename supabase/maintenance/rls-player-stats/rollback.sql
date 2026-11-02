BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.player_stats IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='player_stats')
 THEN RAISE EXCEPTION 'New player_stats policies found; stop'; END IF;
END $guard$;
DO $guard$ DECLARE r text; p text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
   IF has_table_privilege(r,'public.player_stats',p) THEN RAISE EXCEPTION 'New player_stats privilege found; stop'; END IF;
  END LOOP;
 END LOOP;
END $guard$;
CREATE POLICY dev_all_player_stats ON public.player_stats FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
GRANT SELECT,TRUNCATE ON public.player_stats TO anon;
GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.player_stats TO authenticated;
COMMIT;
