-- REVIEW CANDIDATE. Explicit production approval required.
-- Target: padel-hub / ntczrmvffmpjzilfebyi. Confirm connection separately.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.clubs IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clubs'::regclass)
 OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='clubs' AND cmd IN ('ALL','DELETE')) <> 1
 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
   AND policyname='rls01_clubs_delete_compat' AND cmd='DELETE' AND permissive='PERMISSIVE'
   AND roles::text='{anon,authenticated}' AND qual='true' AND with_check IS NULL)
 THEN RAISE EXCEPTION 'Unexpected clubs DELETE policies; stop and re-review'; END IF;
END $guard$;
ALTER POLICY rls01_clubs_delete_compat ON public.clubs USING (false);
ALTER POLICY rls01_clubs_delete_compat ON public.clubs RENAME TO rls02_clubs_delete_denied;
COMMIT;
