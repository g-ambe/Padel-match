-- REVIEW CANDIDATE: production execution requires explicit approval.
-- Target: padel-hub / ntczrmvffmpjzilfebyi. Confirm project in executor UI.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.clubs IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='clubs') <> 6
    OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs' AND policyname='dev_all_clubs')
    OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
      AND permissive='PERMISSIVE' AND roles::text='{anon,authenticated}' AND (
        (policyname='rls01_clubs_select_compat' AND cmd='SELECT' AND qual='true' AND with_check IS NULL)
        OR (policyname='rls01_clubs_insert_compat' AND cmd='INSERT' AND qual IS NULL AND with_check='true')
        OR (policyname='rls01_clubs_delete_compat' AND cmd='DELETE' AND qual='true' AND with_check IS NULL))) <> 3
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
      AND policyname='rls01_clubs_update_main_admin' AND cmd='UPDATE'
      AND permissive='PERMISSIVE' AND roles::text='{authenticated}' AND qual=with_check)
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
      AND policyname='clubs_super_user_select' AND cmd='SELECT' AND permissive='PERMISSIVE'
      AND roles::text='{authenticated}' AND qual='is_super_user()' AND with_check IS NULL)
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
      AND policyname='clubs_super_user_update' AND cmd='UPDATE' AND permissive='PERMISSIVE'
      AND roles::text='{authenticated}' AND qual='is_super_user()' AND with_check='is_super_user()')
  THEN RAISE EXCEPTION 'Unexpected state; do not roll back another step'; END IF;
END $guard$;
-- Review verify.sql output against the captured post-apply definition first.
-- This restores the known broad UPDATE access as well.
CREATE POLICY dev_all_clubs ON public.clubs FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
DROP POLICY rls01_clubs_select_compat ON public.clubs;
DROP POLICY rls01_clubs_insert_compat ON public.clubs;
DROP POLICY rls01_clubs_delete_compat ON public.clubs;
DROP POLICY rls01_clubs_update_main_admin ON public.clubs;
COMMIT;
