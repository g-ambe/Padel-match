-- clubs SELECT only. Production approval required.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.clubs IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clubs'::regclass)
 OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='clubs' AND cmd IN ('SELECT','ALL'))<>2
 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
 AND policyname='clubs_super_user_select' AND cmd='SELECT' AND permissive='PERMISSIVE'
 AND roles::text='{authenticated}' AND qual='is_super_user()' AND with_check IS NULL)
 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clubs'
 AND policyname='rls01_clubs_select_compat' AND cmd='SELECT' AND permissive='PERMISSIVE'
 AND roles::text='{anon,authenticated}' AND qual='true' AND with_check IS NULL)
 THEN RAISE EXCEPTION 'clubs SELECT policy drift; stop'; END IF;
 IF to_regprocedure('public.get_shared_official_club_name(text)') IS NULL THEN
 RAISE EXCEPTION 'Shared-name prerequisite missing; stop'; END IF;
END $guard$;
ALTER POLICY rls01_clubs_select_compat ON public.clubs TO authenticated USING ((owner_id = (SELECT auth.uid()))
 OR (visibility='public' AND is_active=true AND is_deleted=false)
 OR EXISTS (
   SELECT 1 FROM public.club_members cm
   WHERE cm.club_id=clubs.id AND cm.is_active=true
     AND (cm.profile_id=(SELECT auth.uid()) OR EXISTS (
       SELECT 1 FROM public.player_profiles pp
       WHERE pp.id=cm.player_profile_id AND pp.linked_auth_user_id=(SELECT auth.uid())
     ))
 ));
ALTER POLICY rls01_clubs_select_compat ON public.clubs RENAME TO rls04_clubs_select_visible;
COMMIT;
