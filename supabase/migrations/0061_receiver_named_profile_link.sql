-- TASK-08-03 / H18: receiver-confirmed club-scoped alias on administrator-initiated profile linking.
-- Stage-first forward migration. Old approval/rejection/cancellation APIs remain unchanged.
-- DO NOT APPLY TO PROD before the coordinated P0 ACL and RPC cutover.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('public.get_player_profile_link_request(uuid)') IS NULL
 OR to_regprocedure('public.review_player_profile_link(uuid,text,text)') IS NULL
 OR to_regprocedure('profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)') IS NULL
 OR to_regclass('profile_link_private.merge_changes') IS NULL
 OR to_regclass('public.player_profile_merges') IS NULL
 OR to_regprocedure('public.review_player_profile_link_named(uuid,text,text,text,boolean)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='player_profile_link_requests'
   AND column_name IN ('club_display_name_selected','club_display_name_public_confirmed_at'))
 THEN RAISE EXCEPTION 'H18 prerequisites missing or prior patch already present'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='club_members'
    AND column_name='club_display_name_public_confirmed_at')
 OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.get_player_profile_link_request(uuid)'::regprocedure)<>'postgres'
 OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.review_player_profile_link(uuid,text,text)'::regprocedure)<>'postgres'
 THEN RAISE EXCEPTION 'H18 current DTO and merge approval ownership mismatch'; END IF;
 IF position('profile_link_private.scoped_preview' IN
   (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE oid='public.get_player_profile_link_request(uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'H18 receiver-scoped preview missing'; END IF;
END $preflight$;

ALTER TABLE public.player_profile_link_requests
 ADD COLUMN club_display_name_selected text,
 ADD COLUMN club_display_name_public_confirmed_at timestamptz;
ALTER TABLE public.player_profile_link_requests
 ADD CONSTRAINT task08_h18_link_name_valid CHECK (
   club_display_name_selected IS NULL OR
   (club_display_name_selected=btrim(club_display_name_selected)
    AND char_length(club_display_name_selected) BETWEEN 1 AND 120
    AND club_display_name_selected !~ '[[:cntrl:]]'));
ALTER TABLE public.player_profile_link_requests
 ADD CONSTRAINT task08_h18_link_public_consent_pair CHECK (
   club_display_name_public_confirmed_at IS NULL
   OR club_display_name_selected IS NOT NULL);
COMMENT ON COLUMN public.player_profile_link_requests.club_display_name_selected IS
 'Chosen explicitly by target linked account during administrator-originated link approval; no legacy backfill.';
COMMENT ON COLUMN public.player_profile_link_requests.club_display_name_public_confirmed_at IS
 'Public club disclosure consent by target account during link approval; null for private/legacy.';

CREATE OR REPLACE FUNCTION public.get_player_profile_link_request(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare request public.player_profile_link_requests; result jsonb; recipient boolean;
begin
  select * into request from public.player_profile_link_requests where id = p_request_id;
  if not found or auth.uid() is null then
    raise exception 'この連携申請を確認する権限がありません';
  end if;
  recipient := request.target_auth_user_id = auth.uid();
  if not recipient and not public.can_manage_player_profile_club(request.club_id) then
    raise exception 'この連携申請を確認する権限がありません';
  end if;
  -- 全申請行をJSON化せず、画面で必要な共通列を列挙する。
  result := jsonb_build_object(
    'id', request.id, 'club_id', request.club_id,
    'club_name', (select name from public.clubs where id = request.club_id),
    'status', case when request.status = 'pending' and request.expires_at <= now() then 'expired' else request.status end,
    'created_at', request.created_at, 'expires_at', request.expires_at,
    'is_recipient', recipient, 'detail_scope', case when recipient then 'recipient' else 'manager' end
  );
  if recipient then
    -- ステージング固有のscoped_previewを維持し、元の同意preview/tokenの契約を変えない。
    -- 管理者を兼ねる場合も本人同意の枝を優先する。
    if request.status = 'pending' and request.expires_at > now() then
      result := result || profile_link_private.scoped_preview(request.source_player_profile_id, request.target_auth_user_id, request.club_id);
      -- Recipient-only group alias suggestion and raw optimistic-lock value.
      -- Does not expose any other group or authentication identity.
      result := result || coalesce((
        select jsonb_build_object(
          'group_display_name_suggestion',coalesce(cm.club_display_name,pp.display_name),
          'group_display_name_current',cm.club_display_name,
          'group_visibility',c.visibility)
        from public.club_members cm
        join public.player_profiles pp on pp.id=cm.player_profile_id
        join public.clubs c on c.id=cm.club_id
        where cm.id=request.source_club_member_id
          and cm.club_id=request.club_id
          and cm.player_profile_id=request.source_player_profile_id
          and cm.is_active and pp.is_active and c.is_active
          and not coalesce(c.is_deleted,false)
      ),'{}'::jsonb);
    end if;
  else
    -- 他グループを含むpreview/canonical/source_snapshotを管理者のために実行しない。
    result := result || jsonb_build_object(
      'source_display_name', (select pp.display_name from public.player_profiles pp
        join public.club_members cm on cm.id = request.source_club_member_id and cm.club_id = request.club_id
          and cm.player_profile_id = pp.id),
      'group_membership', (select jsonb_build_object(
        'role', cm.role, 'is_active', cm.is_active, 'created_at', cm.created_at
      ) from public.club_members cm
        where cm.id = request.source_club_member_id and cm.club_id = request.club_id)
    );
  end if;
  return result;
end $function$
;

-- Never hand the browser permission to mutate the raw link request table.
CREATE FUNCTION public.review_player_profile_link_named(
 p_request_id uuid,
 p_review_token text,
 p_club_display_name text,
 p_expected_club_display_name text,
 p_public_confirmation boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $named_approval$
DECLARE
 v_user uuid;v_req public.player_profile_link_requests%ROWTYPE;
 v_source public.club_members%ROWTYPE;v_visibility text;v_chosen text;
 v_review jsonb;v_merge uuid;v_count integer;v_confirmed timestamptz;
BEGIN
 v_user:=auth.uid();
 IF v_user IS NULL OR p_request_id IS NULL OR p_review_token IS NULL
    OR char_length(p_review_token)=0
 THEN RAISE EXCEPTION 'ログインと本人確認情報を確認してください' USING ERRCODE='42501'; END IF;
 v_chosen:=btrim(p_club_display_name);
 IF v_chosen IS NULL OR char_length(v_chosen) NOT BETWEEN 1 AND 120
    OR v_chosen ~ '[[:cntrl:]]'
 THEN RAISE EXCEPTION 'グループ内表示名を確認してください' USING ERRCODE='22023'; END IF;

 -- Use the same global lock as the original approval and profile merge.
 PERFORM profile_link_private.serialize_operations();
 SELECT * INTO v_req FROM public.player_profile_link_requests
 WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR v_req.target_auth_user_id<>v_user
   OR v_req.status<>'pending' OR v_req.expires_at<=now()
 THEN RAISE EXCEPTION '本人の有効な連携申請を確認できません' USING ERRCODE='42501'; END IF;

 SELECT c.visibility INTO v_visibility FROM public.clubs c
 WHERE c.id=v_req.club_id AND c.is_active AND NOT coalesce(c.is_deleted,false)
 FOR SHARE;
 IF NOT FOUND OR v_visibility NOT IN('public','private') THEN
   RAISE EXCEPTION '連携するグループが見つかりません' USING ERRCODE='42501'; END IF;

 SELECT cm.* INTO v_source FROM public.club_members cm
 WHERE cm.id=v_req.source_club_member_id AND cm.club_id=v_req.club_id
   AND cm.player_profile_id=v_req.source_player_profile_id AND cm.is_active
   AND cm.status='active'
 FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION '引継ぎ対象の所属を確認できません' USING ERRCODE='42501'; END IF;
 IF v_source.club_display_name IS DISTINCT FROM p_expected_club_display_name THEN
   RAISE SQLSTATE 'PT409' USING MESSAGE='仮登録名が更新されています。内容を再確認してください';
 END IF;

 IF v_visibility='public' AND p_public_confirmation IS NOT TRUE THEN
   RAISE EXCEPTION '公開グループのメンバー一覧への表示を確認してください' USING ERRCODE='42501'; END IF;
 IF v_visibility='private' AND p_public_confirmation IS TRUE THEN
   RAISE EXCEPTION '非公開グループでは公開同意の登録はできません' USING ERRCODE='42501'; END IF;
 v_confirmed:=CASE WHEN v_visibility='public' THEN statement_timestamp() ELSE NULL END;

 -- Existing routine checks original one-time preview token, authorization,
 -- source scope, canonical profile, previous membership state and merges.
 -- All changes in this function share one transaction and roll back on error.
 v_review:=public.review_player_profile_link(p_request_id,'approved',p_review_token);
 IF v_review->>'status'<>'approved' OR nullif(v_review->>'merge_id','') IS NULL
 THEN RAISE EXCEPTION '連携の承認が完了しませんでした' USING ERRCODE='42501'; END IF;
 v_merge:=(v_review->>'merge_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.player_profile_merges m WHERE m.id=v_merge
  AND m.link_request_id=p_request_id AND m.restored_at IS NULL)
 THEN RAISE EXCEPTION '連携履歴が一致しません' USING ERRCODE='42501'; END IF;

 -- Old merge must update the SAME original club member row.
 IF NOT EXISTS(SELECT 1 FROM public.club_members cm
  JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
  WHERE cm.id=v_source.id AND cm.club_id=v_req.club_id
   AND cm.is_active AND cm.status='active' AND pp.is_active
   AND pp.linked_auth_user_id=v_user)
 THEN RAISE EXCEPTION '本人と連携した所属を確認できません' USING ERRCODE='42501'; END IF;

 UPDATE public.club_members
 SET club_display_name=v_chosen,
   club_display_name_public_confirmed_at=v_confirmed
 WHERE id=v_source.id AND club_id=v_req.club_id AND is_active AND status='active';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION '所属表示名を保存できません' USING ERRCODE='42501'; END IF;

 UPDATE public.player_profile_link_requests
 SET club_display_name_selected=v_chosen,
   club_display_name_public_confirmed_at=v_confirmed
 WHERE id=p_request_id AND status='approved'
   AND reviewed_by_auth_user_id=v_user AND target_auth_user_id=v_user;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION '本人の同意を保存できません' USING ERRCODE='42501'; END IF;

 -- merge_profiles captured a before/after row before this named-approval
 -- update. Keep its AFTER snapshot synchronized so guarded restore works.
 UPDATE profile_link_private.merge_changes mc
 SET after_row=to_jsonb(cm)
 FROM public.club_members cm
 WHERE mc.merge_id=v_merge
   AND mc.source_schema='public' AND mc.source_table='club_members'
   AND mc.row_id=v_source.id AND cm.id=v_source.id;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN
  RAISE EXCEPTION '統合履歴の更新に失敗したため承認を中止しました' USING ERRCODE='42501'; END IF;

 RETURN v_review || jsonb_build_object(
  'club_display_name',v_chosen,
  'public_name_confirmed',v_confirmed IS NOT NULL);
END $named_approval$;

REVOKE ALL ON FUNCTION public.review_player_profile_link_named(uuid,text,text,text,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_player_profile_link_named(uuid,text,text,text,boolean)
 TO authenticated;

DO $postflight$
BEGIN
 IF has_function_privilege('anon','public.review_player_profile_link_named(uuid,text,text,text,boolean)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.review_player_profile_link_named(uuid,text,text,text,boolean)','EXECUTE')
 OR has_column_privilege('authenticated','public.player_profile_link_requests','club_display_name_selected','UPDATE')
 OR has_column_privilege('authenticated','public.player_profile_link_requests','club_display_name_public_confirmed_at','UPDATE')
 OR has_column_privilege('anon','public.player_profile_link_requests','club_display_name_public_confirmed_at','SELECT')
 OR position('group_display_name_suggestion' IN (SELECT pg_get_functiondef(oid)
   FROM pg_proc WHERE oid='public.get_player_profile_link_request(uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'H18 alias API privilege/DTO boundary mismatch'; END IF;
END $postflight$;
COMMIT;