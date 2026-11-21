-- TASK-08 / owner handover (H19), explicitly confirmed by candidate.
-- Stage first. Do NOT apply to production without the coordinated release gate.
-- No implied expiry/auto-acceptance; only sender cancellation or candidate decision.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $preflight$
BEGIN
 IF current_user <> 'postgres'
 OR to_regclass('public.clubs') IS NULL
 OR to_regclass('public.club_members') IS NULL
 OR to_regclass('public.player_profiles') IS NULL
 OR to_regclass('public.notifications') IS NULL
 OR to_regprocedure('public.leave_my_club(uuid,uuid)') IS NULL
 OR to_regprocedure('security_private.task08_guard_last_main_member()') IS NULL
 OR to_regclass('public.club_owner_transfer_requests') IS NOT NULL
 THEN RAISE EXCEPTION 'H19 owner handover migration preconditions not met'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='notifications'
    AND column_name='related_owner_transfer_request_id')
 THEN RAISE EXCEPTION 'H19 notification field already exists'; END IF;
END $preflight$;

CREATE TABLE public.club_owner_transfer_requests(
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 from_auth_user_id uuid NOT NULL REFERENCES public.profiles(id),
 to_auth_user_id uuid NOT NULL REFERENCES public.profiles(id),
 from_member_id uuid NOT NULL REFERENCES public.club_members(id),
 to_member_id uuid NOT NULL REFERENCES public.club_members(id),
 status text NOT NULL DEFAULT 'pending'
   CONSTRAINT task08_h19_transfer_status_check CHECK(status IN('pending','accepted','declined','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 responded_at timestamptz,
 CONSTRAINT task08_h19_transfer_distinct_accounts CHECK(
  from_auth_user_id<>to_auth_user_id AND from_member_id<>to_member_id),
 CONSTRAINT task08_h19_transfer_response_consistency CHECK(
  (status='pending' AND responded_at IS NULL)
  OR (status<>'pending' AND responded_at IS NOT NULL))
);
CREATE UNIQUE INDEX task08_h19_one_pending_per_club
 ON public.club_owner_transfer_requests(club_id) WHERE status='pending';
CREATE INDEX task08_h19_transfer_inbox
 ON public.club_owner_transfer_requests(to_auth_user_id,created_at DESC);
CREATE INDEX task08_h19_transfer_outbox
 ON public.club_owner_transfer_requests(from_auth_user_id,created_at DESC);
ALTER TABLE public.club_owner_transfer_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_owner_transfer_requests FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE public.club_owner_transfer_requests IS
 'Owner-to-active-linked-main-admin transfer proposals. Only recipient acceptance moves clubs.owner_id. No automatic expiry.';

ALTER TABLE public.notifications
 ADD COLUMN related_owner_transfer_request_id uuid
 REFERENCES public.club_owner_transfer_requests(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.notifications.related_owner_transfer_request_id IS
 'Owner transfer notification reference. Read through current user notifications policy; no direct transfer-table access.';

-- In addition to the last-main-admin guard, protect the CURRENT owner's own
-- membership from demotion, suspension, unlink or deletion before acceptance.
-- After transfer only the NEW owner's membership has this protection.
CREATE FUNCTION security_private.task08_guard_current_owner_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $owner_guard$
DECLARE v_owner uuid;v_linked uuid;
BEGIN
 SELECT c.owner_id INTO v_owner FROM public.clubs c
 WHERE c.id=OLD.club_id AND c.is_active AND NOT coalesce(c.is_deleted,false)
 FOR UPDATE;
 IF NOT FOUND OR v_owner IS NULL THEN
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 SELECT pp.linked_auth_user_id INTO v_linked
 FROM public.player_profiles pp
 WHERE pp.id=OLD.player_profile_id AND pp.is_active;
 IF v_linked IS DISTINCT FROM v_owner THEN
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'オーナーを引き継いでから所属を削除してください'
   USING ERRCODE='42501'; END IF;
 IF NEW.club_id IS DISTINCT FROM OLD.club_id
 OR NEW.player_profile_id IS DISTINCT FROM OLD.player_profile_id
 OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
 OR NEW.role IS DISTINCT FROM 'main_admin'
 OR NEW.is_active IS DISTINCT FROM true OR NEW.status IS DISTINCT FROM 'active'
 THEN
  RAISE EXCEPTION 'オーナーを引き継いでから役職・在籍を変更してください'
   USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $owner_guard$;
REVOKE ALL ON FUNCTION security_private.task08_guard_current_owner_membership()
 FROM PUBLIC,anon,authenticated;
CREATE TRIGGER task08_h19_guard_current_owner_member
 BEFORE UPDATE OF role,is_active,status,club_id,profile_id,player_profile_id
 OR DELETE ON public.club_members
 FOR EACH ROW EXECUTE FUNCTION security_private.task08_guard_current_owner_membership();

CREATE FUNCTION public.get_club_owner_transfer_candidates(p_club_id uuid)
RETURNS TABLE(member_id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $candidates$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.clubs c
  JOIN public.club_members mine ON mine.club_id=c.id
  JOIN public.player_profiles mp ON mp.id=mine.player_profile_id AND mp.is_active
  WHERE c.id=p_club_id AND c.owner_id=auth.uid() AND c.is_active
   AND NOT coalesce(c.is_deleted,false)
   AND mine.role='main_admin' AND mine.is_active AND mine.status='active'
   AND mp.linked_auth_user_id=auth.uid())
 THEN RAISE EXCEPTION '所有権の引継ぎ候補を取得する権限がありません'
  USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT cm.id,coalesce(cm.club_display_name,pp.display_name)
 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id AND pp.is_active
 JOIN auth.users u ON u.id=pp.linked_auth_user_id AND u.email_confirmed_at IS NOT NULL
 WHERE cm.club_id=p_club_id AND cm.role='main_admin'
  AND cm.is_active AND cm.status='active'
  AND pp.linked_auth_user_id IS NOT NULL AND pp.linked_auth_user_id<>auth.uid()
 ORDER BY cm.created_at,cm.id;
END $candidates$;

CREATE FUNCTION public.request_club_owner_transfer(p_club_id uuid,p_to_member_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $request$
DECLARE v_actor uuid;v_owner uuid;v_source_member uuid;v_to_user uuid;
 v_count integer;v_request uuid;
BEGIN
 v_actor:=auth.uid();
 IF v_actor IS NULL OR p_club_id IS NULL OR p_to_member_id IS NULL
 THEN RAISE EXCEPTION 'ログインと引継ぎ先を確認してください' USING ERRCODE='42501'; END IF;

 -- Club is always the primary serialization lock. Matching all other
 -- owner/membership transitions at this boundary prevents stale approvals.
 SELECT c.owner_id INTO v_owner FROM public.clubs c
 WHERE c.id=p_club_id AND c.is_active AND NOT coalesce(c.is_deleted,false)
 FOR UPDATE;
 IF NOT FOUND OR v_owner IS DISTINCT FROM v_actor THEN
  RAISE EXCEPTION '現在のオーナー本人のみ申請できます' USING ERRCODE='42501'; END IF;
 SELECT count(*),min(cm.id) INTO v_count,v_source_member
 FROM public.club_members cm JOIN public.player_profiles pp
 ON pp.id=cm.player_profile_id AND pp.is_active
 WHERE cm.club_id=p_club_id AND cm.is_active AND cm.status='active'
  AND cm.role='main_admin' AND pp.linked_auth_user_id=v_actor;
 IF v_count<>1 THEN RAISE EXCEPTION '現オーナーの在籍・管理権限を確認してください'
  USING ERRCODE='42501'; END IF;
 SELECT count(*),min(pp.linked_auth_user_id) INTO v_count,v_to_user
 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id AND pp.is_active
 JOIN auth.users u ON u.id=pp.linked_auth_user_id AND u.email_confirmed_at IS NOT NULL
 WHERE cm.id=p_to_member_id AND cm.club_id=p_club_id
 AND cm.is_active AND cm.status='active' AND cm.role='main_admin'
 AND pp.linked_auth_user_id IS NOT NULL AND pp.linked_auth_user_id<>v_actor;
 IF v_count<>1 OR v_to_user IS NULL THEN
  RAISE EXCEPTION '連携済みの在籍メイン管理者を選択してください'
  USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.club_members cm
     JOIN public.player_profiles pp ON pp.id=cm.player_profile_id AND pp.is_active
     WHERE cm.club_id=p_club_id AND cm.is_active AND cm.status='active'
      AND pp.linked_auth_user_id=v_to_user)<>1
 THEN RAISE EXCEPTION '引継ぎ先の所属が複数あります' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.club_owner_transfer_requests r
  WHERE r.club_id=p_club_id AND r.status='pending')
 THEN RAISE SQLSTATE 'PT409' USING MESSAGE='承諾待ちの引継ぎ申請があります'; END IF;

 INSERT INTO public.club_owner_transfer_requests
  (club_id,from_auth_user_id,to_auth_user_id,from_member_id,to_member_id)
 VALUES(p_club_id,v_actor,v_to_user,v_source_member,p_to_member_id)
 RETURNING id INTO v_request;
 INSERT INTO public.notifications
  (target_auth_user_id,type,title,body,related_club_id,related_owner_transfer_request_id)
 VALUES(v_to_user,'club_owner_transfer_requested','オーナー引継ぎの依頼',
 '引き受けるか辞退するか、本人が確認してください。承諾までオーナーは変わりません。',
 p_club_id,v_request);
 RETURN v_request;
END $request$;

CREATE FUNCTION public.list_my_club_owner_transfers()
RETURNS TABLE(id uuid,club_id uuid,club_name text,status text,created_at timestamptz,
 responded_at timestamptz,is_sender boolean,is_recipient boolean,target_display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $list$
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT r.id,r.club_id,c.name,r.status,r.created_at,r.responded_at,
  r.from_auth_user_id=auth.uid(),r.to_auth_user_id=auth.uid(),
  coalesce(cm.club_display_name,pp.display_name)
 FROM public.club_owner_transfer_requests r
 JOIN public.clubs c ON c.id=r.club_id
 JOIN public.club_members cm ON cm.id=r.to_member_id AND cm.club_id=r.club_id
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE r.from_auth_user_id=auth.uid() OR r.to_auth_user_id=auth.uid()
 ORDER BY r.created_at DESC,r.id DESC LIMIT 100;
END $list$;

CREATE FUNCTION public.respond_club_owner_transfer(p_request_id uuid,p_decision text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $respond$
DECLARE v_actor uuid;v_club_id uuid;v_current_owner uuid;
 v_req public.club_owner_transfer_requests%ROWTYPE;
 v_count integer;v_target_member uuid;v_old_member uuid;
BEGIN
 v_actor:=auth.uid();
 IF v_actor IS NULL OR p_request_id IS NULL OR p_decision NOT IN('accepted','declined')
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

 -- Candidate must still be a distinct linked, active main administrator;
 -- owner must still be an active linked main administrator. No stale token
 -- can silently authorize a transfer when roles or ownership changed.
 SELECT count(*),min(cm.id) INTO v_count,v_old_member
 FROM public.club_members cm JOIN public.player_profiles pp
 ON pp.id=cm.player_profile_id AND pp.is_active
 WHERE cm.id=v_req.from_member_id AND cm.club_id=v_club_id
  AND cm.is_active AND cm.status='active' AND cm.role='main_admin'
  AND pp.linked_auth_user_id=v_req.from_auth_user_id;
 IF v_count<>1 THEN RAISE EXCEPTION '現オーナーの管理権限が無効です' USING ERRCODE='42501'; END IF;
 SELECT count(*),min(cm.id) INTO v_count,v_target_member
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
END $respond$;

CREATE FUNCTION public.cancel_club_owner_transfer(p_request_id uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $cancel$
DECLARE v_auth uuid;v_club_id uuid;v_current uuid;
 v_req public.club_owner_transfer_requests%ROWTYPE;v_count integer;
BEGIN
 v_auth:=auth.uid();
 IF v_auth IS NULL OR p_request_id IS NULL
 THEN RAISE EXCEPTION 'ログインと依頼情報を確認してください' USING ERRCODE='42501'; END IF;
 SELECT r.club_id INTO v_club_id FROM public.club_owner_transfer_requests r
 WHERE r.id=p_request_id AND r.from_auth_user_id=v_auth;
 IF NOT FOUND THEN RAISE EXCEPTION '取消権限がありません' USING ERRCODE='42501'; END IF;
 SELECT c.owner_id INTO v_current FROM public.clubs c
 WHERE c.id=v_club_id AND c.is_active AND NOT coalesce(c.is_deleted,false) FOR UPDATE;
 IF NOT FOUND OR v_current IS DISTINCT FROM v_auth THEN
  RAISE EXCEPTION '現在のオーナー本人だけが取り消せます'
    USING ERRCODE='42501'; END IF;
 SELECT * INTO v_req FROM public.club_owner_transfer_requests
 WHERE id=p_request_id AND club_id=v_club_id FOR UPDATE;
 IF NOT FOUND OR v_req.from_auth_user_id IS DISTINCT FROM v_auth OR v_req.status<>'pending'
 THEN RAISE SQLSTATE 'PT409' USING MESSAGE='引継ぎ依頼は既に更新されています'; END IF;
 UPDATE public.club_owner_transfer_requests
 SET status='cancelled',responded_at=statement_timestamp()
 WHERE id=p_request_id AND status='pending';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION '取消状態の保存に失敗しました' USING ERRCODE='42501'; END IF;
 INSERT INTO public.notifications
 (target_auth_user_id,type,title,body,related_club_id,related_owner_transfer_request_id)
 VALUES(v_req.to_auth_user_id,'club_owner_transfer_cancelled',
 'オーナー引継ぎの依頼が取り消されました','グループのオーナーは変更されていません。',
 v_club_id,p_request_id);
 RETURN 'cancelled';
END $cancel$;

REVOKE ALL ON FUNCTION public.get_club_owner_transfer_candidates(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.request_club_owner_transfer(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_my_club_owner_transfers() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.respond_club_owner_transfer(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_club_owner_transfer(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_owner_transfer_candidates(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_club_owner_transfer(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_club_owner_transfers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_club_owner_transfer(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_club_owner_transfer(uuid) TO authenticated;

DO $postflight$
DECLARE fn text;
BEGIN
 FOR fn IN SELECT unnest(ARRAY[
 'get_club_owner_transfer_candidates(uuid)',
 'request_club_owner_transfer(uuid,uuid)',
 'list_my_club_owner_transfers()',
 'respond_club_owner_transfer(uuid,text)',
 'cancel_club_owner_transfer(uuid)'])
 LOOP
  IF NOT has_function_privilege('authenticated',('public.'||fn)::regprocedure,'EXECUTE')
   OR has_function_privilege('anon',('public.'||fn)::regprocedure,'EXECUTE')
  THEN RAISE EXCEPTION 'H19 public RPC grant violation: %',fn; END IF;
 END LOOP;
 IF has_table_privilege('authenticated','public.club_owner_transfer_requests','SELECT')
 OR has_table_privilege('authenticated','public.club_owner_transfer_requests','UPDATE')
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.club_owner_transfer_requests'::regclass)
 OR (SELECT count(*) FROM pg_trigger WHERE tgname='task08_h19_guard_current_owner_member'
 AND tgrelid='public.club_members'::regclass AND tgenabled IN('O','A'))<>1
 THEN RAISE EXCEPTION 'H19 owner handover storage security violation'; END IF;
END $postflight$;
COMMIT;