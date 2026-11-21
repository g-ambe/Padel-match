-- TASK-08 H08 / STAGING ONLY. DO NOT APPLY TO PRODUCTION.
-- Fail closed when a scoped consent preview omits source references that
-- would be reassigned by a global profile merge.
-- Existing API signature, allowed one-club flow, other grants and RLS unchanged.
-- Before this install, both rollback probes 25/26 and 26/27 were validated.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $guard$
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs WHERE name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>2
 OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.review_player_profile_link(uuid,text,text)')
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND md5(pg_get_functiondef(p.oid))='7c81eb37a9d27bb50d7626aa79218805')
 THEN RAISE EXCEPTION 'TASK08 H08 stage hash/owner drift'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.review_player_profile_link(p_request_id uuid, p_decision text, p_review_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare request public.player_profile_link_requests; target uuid; preview jsonb; merge_id uuid;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('approved','rejected','cancelled') then raise exception '操作を確認してください'; end if;
  perform profile_link_private.serialize_operations();
  select * into request from public.player_profile_link_requests where id = p_request_id for update;
  if not found then raise exception '連携申請が見つかりません'; end if;
  if (p_decision in ('approved','rejected') and auth.uid() <> request.target_auth_user_id)
    or (p_decision = 'cancelled' and not public.can_manage_player_profile_club(request.club_id)) then raise exception '申請先本人の承認、または管理者の取消が必要です'; end if;
  if request.status <> 'pending' then return jsonb_build_object('status',request.status); end if;
  if request.expires_at <= now() then
    update public.player_profile_link_requests set status = 'expired', reviewed_at = now() where id = request.id;
    return jsonb_build_object('status','expired');
  end if;
  if p_decision = 'approved' then
    if not coalesce(profile_link_private.club_role(request.club_id, request.requested_by_auth_user_id) in ('super_user','main_admin','sub_admin'), false) then raise exception '申請元の管理権限が変更されています'; end if;
    if not exists (select 1 from public.club_members where id = request.source_club_member_id and club_id = request.club_id and player_profile_id = request.source_player_profile_id and is_active) then raise exception '申請時の対象メンバーが変更されています'; end if;
    if profile_link_private.club_role(request.club_id,request.requested_by_auth_user_id) = 'sub_admin' and exists (select 1 from public.club_members where id=request.source_club_member_id and role='main_admin') then raise exception '申請元に対象メンバーを管理する権限がありません'; end if;
    perform profile_link_private.lock_references();

    -- Fail closed when this global profile merge would change data outside
    -- the club-scoped content shown to the approval recipient.
    IF EXISTS (SELECT 1 FROM public.club_members cm WHERE
       cm.player_profile_id=request.source_player_profile_id
       AND cm.club_id IS DISTINCT FROM request.club_id)
    OR EXISTS (SELECT 1 FROM public.event_participants ep JOIN public.events e
       ON e.id=ep.event_id WHERE ep.player_profile_id=request.source_player_profile_id
       AND e.club_id IS DISTINCT FROM request.club_id)
    OR EXISTS (SELECT 1 FROM public.join_requests jr
       WHERE jr.requester_player_profile_id=request.source_player_profile_id)
    OR EXISTS (SELECT 1 FROM public.event_team_matches tm
       WHERE request.source_player_profile_id IN (
        tm.team_a_player1_profile_id,tm.team_a_player2_profile_id,
        tm.team_b_player1_profile_id,tm.team_b_player2_profile_id)
       AND NOT EXISTS (SELECT 1 FROM public.event_team_sides s
        WHERE s.event_id=tm.event_id AND s.club_id=request.club_id))
    OR EXISTS (SELECT 1 FROM public.official_matches om
       JOIN public.official_events oe ON oe.id=om.official_event_id
       WHERE request.source_player_profile_id IN (
        om.our_player1_profile_id,om.our_player2_profile_id)
       AND oe.club_id IS DISTINCT FROM request.club_id)
    THEN
      RAISE EXCEPTION '別グループの所属や対象外の履歴を含むため、この画面からの連携承認はできません。管理者に確認してください'
       USING ERRCODE='42501';
    END IF;

    target := profile_link_private.canonical(request.target_auth_user_id, request.expected_target_player_profile_id);
    if target is null then raise exception 'プロフィール画面で本人の正規プロフィールを作成してから承認してください'; end if;
    preview := profile_link_private.preview(request.source_player_profile_id, request.target_auth_user_id);
    if p_review_token is null or preview->>'review_token' <> p_review_token then raise exception '確認後に内容が変更されています。再読み込みして引き継ぐ内容を確認してください'; end if;
    merge_id := profile_link_private.merge_profiles(request.source_player_profile_id,target,request.target_auth_user_id,request.club_id,request.requested_by_auth_user_id,auth.uid(),request.id,null);
  end if;
  update public.player_profile_link_requests set status = p_decision, reviewed_by_auth_user_id = auth.uid(), reviewed_at = now() where id = request.id;
  insert into public.notifications(target_auth_user_id,type,title,related_club_id,related_profile_link_request_id)
    values (request.target_auth_user_id,'profile_link_status',case p_decision when 'approved' then '連携が完了しました' when 'rejected' then '連携を拒否しました' else '連携申請が取り消されました' end,request.club_id,request.id);
  perform profile_link_private.notify_admins(request.club_id,case p_decision when 'approved' then '連携が完了しました' when 'rejected' then '連携が拒否されました' else '連携申請を取り消しました' end,request.id,null,request.target_auth_user_id);
  return jsonb_build_object('status',p_decision,'merge_id',merge_id);
end $function$;

COMMIT;
