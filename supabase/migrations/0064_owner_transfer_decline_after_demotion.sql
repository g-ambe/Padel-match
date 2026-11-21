-- H19 forward-only: recipient can decline a pending request even after
-- their membership was demoted; only acceptance must revalidate main-admin.
-- Old owner must still be current, and all status changes remain atomic.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('public.respond_club_owner_transfer(uuid,text)') IS NULL
 OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.respond_club_owner_transfer(uuid,text)'::regprocedure)<>'postgres'
 THEN RAISE EXCEPTION 'H19 decline patch prerequisites missing'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.respond_club_owner_transfer(p_request_id uuid, p_decision text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid;v_club_id uuid;v_current_owner uuid;
 v_req public.club_owner_transfer_requests%ROWTYPE;
 v_count integer;v_target_member uuid;v_old_member uuid;
BEGIN
 v_actor:=auth.uid();
 IF v_actor IS NULL OR p_request_id IS NULL OR p_decision IS NULL OR p_decision NOT IN('accepted','declined')
 THEN RAISE EXCEPTION '申請と引受・辞退の選択を確認してください'
  USING ERRCODE='42501'; END IF;
 -- A nonlocking lookup is safe: after taking the club lock the same request
 -- is row-locked and its status and all members are revalidated.
 SELECT r.club_id INTO v_club_id FROM public.club_owner_transfer_requests r
 WHERE r.id=p_request_id AND r.to_auth_user_id=v_actor;
 IF NOT FOUND THEN RAISE EXCEPTION '本人宛の引継ぎ依頼を確認できません'
  USING ERRCODE='42501'; END IF;
 SELECT c.owner_id INTO v_current_owner FROM public.clubs c
 WHERE c.id=v_club_id AND c.is_active AND NOT coalesce(c.is_deleted,false)
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '対象グループを確認できません' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_req FROM public.club_owner_transfer_requests r
 WHERE r.id=p_request_id AND r.club_id=v_club_id FOR UPDATE;
 IF NOT FOUND OR v_req.to_auth_user_id IS DISTINCT FROM v_actor
  OR v_req.status<>'pending'
  OR v_req.from_auth_user_id IS DISTINCT FROM v_current_owner
 THEN RAISE SQLSTATE 'PT409' USING MESSAGE='引継ぎ依頼が変更されています。再読み込みしてください'; END IF;

 IF p_decision='accepted' THEN
 -- Candidate must still be a distinct linked, active main administrator;
 -- owner must still be an active linked main administrator. No stale token
 -- can silently authorize a transfer when roles or ownership changed.
 SELECT count(*),(array_agg(cm.id ORDER BY cm.id))[1] INTO v_count,v_old_member
 FROM public.club_members cm JOIN public.player_profiles pp
 ON pp.id=cm.player_profile_id AND pp.is_active
 WHERE cm.id=v_req.from_member_id AND cm.club_id=v_club_id
  AND cm.is_active AND cm.status='active' AND cm.role='main_admin'
  AND pp.linked_auth_user_id=v_req.from_auth_user_id;
 IF v_count<>1 THEN RAISE EXCEPTION '現オーナーの管理権限が無効です' USING ERRCODE='42501'; END IF;
 SELECT count(*),(array_agg(cm.id ORDER BY cm.id))[1] INTO v_count,v_target_member
 FROM public.club_members cm JOIN public.player_profiles pp
  ON pp.id=cm.player_profile_id AND pp.is_active
 WHERE cm.id=v_req.to_member_id AND cm.club_id=v_club_id
  AND cm.is_active AND cm.status='active' AND cm.role='main_admin'
  AND pp.linked_auth_user_id=v_req.to_auth_user_id;
 IF v_count<>1 OR v_target_member IS NULL THEN
  RAISE EXCEPTION '引継ぎ先が現在メイン管理者ではありません'
   USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.club_members cm
     JOIN public.player_profiles pp ON pp.id=cm.player_profile_id AND pp.is_active
     WHERE cm.club_id=v_club_id AND cm.is_active AND cm.status='active'
      AND pp.linked_auth_user_id=v_actor)<>1
 THEN RAISE EXCEPTION '引継ぎ先の所属が複数あります' USING ERRCODE='42501'; END IF;

 END IF;

 IF p_decision='accepted' THEN
  UPDATE public.clubs SET owner_id=v_actor
  WHERE id=v_club_id AND owner_id=v_req.from_auth_user_id
    AND is_active AND NOT coalesce(is_deleted,false);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE SQLSTATE 'PT409' USING MESSAGE='既に所有者が変更されています'; END IF;
 END IF;
 UPDATE public.club_owner_transfer_requests
 SET status=p_decision,responded_at=statement_timestamp()
 WHERE id=p_request_id AND status='pending';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION '引継ぎの結果を保存できません'
   USING ERRCODE='42501'; END IF;
 INSERT INTO public.notifications
 (target_auth_user_id,type,title,body,related_club_id,related_owner_transfer_request_id)
 VALUES(v_req.from_auth_user_id,
   CASE WHEN p_decision='accepted' THEN 'club_owner_transfer_accepted' ELSE 'club_owner_transfer_declined' END,
   CASE WHEN p_decision='accepted' THEN 'オーナー引継ぎが完了しました' ELSE 'オーナー引継ぎが辞退されました' END,
   CASE WHEN p_decision='accepted' THEN '新オーナーが承諾しました。旧オーナーは引き続き在籍し、希望すれば退会できます。'
     ELSE 'オーナーは変更されていません。' END,
   v_club_id,p_request_id);
 RETURN p_decision;
END $function$
;
DO $postflight$
BEGIN
 IF position('IF p_decision=''accepted'' THEN' IN
 (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE oid='public.respond_club_owner_transfer(uuid,text)'::regprocedure))=0
 OR has_function_privilege('anon','public.respond_club_owner_transfer(uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'H19 decline or permission patch failed'; END IF;
END $postflight$;
COMMIT;