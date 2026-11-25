-- TASK-08-03 / #264 / ChatGPT candidate 01, 2026-11-25.
-- NOT approved for production. Independent review and isolated tests required.
-- Base main 19592bc79a94fe64ed52903ca317cad7fb025ec6; function body fingerprints from production READ ONLY.
-- Transactional candidate. No manual migration-history INSERT.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Unexpected migration role'; END IF;
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.save_club_member_display_name(uuid,uuid,text,text,boolean)')) IS DISTINCT FROM 'bb13bc56e7d80578fe39ed80e208aa3d' THEN RAISE EXCEPTION 'Baseline changed: save_club_member_display_name'; END IF;
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.get_club_roster(uuid)')) IS DISTINCT FROM 'b3ab28d89bd2c8ea2fb3a838cfe5a322' THEN RAISE EXCEPTION 'Baseline changed: get_club_roster'; END IF;
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.get_public_club_directory(uuid)')) IS DISTINCT FROM '59277fc5f9a4f4c0ce691f62d5a0a8d5' THEN RAISE EXCEPTION 'Baseline changed: get_public_club_directory'; END IF;
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)')) IS DISTINCT FROM '5ae4be0c796eb5eba627c1671a68b8db' THEN RAISE EXCEPTION 'Baseline changed: submit_profile_join_request_named'; END IF;
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)')) IS DISTINCT FROM 'fc0e3a68ac39ec3358de044f72a07fa0' THEN RAISE EXCEPTION 'Baseline changed: submit_public_club_claim_named'; END IF;
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('profile_link_private.apply_named_join_after_approval()')) IS DISTINCT FROM '4b6a71777141d8f0db10380163b7cb65' THEN RAISE EXCEPTION 'Baseline changed: apply_named_join_after_approval'; END IF;
 IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.review_player_profile_link_named(uuid,text,text,text,boolean)')) IS DISTINCT FROM '3177a20ce5723492d99d9667adb194e8' THEN RAISE EXCEPTION 'Baseline changed: review_player_profile_link_named'; END IF;
 IF to_regprocedure('public.save_club_member_field_v2(uuid,uuid,text,text,boolean,text,text,boolean,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'New endpoint already exists'; END IF;
END $preflight$;

-- Keep legacy confirmation timestamps truthful. NULL choice + old timestamp
-- means legacy explicit ON; NULL + no timestamp means no selection.
ALTER TABLE public.club_members ADD COLUMN club_name_public_choice text;
ALTER TABLE public.club_members ADD CONSTRAINT task08_member_public_choice_valid CHECK (
 club_name_public_choice IS NULL OR
 (club_display_name IS NOT NULL AND
  ((club_name_public_choice='on' AND club_display_name_public_confirmed_at IS NOT NULL)
   OR (club_name_public_choice IN ('off','default_on') AND club_display_name_public_confirmed_at IS NULL))));
COMMENT ON COLUMN public.club_members.club_name_public_choice IS
 'NULL legacy/unselected; on/off explicit user choice; default_on approved initialization without affirmative confirmation. Effective external visibility also requires public active club and valid membership.';
ALTER TABLE public.join_requests ADD COLUMN club_name_public_choice text;
ALTER TABLE public.join_requests DROP CONSTRAINT task08_h17_join_public_consent_pair;
ALTER TABLE public.join_requests ADD CONSTRAINT task08_h17_join_public_consent_pair CHECK (
 (club_display_name_requested IS NULL AND club_display_name_confirmed_at IS NULL AND club_name_public_choice IS NULL)
 OR (club_display_name_requested IS NOT NULL AND (
   (club_name_public_choice IS NULL AND club_display_name_confirmed_at IS NOT NULL)
   OR (club_name_public_choice IS NOT DISTINCT FROM 'on' AND club_display_name_confirmed_at IS NOT NULL)
   OR (club_name_public_choice IS NOT DISTINCT FROM 'off' AND club_display_name_confirmed_at IS NULL))));
ALTER TABLE public.player_profile_link_requests ADD COLUMN club_name_public_choice text;
ALTER TABLE public.player_profile_link_requests ADD CONSTRAINT task08_link_public_choice_valid CHECK (
 club_name_public_choice IS NULL OR
 (club_display_name_selected IS NOT NULL AND
  ((club_name_public_choice='on' AND club_display_name_public_confirmed_at IS NOT NULL)
   OR (club_name_public_choice='off' AND club_display_name_public_confirmed_at IS NULL))));

-- Existing authenticated INSERT grant is table-wide. Do not rely on a
-- column REVOKE to override it. Direct inserts must not supply protected
-- choice or confirmation; ordinary owner/guest inserts omit both.
CREATE FUNCTION group_read_private.guard_member_public_choice() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $guard$
BEGIN
 IF current_user IN ('anon','authenticated') THEN
  IF TG_OP='INSERT' THEN
   IF NEW.club_name_public_choice IS NOT NULL OR NEW.club_display_name_public_confirmed_at IS NOT NULL
   THEN RAISE EXCEPTION '公開設定は本人用の保存経路を使用してください' USING ERRCODE='42501'; END IF;
  ELSIF NEW.club_name_public_choice IS DISTINCT FROM OLD.club_name_public_choice
     OR NEW.club_display_name_public_confirmed_at IS DISTINCT FROM OLD.club_display_name_public_confirmed_at THEN
   RAISE EXCEPTION '公開設定は本人用の保存経路を使用してください' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION group_read_private.guard_member_public_choice() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER task08_guard_member_public_choice BEFORE INSERT OR UPDATE OF club_name_public_choice,club_display_name_public_confirmed_at
 ON public.club_members FOR EACH ROW EXECUTE FUNCTION group_read_private.guard_member_public_choice();

-- Serialize with profile linking. Lock the affected tables before the
-- aggregate preflight / data update; do not race a membership re-link.
SELECT profile_link_private.serialize_operations();
LOCK TABLE public.clubs,public.club_members,public.player_profiles IN SHARE ROW EXCLUSIVE MODE;

-- Backfill only current valid linked members. No history, global names,
-- inactive/deleted clubs, unlinked/invalid profiles or existing aliases rewritten.
-- Release preflight will separately recheck aggregate counts (baseline 5/4).
WITH eligible AS (
 SELECT cm.id,btrim(pp.display_name) AS alias,c.visibility,
  cm.club_display_name IS NULL AS needs_name,
  c.visibility='public' AND cm.club_display_name_public_confirmed_at IS NULL
    AND cm.club_name_public_choice IS NULL AS needs_default
 FROM public.club_members cm
 JOIN public.clubs c ON c.id=cm.club_id
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE c.is_active AND NOT c.is_deleted AND cm.is_active AND cm.status='active'
   AND pp.is_active AND pp.linked_auth_user_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=pp.linked_auth_user_id)
   AND (SELECT count(*) FROM public.player_profiles x WHERE x.is_active AND x.linked_auth_user_id=pp.linked_auth_user_id)=1
   AND char_length(btrim(pp.display_name)) BETWEEN 1 AND 120 AND btrim(pp.display_name) !~ '[[:cntrl:]]'
   AND (cm.club_display_name IS NULL OR
    (char_length(cm.club_display_name) BETWEEN 1 AND 120 AND cm.club_display_name !~ '[[:cntrl:]]'))
)
UPDATE public.club_members cm
SET club_display_name=CASE WHEN e.needs_name THEN e.alias ELSE cm.club_display_name END,
 club_name_public_choice=CASE WHEN e.needs_default THEN 'default_on' ELSE cm.club_name_public_choice END
