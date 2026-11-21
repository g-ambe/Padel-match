-- TASK-08 H08: STAGING ONLY. Do not apply to production.
-- Only blocks public-claim manager approval when a club-only preview would
-- rewrite another group's membership or undisclosed history.
-- Single-group join and non-merge join paths stay supported.
-- Cross-club and single-club SQL probes ran in ROLLBACK before staging apply.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $preflight$
BEGIN
 IF current_user <> 'postgres'
 OR NOT EXISTS (SELECT 1 FROM public.clubs WHERE name='TASK08-P0-20261119-A')
 OR NOT EXISTS (SELECT 1 FROM pg_proc p
 WHERE p.oid=to_regprocedure('public.review_profile_join_request(uuid,text)')
 AND md5(pg_get_functiondef(p.oid))='3a97bd8eaa4a64493953055026e84bf1'
 AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef)
 THEN RAISE EXCEPTION 'TASK08 H08 alternate approval preflight drift'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.review_profile_join_request(p_request_id uuid, p_decision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare request public.join_requests; target uuid; merge_id uuid;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('approved','rejected','cancelled') then raise exception '操作を確認してください'; end if;
  perform profile_link_private.serialize_operations();
  select * into request from public.join_requests where id = p_request_id for update;
  if not found then raise exception '加入申請が見つかりません'; end if;
  if not public.can_manage_player_profile_club(request.club_id) and not (p_decision = 'cancelled' and request.requester_auth_user_id = auth.uid()) then raise exception '加入申請を審査する権限がありません'; end if;
  if request.status <> 'pending' then return jsonb_build_object('status',request.status); end if;
  if coalesce(request.expires_at,request.created_at+interval '7 days') <= now() then
    update public.join_requests set status = 'expired', reviewed_at = now() where id = request.id;
    return jsonb_build_object('status','expired');
  end if;
  if p_decision = 'approved' then
    perform profile_link_private.lock_references();
    target := profile_link_private.canonical(request.requester_auth_user_id,request.requester_player_profile_id);
    if target is null then raise exception '申請者の正規プロフィールを確認できません'; end if;
    if request.target_club_member_id is not null or request.consent_source_player_profile_id is not null then
      if request.consent_at is null or request.consent_snapshot is null or request.consent_source_player_profile_id is null then raise exception '本人の統合同意が記録されていません。内容を確認して再申請してください'; end if;
      if not exists (select 1 from public.club_members where id = request.target_club_member_id and club_id = request.club_id and player_profile_id = request.consent_source_player_profile_id and is_active) then raise exception '本人が指定した選手または所属が変更されています'; end if;
      if not public.can_edit_player_profile_member(request.club_id,(select role from public.club_members where id = request.target_club_member_id)) then raise exception '対象メンバーを管理する権限がありません'; end if;
      if request.consent_snapshot is distinct from profile_link_private.source_snapshot(request.consent_source_player_profile_id) then raise exception '本人の同意後に引き継ぐ情報が変更されています。再確認と再申請が必要です'; end if;
    -- Fail closed when this global profile merge would change data outside
    -- the club-scoped content shown to the approval recipient.
    IF EXISTS (SELECT 1 FROM public.club_members cm WHERE
       cm.player_profile_id=request.consent_source_player_profile_id
       AND cm.club_id IS DISTINCT FROM request.club_id)
    OR EXISTS (SELECT 1 FROM public.event_participants ep JOIN public.events e
       ON e.id=ep.event_id WHERE ep.player_profile_id=request.consent_source_player_profile_id
       AND e.club_id IS DISTINCT FROM request.club_id)
    OR EXISTS (SELECT 1 FROM public.join_requests jr
       WHERE jr.requester_player_profile_id=request.consent_source_player_profile_id)
    OR EXISTS (SELECT 1 FROM public.event_team_matches tm
       WHERE request.consent_source_player_profile_id IN (
        tm.team_a_player1_profile_id,tm.team_a_player2_profile_id,
        tm.team_b_player1_profile_id,tm.team_b_player2_profile_id)
       AND NOT EXISTS (SELECT 1 FROM public.event_team_sides s
        WHERE s.event_id=tm.event_id AND s.club_id=request.club_id))
    OR EXISTS (SELECT 1 FROM public.official_matches om
       JOIN public.official_events oe ON oe.id=om.official_event_id
       WHERE request.consent_source_player_profile_id IN (
        om.our_player1_profile_id,om.our_player2_profile_id)
       AND oe.club_id IS DISTINCT FROM request.club_id)
    THEN
      RAISE EXCEPTION '別グループの所属や対象外の履歴を含むため、この画面からの連携承認はできません。管理者に確認してください'
       USING ERRCODE='42501';
    END IF;
      merge_id := profile_link_private.merge_profiles(request.consent_source_player_profile_id,target,request.requester_auth_user_id,request.club_id,request.requester_auth_user_id,auth.uid(),null,request.id);
    else
      if exists (select 1 from public.club_members where club_id = request.club_id and (player_profile_id = target or profile_id = request.requester_auth_user_id)) then raise exception '同じグループに所属行があります。退会状態と役職を確認してください'; end if;
      insert into public.club_members(club_id,player_profile_id,role,is_active) values (request.club_id,target,'member',true);
    end if;
  end if;
  update public.join_requests set status = p_decision, reviewed_by_auth_user_id = auth.uid(), reviewed_at = now() where id = request.id;
  insert into public.notifications(target_auth_user_id,type,title,related_club_id,related_join_request_id)
    values (request.requester_auth_user_id,'join_request_status',case p_decision when 'approved' then '加入申請が承認されました' when 'rejected' then '加入申請が拒否されました' else '加入申請を取り消しました' end,request.club_id,request.id);
  return jsonb_build_object('status',p_decision,'merge_id',merge_id);
end $function$;
COMMIT;
