-- TASK-08 H62-1: minimal C1 fix; candidate, not authorized for hosted apply.
-- Keep existing public player profiles, writes, and unrelated table grants.
-- Reuse Phase1's nonrecursive, SECURITY DEFINER membership predicate.
-- The existing app/RPC membership convention uses cm.is_active; do not
-- change the lifecycle, role rules, or existing public directory contract.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $h62_preflight$
BEGIN
 IF current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='club_members'
      AND policyname='club_members_read' AND cmd='SELECT'
      AND permissive='PERMISSIVE' AND qual='true'
      AND roles=ARRAY['anon','authenticated']::name[])
 OR (SELECT count(*) FROM pg_policy
       WHERE polrelid='public.club_members'::regclass AND polcmd IN ('r','*'))<>1
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.club_members'::regclass)
 OR to_regprocedure('group_read_private.owns_active_player_profile(uuid)') IS NOT NULL
 OR to_regprocedure('group_read_private.member(uuid)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='group_read_private.member(uuid)'::regprocedure
       AND prosecdef AND pg_get_userbyid(proowner)='postgres' AND provolatile='s')
 OR has_schema_privilege('authenticated','group_read_private','USAGE')
 OR has_any_column_privilege('anon','public.club_members','SELECT')
 OR NOT has_table_privilege('authenticated','public.club_members','SELECT')
 THEN RAISE EXCEPTION 'H62 membership read baseline drift; STOP'; END IF;
END $h62_preflight$;

-- Policy execution needs EXECUTE; schema stays private/no USAGE or REST
-- exposure. Use the existing predicate rather than querying club_members
-- recursively in its own policy. Preserve own historical memberships
-- (including after leaving) and super-admin access. Nonmembers see the
-- existing public directory/count RPCs, never raw rows of other people.
GRANT EXECUTE ON FUNCTION group_read_private.member(uuid) TO authenticated;
-- Keep the linked-profile lookup out of the policy's subquery tree. The
-- existing membership INSERT policy reads clubs, whose SELECT policy reads
-- club_members. A subquery here causes PostgreSQL to reject that path as recursive.
CREATE FUNCTION group_read_private.owns_active_player_profile(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $owns_profile$
 SELECT EXISTS (SELECT 1 FROM public.player_profiles pp
   WHERE pp.id=p_profile_id AND pp.is_active AND pp.linked_auth_user_id=auth.uid());
$owns_profile$;
REVOKE ALL ON FUNCTION group_read_private.owns_active_player_profile(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION group_read_private.owns_active_player_profile(uuid) TO authenticated;
ALTER POLICY club_members_read ON public.club_members TO authenticated
 USING (
  auth.uid() IS NOT NULL AND (
   public.is_super_user()
   OR group_read_private.member(club_id)
   OR (player_profile_id IS NULL AND profile_id=auth.uid())
   OR group_read_private.owns_active_player_profile(player_profile_id)
  )
 );

DO $h62_postflight$
BEGIN
 IF has_any_column_privilege('anon','public.club_members','SELECT')
 OR NOT has_table_privilege('authenticated','public.club_members','SELECT')
 OR has_column_privilege('authenticated','public.club_members','club_display_name','UPDATE')
 OR has_column_privilege('authenticated','public.club_members','club_display_name_public_confirmed_at','UPDATE')
 OR NOT has_function_privilege('authenticated','group_read_private.member(uuid)','EXECUTE')
 OR has_function_privilege('anon','group_read_private.member(uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','group_read_private.owns_active_player_profile(uuid)','EXECUTE')
 OR has_function_privilege('anon','group_read_private.owns_active_player_profile(uuid)','EXECUTE')
 OR has_schema_privilege('authenticated','group_read_private','USAGE')
 OR NOT EXISTS(SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='club_members' AND policyname='club_members_read'
       AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[]
       AND qual LIKE '%group_read_private.member%')
 OR (SELECT count(*) FROM pg_policy
       WHERE polrelid='public.club_members'::regclass AND polcmd IN ('r','*'))<>1
 THEN RAISE EXCEPTION 'H62 membership read privacy postflight failed'; END IF;
END $h62_postflight$;
COMMIT;
