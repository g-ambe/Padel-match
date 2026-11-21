-- TASK-08-03 P0 / H13: STAGING ONLY. DO NOT APPLY TO PRODUCTION.
-- Positive and negative cases were verified inside 19_h13_initial_owner_insert_rollback_candidate.sql.
-- GRANT only required INSERT columns; retain strict RLS and existing triggers.
-- Function serializes concurrent initial membership attempts on the owner club row.
-- WARNING: two-step client creation is not transactional across HTTP; rollback/cleanup is required for tests.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF current_user<>'postgres'
  OR (SELECT count(*) FROM public.clubs WHERE name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>2
  OR to_regprocedure('security_private.task08_initial_owner_member_allowed(uuid,uuid,uuid,text,boolean,text)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN('clubs','club_members') AND cmd='INSERT')
  OR has_table_privilege('authenticated','public.clubs','INSERT')
  OR has_table_privilege('authenticated','public.club_members','INSERT')
  OR (SELECT count(*) FROM public.club_members cm WHERE cm.club_id NOT IN
    (SELECT id FROM public.clubs WHERE name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B')))<>8
 THEN RAISE EXCEPTION 'H13 STAGING guard mismatch: stop before DDL';
 END IF;
END $guard$;
CREATE FUNCTION security_private.task08_initial_owner_member_allowed(
 p_club uuid,p_profile uuid,p_player uuid,p_role text,p_is_active boolean,p_status text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $task08_owner$
DECLARE owner_ok boolean;
BEGIN
 IF auth.uid() IS NULL OR p_profile IS DISTINCT FROM auth.uid()
    OR p_role IS DISTINCT FROM 'main_admin'
    OR p_is_active IS DISTINCT FROM true OR p_status IS DISTINCT FROM 'active'
 THEN RETURN false; END IF;
 -- Lock the owner club row before the initial-membership absence check,
 -- so concurrently attempted initial inserts serialize on the club.
 SELECT true INTO owner_ok FROM public.clubs c
  WHERE c.id=p_club AND c.owner_id=auth.uid() AND c.is_active AND NOT c.is_deleted
  FOR UPDATE;
 IF NOT coalesce(owner_ok,false) THEN RETURN false; END IF;
 RETURN EXISTS (SELECT 1 FROM public.player_profiles p WHERE p.id=p_player
                 AND p.linked_auth_user_id=auth.uid() AND p.is_active)
        AND NOT EXISTS (SELECT 1 FROM public.club_members cm WHERE cm.club_id=p_club);
END $task08_owner$;
REVOKE ALL ON FUNCTION security_private.task08_initial_owner_member_allowed(uuid,uuid,uuid,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION security_private.task08_initial_owner_member_allowed(uuid,uuid,uuid,text,boolean,text) TO authenticated;
GRANT INSERT(name,description,owner_id,is_active,visibility) ON public.clubs TO authenticated;
GRANT INSERT(club_id,profile_id,player_profile_id,role,is_active) ON public.club_members TO authenticated;
CREATE POLICY task08_clubs_initial_owner_insert ON public.clubs
 FOR INSERT TO authenticated WITH CHECK(
  auth.uid() IS NOT NULL AND owner_id=auth.uid() AND is_active AND NOT is_deleted);
CREATE POLICY task08_club_members_initial_owner_insert ON public.club_members
 FOR INSERT TO authenticated WITH CHECK(
  security_private.task08_initial_owner_member_allowed(
    club_id,profile_id,player_profile_id,role,is_active,status));
COMMIT;
