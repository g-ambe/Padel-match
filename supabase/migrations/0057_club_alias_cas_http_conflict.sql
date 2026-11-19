-- TASK-08-03 / H16: distinguish optimistic CAS from serialization failures.
-- 40001 invokes PostgREST transaction retries, potentially HTTP 504.
-- PT409 intentionally returns HTTP 409, code PT409, without retry.
-- Forward-only after 0056. Stage first; no production action authorized.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $preflight$
BEGIN
 IF current_user<>'postgres' OR
 to_regprocedure('public.save_club_member_display_name(uuid,uuid,text,text,boolean)') IS NULL
 THEN RAISE EXCEPTION 'H16 CAS patch prerequisites missing'; END IF;
 IF (SELECT pg_get_userbyid(proowner) FROM pg_proc
 WHERE oid='public.save_club_member_display_name(uuid,uuid,text,text,boolean)'::regprocedure)<>'postgres'
 OR NOT (SELECT prosecdef FROM pg_proc
 WHERE oid='public.save_club_member_display_name(uuid,uuid,text,text,boolean)'::regprocedure)
 THEN RAISE EXCEPTION 'H16 CAS RPC owner/definer drift'; END IF;
 IF position('ERRCODE=''40001''' IN (SELECT pg_get_functiondef(oid) FROM pg_proc
 WHERE oid='public.save_club_member_display_name(uuid,uuid,text,text,boolean)'::regprocedure))=0
 THEN RAISE EXCEPTION 'H16 original CAS error not found; manual review needed'; END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.save_club_member_display_name(p_club_id uuid, p_member_id uuid, p_display_name text, p_expected_club_display_name text DEFAULT NULL::text, p_public_confirmation boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_auth uuid;v_visibility text;v_new_name text;v_target public.club_members%ROWTYPE;
        v_linked_auth uuid;v_public_confirmed_at timestamptz;
BEGIN
 v_auth:=auth.uid();
 v_new_name:=btrim(p_display_name);
 IF v_auth IS NULL OR p_club_id IS NULL OR p_member_id IS NULL THEN
  RAISE EXCEPTION 'ログインと所属情報を確認してください' USING ERRCODE='42501';
 END IF;
 IF v_new_name IS NULL OR char_length(v_new_name) NOT BETWEEN 1 AND 120
   OR v_new_name ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'グループ内表示名を確認してください' USING ERRCODE='22023';
 END IF;

 -- Lock club before member to avoid conflicting with group deletion/withdrawal.
 SELECT c.visibility INTO v_visibility FROM public.clubs c
 WHERE c.id=p_club_id AND c.is_active AND NOT coalesce(c.is_deleted,false)
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'グループの所属を確認できません' USING ERRCODE='42501'; END IF;

 SELECT cm.* INTO v_target FROM public.club_members cm
 WHERE cm.id=p_member_id AND cm.club_id=p_club_id
   AND cm.is_active AND cm.status='active' AND cm.player_profile_id IS NOT NULL
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '有効な所属がありません' USING ERRCODE='42501'; END IF;

 SELECT pp.linked_auth_user_id INTO v_linked_auth FROM public.player_profiles pp
 WHERE pp.id=v_target.player_profile_id AND pp.is_active
 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '選手情報を確認できません' USING ERRCODE='42501'; END IF;

 -- Existing alias is the optimistic-lock snapshot, not a player profile name.
 IF v_target.club_display_name IS DISTINCT FROM p_expected_club_display_name THEN
  RAISE SQLSTATE 'PT409' USING MESSAGE='表示名が更新されています。再読み込みしてください';
 END IF;

 IF v_linked_auth IS NOT NULL THEN
  -- Nobody, including main/sub admins and app superusers, may rename
  -- another account-linked player in this club.
  IF v_linked_auth<>v_auth THEN
    RAISE EXCEPTION '連携済みのグループ内表示名は本人のみ変更できます' USING ERRCODE='42501';
  END IF;
  -- A public club needs the linked user's affirmative warning acknowledgment.
  IF v_visibility='public' AND p_public_confirmation IS NOT TRUE THEN
    RAISE EXCEPTION '公開グループへの表示を確認してください' USING ERRCODE='42501';
  END IF;
  v_public_confirmed_at:=CASE WHEN v_visibility='public' THEN statement_timestamp() ELSE NULL END;
 ELSE
  -- Only authorized main/sub administrators may change unlinked entries;
  -- existing role restrictions (sub_admin cannot edit main_admin) are reused.
  IF NOT public.can_edit_player_profile_member(p_club_id,v_target.role) THEN
    RAISE EXCEPTION '仮メンバー名を変更する権限がありません' USING ERRCODE='42501';
  END IF;
  v_public_confirmed_at:=NULL;
 END IF;

 UPDATE public.club_members SET club_display_name=v_new_name,
   club_display_name_public_confirmed_at=v_public_confirmed_at
 WHERE id=v_target.id AND club_id=p_club_id;
 RETURN jsonb_build_object('member_id',v_target.id,
    'club_display_name',v_new_name,
    'public_name_confirmed',v_public_confirmed_at IS NOT NULL);
END $function$
;

DO $postflight$
BEGIN
 IF position('PT409' IN (SELECT pg_get_functiondef(oid) FROM pg_proc
 WHERE oid='public.save_club_member_display_name(uuid,uuid,text,text,boolean)'::regprocedure))=0
 OR has_function_privilege('anon','public.save_club_member_display_name(uuid,uuid,text,text,boolean)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.save_club_member_display_name(uuid,uuid,text,text,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'H16 conflict status or privilege boundary drift'; END IF;
END $postflight$;
COMMIT;