FROM eligible e WHERE cm.id=e.id AND (e.needs_name OR e.needs_default);

CREATE OR REPLACE FUNCTION public.get_club_roster(p_club_id uuid)
 RETURNS TABLE(id uuid, club_id uuid, profile_id uuid, player_profile_id uuid, role text, is_active boolean, status text, created_at timestamp with time zone, player_profiles jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 PERFORM group_read_private.require_member(p_club_id);
 RETURN QUERY SELECT cm.id,cm.club_id,cm.profile_id,cm.player_profile_id,cm.role,
 cm.is_active,cm.status,cm.created_at,
 jsonb_build_object('id',pp.id,'display_name',pp.display_name,
  'linked_auth_user_id',pp.linked_auth_user_id,'is_active',pp.is_active,
  'club_display_name',cm.club_display_name,
  'public_name_confirmed',cm.club_display_name_public_confirmed_at IS NOT NULL,
  'public_name_choice',cm.club_name_public_choice,
  'public_name_enabled',CASE WHEN c.visibility='public' AND c.is_active AND NOT c.is_deleted AND cm.is_active AND cm.status='active' AND pp.is_active AND pp.linked_auth_user_id IS NOT NULL AND cm.club_display_name IS NOT NULL THEN coalesce(cm.club_name_public_choice IN ('on','default_on'),cm.club_display_name_public_confirmed_at IS NOT NULL) ELSE false END,
  'group_visibility',c.visibility)
 FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=p_club_id
   AND ((cm.is_active) OR public.can_manage_player_profile_club(p_club_id))
 ORDER BY cm.created_at,cm.id;
END $function$;
CREATE OR REPLACE FUNCTION public.get_public_club_directory(p_club_id uuid)
 RETURNS TABLE(reference uuid, display_name text, is_unlinked boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.clubs
   WHERE id=p_club_id AND is_active AND NOT coalesce(is_deleted,false)
     AND visibility='public') THEN
  RAISE EXCEPTION '公開グループを確認できません' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 SELECT r.public_ref,
   CASE WHEN pp.linked_auth_user_id IS NULL
     THEN coalesce(cm.club_display_name,pp.display_name)
     ELSE cm.club_display_name END,
   pp.linked_auth_user_id IS NULL
 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 JOIN group_read_private.directory_refs r ON r.member_id=cm.id
 WHERE cm.club_id=p_club_id AND cm.is_active AND cm.status='active' AND pp.is_active
   AND (pp.linked_auth_user_id IS NULL OR
        (cm.club_display_name IS NOT NULL AND
         coalesce(cm.club_name_public_choice IN ('on','default_on'),cm.club_display_name_public_confirmed_at IS NOT NULL)))
 ORDER BY 2,1;
END $function$;
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
  -- Old client has no public-choice CAS; do not allow it to undo explicit OFF.
  RAISE EXCEPTION '最新版の画面に再読み込みしてから編集してください' USING ERRCODE='PT409';
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
END $function$;

-- New field-specific update endpoint. Compare raw alias, raw choice,
-- legacy confirmed boolean and visibility; never silently overwrite.
CREATE FUNCTION public.save_club_member_field_v2(
 p_club_id uuid,p_member_id uuid,p_field text,p_name text,p_public boolean,
 p_expected_name text,p_expected_choice text,p_expected_confirmed boolean,p_expected_visibility text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $save$
DECLARE
 v_auth uuid:=auth.uid(); v_visibility text; v_member public.club_members%ROWTYPE;
 v_player public.player_profiles%ROWTYPE; v_name text; v_choice text; v_confirmed timestamptz;
BEGIN
 IF v_auth IS NULL OR p_club_id IS NULL OR p_member_id IS NULL THEN
  RAISE EXCEPTION 'ログインと所属情報を確認してください' USING ERRCODE='42501'; END IF;
 IF p_field IS NULL OR p_field NOT IN ('name','public') OR p_expected_confirmed IS NULL
 OR (p_field='name' AND (p_name IS NULL OR p_public IS NOT NULL))
 OR (p_field='public' AND (p_name IS NOT NULL OR p_public IS NULL)) THEN
  RAISE EXCEPTION '変更内容を確認してください' USING ERRCODE='22023'; END IF;
 PERFORM profile_link_private.serialize_operations();
 SELECT c.visibility INTO v_visibility FROM public.clubs c WHERE c.id=p_club_id AND c.is_active AND NOT c.is_deleted FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'グループの所属を確認できません' USING ERRCODE='42501'; END IF;
 SELECT cm.* INTO v_member FROM public.club_members cm
 WHERE cm.id=p_member_id AND cm.club_id=p_club_id AND cm.is_active AND cm.status='active' FOR UPDATE;
 IF NOT FOUND OR v_member.player_profile_id IS NULL THEN RAISE EXCEPTION '有効な所属がありません' USING ERRCODE='42501'; END IF;
 SELECT pp.* INTO v_player FROM public.player_profiles pp WHERE pp.id=v_member.player_profile_id AND pp.is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '選手情報を確認できません' USING ERRCODE='42501'; END IF;
 IF v_player.linked_auth_user_id IS NOT NULL THEN
  IF v_player.linked_auth_user_id<>v_auth
     OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v_auth)
     OR (SELECT count(*) FROM public.player_profiles p WHERE p.is_active AND p.linked_auth_user_id=v_auth)<>1 THEN
   RAISE EXCEPTION '連携済みの表示名・公開設定は本人のみ変更できます' USING ERRCODE='42501'; END IF;
 ELSE
  IF p_field<>'name' OR NOT public.can_edit_player_profile_member(p_club_id,v_member.role) THEN
   RAISE EXCEPTION '仮メンバーの変更権限がありません' USING ERRCODE='42501'; END IF;
 END IF;
 IF v_member.club_display_name IS DISTINCT FROM p_expected_name
 OR v_member.club_name_public_choice IS DISTINCT FROM p_expected_choice
 OR (v_member.club_display_name_public_confirmed_at IS NOT NULL) IS DISTINCT FROM p_expected_confirmed
 OR v_visibility IS DISTINCT FROM p_expected_visibility THEN
  RAISE SQLSTATE 'PT409' USING MESSAGE='表示名または公開設定が更新されました。再読み込みしてください'; END IF;
 v_name:=v_member.club_display_name;
 v_choice:=v_member.club_name_public_choice;
 v_confirmed:=v_member.club_display_name_public_confirmed_at;
 IF p_field='name' THEN
  v_name:=btrim(p_name);
  IF v_member.club_display_name IS NULL AND v_player.linked_auth_user_id IS NOT NULL
     AND v_visibility='public' AND v_choice IS NULL AND v_confirmed IS NULL THEN
   -- First name initialization in a public group; default, not explicit consent.
   v_choice:='default_on';
  END IF;
 ELSE
  IF v_visibility<>'public' THEN RAISE EXCEPTION '非公開グループでは外部公開を変更できません' USING ERRCODE='42501'; END IF;
  -- A newly created membership with no alias can initialize from its own
  -- canonical name at the first explicit public toggle; never use email/ID.
  IF v_name IS NULL THEN v_name:=btrim(v_player.display_name); END IF;
  v_choice:=CASE WHEN p_public THEN 'on' ELSE 'off' END;
  v_confirmed:=CASE WHEN p_public THEN statement_timestamp() ELSE NULL END;
 END IF;
 IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 120 OR v_name ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'グループ内表示名を確認してください' USING ERRCODE='22023'; END IF;
 UPDATE public.club_members SET club_display_name=v_name,club_name_public_choice=v_choice,
  club_display_name_public_confirmed_at=v_confirmed
 WHERE id=v_member.id AND club_id=p_club_id;
 RETURN jsonb_build_object('member_id',v_member.id,'club_display_name',v_name,
  'public_name_choice',v_choice,'public_name_confirmed',v_confirmed IS NOT NULL,
  'public_name_enabled',v_visibility='public' AND v_player.linked_auth_user_id IS NOT NULL
      AND coalesce(v_choice IN ('on','default_on'),v_confirmed IS NOT NULL),
  'group_visibility',v_visibility);
END $save$;
REVOKE ALL ON FUNCTION public.save_club_member_field_v2(uuid,uuid,text,text,boolean,text,text,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_club_member_field_v2(uuid,uuid,text,text,boolean,text,text,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_profile_join_request_named(p_club_id uuid, p_member_id uuid, p_message text, p_review_token text, p_club_display_name text, p_public_confirmation boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_auth uuid;v_name text;v_request uuid;
BEGIN
 v_auth:=auth.uid();
 v_name:=btrim(p_club_display_name);
 IF v_auth IS NULL OR p_club_id IS NULL THEN
  RAISE EXCEPTION 'ログインして加入先を確認してください' USING ERRCODE='42501';
 END IF;
 IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 120
   OR v_name ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'グループ内表示名を確認してください' USING ERRCODE='22023';
 END IF;
 IF p_public_confirmation IS NULL THEN
  RAISE EXCEPTION '公開設定を選択してください' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs
   WHERE id=p_club_id AND is_active AND NOT coalesce(is_deleted,false)
     AND visibility='public') THEN
  RAISE EXCEPTION '公開グループを確認できません' USING ERRCODE='42501';
 END IF;

 -- The original join request and its consent snapshot remain authoritative.
 -- If the old function rejects the merge preview or permissions, the entire
 -- wrapper call (including requested name) is rolled back.
 v_request:=public.submit_profile_join_request(
   p_club_id,p_member_id,p_message,p_review_token);
 UPDATE public.join_requests SET club_display_name_requested=v_name,
   club_display_name_confirmed_at=CASE WHEN p_public_confirmation THEN statement_timestamp() ELSE NULL END,
   club_name_public_choice=CASE WHEN p_public_confirmation THEN 'on' ELSE 'off' END
 WHERE id=v_request AND club_id=p_club_id
   AND requester_auth_user_id=v_auth AND status='pending';
 IF NOT FOUND THEN
  RAISE EXCEPTION '申請情報が更新されました。再度やり直してください' USING ERRCODE='42501';
 END IF;
 RETURN v_request;
END $function$;
-- Existing public claim gateway unchanged; it calls the named internal function.
CREATE OR REPLACE FUNCTION profile_link_private.apply_named_join_after_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_member uuid;v_count bigint;v_confirmed timestamptz;
BEGIN
 IF NOT (OLD.status='pending' AND NEW.status='approved'
   AND NEW.club_display_name_requested IS NOT NULL) THEN RETURN NEW; END IF;

 IF (NEW.club_name_public_choice IS DISTINCT FROM 'off' AND NEW.club_display_name_confirmed_at IS NULL)
 OR NEW.club_display_name_confirmed_at > statement_timestamp()
 OR (NEW.club_name_public_choice='off' AND NEW.club_display_name_confirmed_at IS NOT NULL)
 OR NEW.requester_auth_user_id IS NULL
 THEN RAISE EXCEPTION '加入申請の公開確認を検証できません' USING ERRCODE='42501'; END IF;

 -- The name is never copied from a global profile or a provisional member
 -- without the requester's affirmative preview; source snapshot is still
 -- checked by the original review RPC before it writes approved status.
 SELECT cm.id INTO v_member FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=NEW.club_id AND cm.is_active AND cm.status='active'
   AND pp.is_active AND pp.linked_auth_user_id=NEW.requester_auth_user_id
 FOR UPDATE OF cm;
 IF NOT FOUND THEN
  RAISE EXCEPTION '承認対象の本人所属が見つかりません' USING ERRCODE='42501';
 END IF;

 UPDATE public.club_members SET
   club_display_name=NEW.club_display_name_requested,
   club_display_name_public_confirmed_at=NEW.club_display_name_confirmed_at,
   club_name_public_choice=NEW.club_name_public_choice
 WHERE id=v_member AND club_id=NEW.club_id;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN
  RAISE EXCEPTION 'グループ内表示名を反映できません' USING ERRCODE='42501';
 END IF;

 -- When an unlinked provisional profile is merged during this approval,
 -- merge_profiles already logged club_members.before_row/after_row before
 -- this alias update. Refresh the AFTER snapshot to include the final alias
 -- and consent; otherwise a later checked merge-restore could incorrectly
 -- treat this legitimate approval write as an external modification.
 IF EXISTS(SELECT 1 FROM public.player_profile_merges m
   WHERE m.join_request_id=NEW.id AND m.restored_at IS NULL) THEN
   UPDATE profile_link_private.merge_changes changes
   SET after_row=to_jsonb(cm)
   FROM public.player_profile_merges m
   JOIN public.club_members cm ON cm.id=v_member
   WHERE m.join_request_id=NEW.id AND m.restored_at IS NULL
     AND changes.merge_id=m.id
     AND changes.source_schema='public' AND changes.source_table='club_members'
     AND changes.row_id=v_member;
   GET DIAGNOSTICS v_count=ROW_COUNT;
   IF v_count<>1 THEN
     RAISE EXCEPTION 'プロフィール統合の変更履歴が一致しません。加入承認を中止しました'
       USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.review_player_profile_link_named(p_request_id uuid, p_review_token text, p_club_display_name text, p_expected_club_display_name text, p_public_confirmation boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

 IF p_public_confirmation IS NULL THEN
   RAISE EXCEPTION '公開設定を選択してください' USING ERRCODE='22023'; END IF;
 IF v_visibility='private' AND p_public_confirmation IS TRUE THEN
   RAISE EXCEPTION '非公開グループでは公開同意の登録はできません' USING ERRCODE='42501'; END IF;
 v_confirmed:=CASE WHEN v_visibility='public' AND p_public_confirmation THEN statement_timestamp() ELSE NULL END;

 -- Existing routine checks original one-time preview token, authorization,
 -- source scope, canonical profile, previous membership state and merges.
 -- All changes in this function share one transaction and roll back on error.
 v_review:=profile_link_private.review_player_profile_link_original(p_request_id,'approved',p_review_token);
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
   club_display_name_public_confirmed_at=v_confirmed,
   club_name_public_choice=CASE WHEN v_visibility='public' THEN CASE WHEN p_public_confirmation THEN 'on' ELSE 'off' END ELSE NULL END
 WHERE id=v_source.id AND club_id=v_req.club_id AND is_active AND status='active';
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN RAISE EXCEPTION '所属表示名を保存できません' USING ERRCODE='42501'; END IF;

 UPDATE public.player_profile_link_requests
 SET club_display_name_selected=v_chosen,
   club_display_name_public_confirmed_at=v_confirmed,
   club_name_public_choice=CASE WHEN v_visibility='public' THEN CASE WHEN p_public_confirmation THEN 'on' ELSE 'off' END ELSE NULL END
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
  'public_name_confirmed',v_confirmed IS NOT NULL,
  'public_name_enabled',v_visibility='public' AND p_public_confirmation);
END $function$;

DO $postflight$
BEGIN
 IF has_function_privilege('anon','public.save_club_member_field_v2(uuid,uuid,text,text,boolean,text,text,boolean,text)','EXECUTE')
 OR has_function_privilege('service_role','public.save_club_member_field_v2(uuid,uuid,text,text,boolean,text,text,boolean,text)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.save_club_member_field_v2(uuid,uuid,text,text,boolean,text,text,boolean,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 THEN RAISE EXCEPTION 'New API execution privileges invalid'; END IF;
END $postflight$;
COMMIT;
