-- TASK-08 H22: exact public-group active member count, separate from name disclosure.
-- Stage first. Do not apply to PROD or auto-publish profile or event data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

DO $preflight$
BEGIN
 IF current_user <> 'postgres'
 OR to_regprocedure('public.get_public_club_member_count(uuid)') IS NOT NULL
 OR to_regclass('public.clubs') IS NULL
 OR to_regclass('public.club_members') IS NULL
 OR to_regclass('public.player_profiles') IS NULL
 THEN RAISE EXCEPTION 'H22 public member count preflight failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='club_members' AND column_name='status')
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='player_profiles' AND column_name='is_active')
 THEN RAISE EXCEPTION 'H22 active membership column unavailable'; END IF;
END $preflight$;

CREATE FUNCTION public.get_public_club_member_count(p_club_id uuid)
RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $member_count$
DECLARE v_count bigint;
BEGIN
 -- Mirror the existing authenticated-only public directory gate; this RPC
 -- deliberately returns only a total, not the subset consenting to name display.
 IF auth.uid() IS NULL OR p_club_id IS NULL
 OR NOT EXISTS (
   SELECT 1 FROM public.clubs c
   WHERE c.id=p_club_id AND c.is_active AND NOT coalesce(c.is_deleted,false)
     AND c.visibility='public'
 ) THEN
   RAISE EXCEPTION '公開グループを確認できません' USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO v_count
 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=p_club_id
   AND cm.is_active AND cm.status='active'
   AND pp.is_active;
 RETURN v_count;
END $member_count$;

REVOKE ALL ON FUNCTION public.get_public_club_member_count(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_member_count(uuid)
 TO authenticated;
COMMENT ON FUNCTION public.get_public_club_member_count(uuid) IS
 'H22 authenticated-only exact count of active valid club memberships in an active public club; independent of per-member public name consent. No identities or role fields.';

DO $postflight$
BEGIN
 IF has_function_privilege('anon',
  'public.get_public_club_member_count(uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated',
  'public.get_public_club_member_count(uuid)','EXECUTE')
 OR NOT (SELECT prosecdef FROM pg_proc
         WHERE oid='public.get_public_club_member_count(uuid)'::regprocedure)
 THEN RAISE EXCEPTION 'H22 public count RPC permissions invalid'; END IF;
END $postflight$;
COMMIT;