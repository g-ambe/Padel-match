-- Review candidate: explicit production approval required.
-- Target: padel-hub / ntczrmvffmpjzilfebyi. Confirm executor connection.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.clubs IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clubs'::regclass)
 OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='clubs' AND cmd IN ('INSERT','ALL')) <> 1
 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
   AND policyname='rls01_clubs_insert_compat' AND permissive='PERMISSIVE' AND cmd='INSERT'
   AND roles::text='{anon,authenticated}' AND qual IS NULL AND with_check='true')
 THEN RAISE EXCEPTION 'clubs INSERT policy drift; stop'; END IF;
END $guard$;
ALTER POLICY rls01_clubs_insert_compat ON public.clubs
 TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());
ALTER POLICY rls01_clubs_insert_compat ON public.clubs RENAME TO rls03_clubs_insert_self;
COMMIT;
