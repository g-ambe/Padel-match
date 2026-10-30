-- clubs SELECT only. Production approval required.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.clubs IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='clubs' AND cmd IN ('SELECT','ALL'))<>2
 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
 AND policyname='rls04_clubs_select_visible' AND cmd='SELECT' AND permissive='PERMISSIVE'
 AND roles::text='{authenticated}' AND with_check IS NULL)
 THEN RAISE EXCEPTION 'Unexpected SELECT state; stop'; END IF;
END $guard$;
-- Restores prior broad row access. Review saved post-apply definition before rollback.
ALTER POLICY rls04_clubs_select_visible ON public.clubs TO anon, authenticated USING (true);
ALTER POLICY rls04_clubs_select_visible ON public.clubs RENAME TO rls01_clubs_select_compat;
COMMIT;
