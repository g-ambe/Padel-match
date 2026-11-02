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
   AND policyname='rls03_clubs_insert_self' AND permissive='PERMISSIVE' AND cmd='INSERT'
   AND roles::text='{authenticated}' AND qual IS NULL AND with_check='((auth.uid() IS NOT NULL) AND (owner_id = auth.uid()))')
 THEN RAISE EXCEPTION 'clubs INSERT policy drift; stop'; END IF;
END $guard$;
-- Restores prior broad INSERT policy; existing owner trigger still applies.
ALTER POLICY rls03_clubs_insert_self ON public.clubs TO anon, authenticated WITH CHECK (true);
ALTER POLICY rls03_clubs_insert_self ON public.clubs RENAME TO rls01_clubs_insert_compat;
COMMIT;
