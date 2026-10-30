-- REVIEW CANDIDATE: production execution requires explicit approval.
-- Target: padel-hub / ntczrmvffmpjzilfebyi. Confirm project in executor UI.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.clubs IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clubs'::regclass) THEN
    RAISE EXCEPTION 'clubs RLS must be enabled';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='clubs') <> 3
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
      AND policyname='dev_all_clubs' AND permissive='PERMISSIVE'
      AND roles::text='{anon,authenticated}' AND cmd='ALL' AND qual='true' AND with_check='true')
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
      AND policyname='clubs_super_user_select' AND permissive='PERMISSIVE'
      AND roles::text='{authenticated}' AND cmd='SELECT' AND qual='is_super_user()' AND with_check IS NULL)
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
      AND policyname='clubs_super_user_update' AND permissive='PERMISSIVE'
      AND roles::text='{authenticated}' AND cmd='UPDATE' AND qual='is_super_user()' AND with_check='is_super_user()')
  THEN RAISE EXCEPTION 'clubs policy drift; stop and re-review'; END IF;
END $guard$;

-- Preserve the other three operations exactly at policy level.
CREATE POLICY rls01_clubs_select_compat ON public.clubs
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY rls01_clubs_insert_compat ON public.clubs
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY rls01_clubs_delete_compat ON public.clubs
  FOR DELETE TO anon, authenticated USING (true);
CREATE POLICY rls01_clubs_update_main_admin ON public.clubs
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.club_members cm
    WHERE cm.club_id = clubs.id
      AND cm.is_active = true AND cm.role = 'main_admin'
      AND (
        cm.profile_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.player_profiles pp
          WHERE pp.id = cm.player_profile_id
            AND pp.linked_auth_user_id = (SELECT auth.uid())
        )
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.club_members cm
    WHERE cm.club_id = clubs.id
      AND cm.is_active = true AND cm.role = 'main_admin'
      AND (
        cm.profile_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.player_profiles pp
          WHERE pp.id = cm.player_profile_id
            AND pp.linked_auth_user_id = (SELECT auth.uid())
        )
      )
  ));
-- Existing clubs_super_user_update continues to grant super-user access.
DROP POLICY dev_all_clubs ON public.clubs;
COMMIT;
