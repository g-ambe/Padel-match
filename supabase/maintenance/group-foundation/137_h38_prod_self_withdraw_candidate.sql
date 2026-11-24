-- TASK-08 / H38: Prod H15 self-withdrawal compatibility candidate; not authorized for Prod apply.
-- Never changes player profiles, auth users, other memberships or historical matches.
-- Owner handoff requires a separate, explicit-consent flow; owner exit fails closed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Migration owner must be postgres'; END IF;
 IF to_regclass('public.clubs') IS NULL
 OR to_regclass('public.club_members') IS NULL
 OR to_regclass('public.player_profiles') IS NULL
 OR to_regprocedure('security_private.task08_guard_last_main_member()') IS NULL
 THEN RAISE EXCEPTION 'H15 prerequisites missing: do not bypass last-main guard'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid='public.club_members'::regclass
   AND tgname='guard_group_last_main_admin' AND tgenabled IN ('O','A')
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid='public.club_members'::regclass
   AND tgname='task08_block_last_main_status' AND tgenabled IN ('O','A')
 ) THEN RAISE EXCEPTION 'H38 last-main Prod guard/bridge not ready'; END IF;
 IF to_regprocedure('public.leave_my_club(uuid,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'H15 existing RPC must be reviewed before replacement'; END IF;
END $preflight$;

CREATE FUNCTION public.leave_my_club(p_club_id uuid,p_member_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $self_exit$
DECLARE v_auth uuid; v_owner uuid; v_target public.club_members%ROWTYPE; v_updated uuid;
BEGIN
 v_auth := auth.uid();
 IF v_auth IS NULL OR p_club_id IS NULL OR p_member_id IS NULL THEN
  RAISE EXCEPTION 'ログインと所属情報を確認してください' USING ERRCODE='42501';
 END IF;

 -- Serialize with promotion/demotion, owner transfer and competing exits.
 SELECT c.owner_id INTO v_owner FROM public.clubs c
 WHERE c.id=p_club_id AND c.is_active AND NOT coalesce(c.is_deleted,false)
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'グループの所属を確認できません' USING ERRCODE='42501'; END IF;

 SELECT cm.* INTO v_target FROM public.club_members cm
 LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=p_club_id AND cm.id=p_member_id
   AND cm.is_active AND cm.status='active'
   AND (
      (cm.player_profile_id IS NOT NULL AND pp.is_active AND pp.linked_auth_user_id=v_auth)
      OR (cm.player_profile_id IS NULL AND cm.profile_id=v_auth)
   )
 FOR UPDATE OF cm;
 IF NOT FOUND THEN
  RAISE EXCEPTION '本人の有効な所属を確認できません' USING ERRCODE='42501';
 END IF;

 -- Even if several main admins exist, the owner must hand over ownership
 -- with the recipient's consent before exiting. Never silently transfer.
 IF v_owner=v_auth THEN
  RAISE EXCEPTION 'オーナーを引き継いでから退会してください' USING ERRCODE='42501';
 END IF;
 IF v_target.role='main_admin' AND NOT EXISTS (
  SELECT 1 FROM public.club_members other
  WHERE other.club_id=p_club_id AND other.id<>v_target.id
    AND other.role='main_admin' AND other.is_active AND other.status='active'
 ) THEN
  RAISE EXCEPTION 'メイン管理者は最低1人必要です' USING ERRCODE='42501';
 END IF;

 UPDATE public.club_members SET is_active=false
 WHERE id=v_target.id AND club_id=p_club_id AND is_active
 RETURNING id INTO v_updated;
 IF v_updated IS DISTINCT FROM v_target.id THEN
  RAISE EXCEPTION '退会状態を保存できませんでした' USING ERRCODE='42501';
 END IF;
 RETURN v_updated;
END $self_exit$;
REVOKE ALL ON FUNCTION public.leave_my_club(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_my_club(uuid,uuid) TO authenticated;

DO $verify$
BEGIN
 IF has_function_privilege('anon','public.leave_my_club(uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.leave_my_club(uuid,uuid)','EXECUTE')
 OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.leave_my_club(uuid,uuid)'::regprocedure)
 THEN RAISE EXCEPTION 'H15 self-exit authorization boundary mismatch'; END IF;
END $verify$;
COMMIT;