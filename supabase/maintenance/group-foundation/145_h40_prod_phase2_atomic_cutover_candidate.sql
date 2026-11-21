-- TASK-08/H40 PROD PHASE-2 ATOMIC CUTOVER CANDIDATE (NOT AUTHORIZED TO APPLY).
-- Generated only from the verified exact files below in dependency order.
-- Never run with supabase db push; never run until a production migration-history
-- reconciliation, old/new app contract test, and production rollback decision are approved.
-- PRE-PHASE required: H12, H37 token click, 0054, 0055, H38-136, H38-137.
-- This single transaction prevents partial commits from 0056 through 0065.
-- ROLLBACK is automatic if any statement fails *before* COMMIT.
-- A successful COMMIT is NOT automatically reversible after the app is deployed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- H42 migration-history guard: refuse duplicate or out-of-order application.
DO $h42_phase2_history_gate$
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations
     WHERE name='task08_prod_phase1_additive')<>1
 OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
     WHERE name='task08_prod_phase2_atomic')
 OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name ~ '^task08_(stage|staging)_005[4-9]' OR name ~ '^task08_(stage|staging)_006[0-5]')
 THEN RAISE EXCEPTION 'H42: Phase2 requires unique committed Phase1 and no prior Phase2/Stage cutover';
 END IF;
END $h42_phase2_history_gate$;


DO $h40_prod_cutover_guard$
DECLARE detail text;
BEGIN
 IF current_user <> 'postgres'
 OR to_regprocedure('public.get_shared_event(text,text)') IS NULL
 OR to_regprocedure('public.record_event_video_click_by_token(uuid,text,text,text)') IS NULL
 OR to_regprocedure('public.record_event_video_link_click_by_token(uuid,text,text,text)') IS NULL
 OR to_regprocedure('public.record_official_video_click_by_token(uuid,text,text,text)') IS NULL
 OR to_regclass('group_read_private.directory_refs') IS NULL
 OR to_regprocedure('public.get_club_roster(uuid)') IS NULL
 OR to_regprocedure('public.get_club_join_requests(uuid)') IS NULL
 OR to_regprocedure('security_private.task08_guard_last_main_member()') IS NULL
 OR to_regprocedure('public.leave_my_club(uuid,uuid)') IS NULL
 OR NOT has_table_privilege('anon','public.club_members','SELECT')
 OR to_regprocedure('public.save_club_member_display_name(uuid,uuid,text,text,boolean)') IS NOT NULL
 OR to_regprocedure('profile_link_private.scoped_preview(uuid,uuid,uuid)') IS NOT NULL
 OR to_regclass('public.club_owner_transfer_requests') IS NOT NULL
 THEN RAISE EXCEPTION 'H40: production release prerequisites not satisfied'; END IF;
 SELECT pg_get_functiondef(p.oid) INTO detail
 FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_player_profile_link_request(uuid)');
 IF detail IS NULL OR position('to_jsonb(request)' IN detail)=0
 THEN RAISE EXCEPTION 'H40: old profile link DTO changed; abort'; END IF;
END $h40_prod_cutover_guard$;

-- [01] supabase/maintenance/group-foundation/138_h38_prod_alias_atomic_cutover_candidate.sql (source sha 2c1a55a65b8abc42042fb9d0989e606db4d91e51)
-- TASK-08 / H38: Prod-compatible ATOMIC alias cutover candidate. NOT approved for Prod.
-- Keep original 0056 DDL, guards, RPCs and consent behavior unchanged.
-- REVOKE anon club_members SELECT in the SAME transaction before 0056 columns are added.
-- New app must be deployed immediately after all required DB migrations have succeeded;
-- old anonymous group screens may temporarily stop working during the cutover window.
-- Never commit this in isolation or apply with stale app consumers.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $h38_acl_guard$
BEGIN
 IF current_user<>'postgres'
 OR NOT has_table_privilege('anon','public.club_members','SELECT')
 OR to_regnamespace('group_read_private') IS NULL
 OR to_regprocedure('public.get_public_club_directory(uuid)') IS NULL
 OR to_regprocedure('public.get_club_roster(uuid)') IS NULL
 OR EXISTS(SELECT 1 FROM pg_attribute
           WHERE attrelid='public.club_members'::regclass AND attnum>0
           AND NOT attisdropped AND attacl::text LIKE '%anon=%')
 THEN RAISE EXCEPTION 'H38: Prod cutover ACL or 0054/0055 dependencies drifted'; END IF;
END $h38_acl_guard$;
REVOKE SELECT ON TABLE public.club_members FROM PUBLIC,anon;
DO $h38_revoke_verify$
BEGIN
 IF has_any_column_privilege('anon','public.club_members','SELECT')
 THEN RAISE EXCEPTION 'H38: anonymous club_members grant remains; abort without DDL'; END IF;
END $h38_revoke_verify$;
-- The following is original 0056 after stripping only its outer BEGIN/COMMIT.

DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'H16 migration owner must be postgres'; END IF;
 IF to_regprocedure('public.get_public_club_directory(uuid)') IS NULL
 OR to_regprocedure('public.get_club_roster(uuid)') IS NULL
 OR to_regprocedure('public.can_edit_player_profile_member(uuid,text)') IS NULL
 OR to_regclass('group_read_private.directory_refs') IS NULL
 THEN RAISE EXCEPTION 'H16 group read RPC prerequisites are missing'; END IF;
 IF has_any_column_privilege('anon','public.club_members','SELECT') THEN
  RAISE EXCEPTION 'H16 cannot expose names while anon can read club_members directly'; END IF;
 IF to_regprocedure('public.save_club_member_display_name(uuid,uuid,text,text,boolean)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='club_members'
     AND column_name IN('club_display_name','club_display_name_public_confirmed_at'))
 THEN RAISE EXCEPTION 'H16 display-name schema already exists: review before retry'; END IF;
END $preflight$;

ALTER TABLE public.club_members ADD COLUMN club_display_name text;
ALTER TABLE public.club_members ADD COLUMN club_display_name_public_confirmed_at timestamptz;
ALTER TABLE public.club_members ADD CONSTRAINT task08_club_display_name_valid
 CHECK (club_display_name IS NULL OR
   (club_display_name=btrim(club_display_name)
     AND char_length(club_display_name) BETWEEN 1 AND 120));
ALTER TABLE public.club_members ADD CONSTRAINT task08_club_name_confirmation_requires_name
 CHECK (club_display_name_public_confirmed_at IS NULL OR club_display_name IS NOT NULL);
COMMENT ON COLUMN public.club_members.club_display_name IS
 'Group-specific display alias; nullable for existing members pending user confirmation. Never overwrite player_profiles.display_name.';
COMMENT ON COLUMN public.club_members.club_display_name_public_confirmed_at IS
 'Timestamp of explicit public-group alias confirmation by linked account owner. Null names must not be publicly exposed.';

-- No direct UPDATE grant for the added alias/consent columns. Existing member
-- UPDATE privileges for is_active etc remain exactly as they were.
CREATE FUNCTION public.save_club_member_display_name(
 p_club_id uuid, p_member_id uuid, p_display_name text,
 p_expected_club_display_name text DEFAULT NULL,
 p_public_confirmation boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $save_alias$
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
  RAISE EXCEPTION '表示名が更新されています。再読み込みしてください' USING ERRCODE='40001';
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
END $save_alias$;
REVOKE ALL ON FUNCTION public.save_club_member_display_name(uuid,uuid,text,text,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_club_member_display_name(uuid,uuid,text,text,boolean)
 TO authenticated;

-- Keep the existing roster RPC signature. Only club members/admins can call it;
-- the new group-scoped alias is an additional field inside the existing JSONB
-- detail payload. The global player profile name remains separate and unchanged.
CREATE OR REPLACE FUNCTION public.get_club_roster(p_club_id uuid)
RETURNS TABLE(id uuid,club_id uuid,profile_id uuid,player_profile_id uuid,
 role text,is_active boolean,status text,created_at timestamptz,player_profiles jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $roster$
BEGIN
 PERFORM group_read_private.require_member(p_club_id);
 RETURN QUERY SELECT cm.id,cm.club_id,cm.profile_id,cm.player_profile_id,cm.role,
 cm.is_active,cm.status,cm.created_at,
 jsonb_build_object('id',pp.id,'display_name',pp.display_name,
  'linked_auth_user_id',pp.linked_auth_user_id,'is_active',pp.is_active,
  'club_display_name',cm.club_display_name,
  'public_name_confirmed',cm.club_display_name_public_confirmed_at IS NOT NULL)
 FROM public.club_members cm LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=p_club_id
   AND ((cm.is_active) OR public.can_manage_player_profile_club(p_club_id))
 ORDER BY cm.created_at,cm.id;
END $roster$;

-- Public directory: exactly 3 preexisting fields, no account/profile IDs,
-- no roles, no email. For legacy linked users with NULL/unconfirmed alias,
-- OMIT the row (not an inferred profile name or blanket "メンバー" placeholder).
-- Existing unlinked provisional entries remain visible by their registered name.
CREATE OR REPLACE FUNCTION public.get_public_club_directory(p_club_id uuid)
RETURNS TABLE(reference uuid,display_name text,is_unlinked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $directory$
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
         cm.club_display_name_public_confirmed_at IS NOT NULL))
 ORDER BY 2,1;
END $directory$;

-- Re-assert original RPC privileges; do not open base-table SELECT.
REVOKE ALL ON FUNCTION public.get_club_roster(uuid),
 public.get_public_club_directory(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_roster(uuid),
 public.get_public_club_directory(uuid) TO authenticated;

DO $postflight$
BEGIN
 IF has_any_column_privilege('anon','public.club_members','SELECT')
 OR has_column_privilege('anon','public.club_members','club_display_name','SELECT')
 OR has_column_privilege('anon','public.club_members','club_display_name','UPDATE')
 OR has_column_privilege('authenticated','public.club_members','club_display_name','UPDATE')
 OR has_column_privilege('authenticated','public.club_members','club_display_name_public_confirmed_at','UPDATE')
 OR has_function_privilege('anon','public.save_club_member_display_name(uuid,uuid,text,text,boolean)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.save_club_member_display_name(uuid,uuid,text,text,boolean)','EXECUTE')
 OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.save_club_member_display_name(uuid,uuid,text,text,boolean)'::regprocedure)
 THEN RAISE EXCEPTION 'H16 alias privacy boundary check failed'; END IF;
END $postflight$;
-- [01] END

-- [02] supabase/migrations/0057_club_alias_cas_http_conflict.sql (source sha f5b1d19324604e34d5ca34c21c739b3f18d03e3b)
-- TASK-08-03 / H16: distinguish optimistic CAS from serialization failures.
-- 40001 invokes PostgREST transaction retries, potentially HTTP 504.
-- PT409 intentionally returns HTTP 409, code PT409, without retry.
-- Forward-only after 0056. Stage first; no production action authorized.

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
-- [02] END

-- [03] supabase/migrations/0058_public_join_alias_consent.sql (source sha f8514a1529984a6e709a8c34d52bc9f3efe6985e)
-- TASK-08-03 / H17: new PUBLIC group join name + affirmative disclosure consent.
-- Preserve existing four-arg join API for old pending requests; the new named
-- entrypoint is opt-in until Codex updates the UI. No user/profile backfill.
-- NOTE: do not apply to production without P0 ACL/RLS cutover.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('public.submit_profile_join_request(uuid,uuid,text,text)') IS NULL
 OR to_regprocedure('public.review_profile_join_request(uuid,text)') IS NULL
 OR to_regprocedure('public.save_club_member_display_name(uuid,uuid,text,text,boolean)') IS NULL
 OR to_regclass('public.join_requests') IS NULL
 OR to_regclass('public.club_members') IS NULL
 THEN RAISE EXCEPTION 'H17 prerequisites missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='club_members' AND column_name='club_display_name')
 OR NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='club_members' AND column_name='club_display_name_public_confirmed_at')
 OR has_any_column_privilege('anon','public.join_requests','SELECT')
 OR has_table_privilege('authenticated','public.join_requests','UPDATE')
 OR has_table_privilege('authenticated','public.join_requests','INSERT')
 THEN RAISE EXCEPTION 'H17 old member/RLS/ACL boundary mismatch'; END IF;
 IF to_regprocedure('public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='join_requests'
   AND column_name IN('club_display_name_requested','club_display_name_confirmed_at'))
 THEN RAISE EXCEPTION 'H17 already exists: review before re-applying'; END IF;
END $preflight$;

ALTER TABLE public.join_requests
 ADD COLUMN club_display_name_requested text,
 ADD COLUMN club_display_name_confirmed_at timestamptz;

ALTER TABLE public.join_requests ADD CONSTRAINT task08_h17_join_name_valid CHECK (
 club_display_name_requested IS NULL OR
 (club_display_name_requested=btrim(club_display_name_requested)
  AND char_length(club_display_name_requested) BETWEEN 1 AND 120
  AND club_display_name_requested !~ '[[:cntrl:]]')
);
ALTER TABLE public.join_requests ADD CONSTRAINT task08_h17_join_public_consent_pair CHECK (
 (club_display_name_requested IS NULL AND club_display_name_confirmed_at IS NULL)
 OR (club_display_name_requested IS NOT NULL AND club_display_name_confirmed_at IS NOT NULL)
);
COMMENT ON COLUMN public.join_requests.club_display_name_requested IS
 'Group-scoped name chosen by the request owner after explicit public directory disclosure.';
COMMENT ON COLUMN public.join_requests.club_display_name_confirmed_at IS
 'Owner-confirmed public visibility consent at submission; no inferred consent for old requests.';

-- Unique new function name: do not overload the four-arg function with defaults,
-- since that makes existing PostgREST RPC calls ambiguous.
CREATE FUNCTION public.submit_profile_join_request_named(
 p_club_id uuid,p_member_id uuid,p_message text,p_review_token text,
 p_club_display_name text,p_public_confirmation boolean
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $named_join$
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
 IF p_public_confirmation IS NOT TRUE THEN
  RAISE EXCEPTION '公開グループのメンバー一覧への表示を確認してください' USING ERRCODE='42501';
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
   club_display_name_confirmed_at=statement_timestamp()
 WHERE id=v_request AND club_id=p_club_id
   AND requester_auth_user_id=v_auth AND status='pending';
 IF NOT FOUND THEN
  RAISE EXCEPTION '申請情報が更新されました。再度やり直してください' USING ERRCODE='42501';
 END IF;
 RETURN v_request;
END $named_join$;
REVOKE ALL ON FUNCTION public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)
 TO authenticated;

-- Same DB transaction as existing approve. Runs only AFTER the approval
-- RPC successfully created or relinked the member. A failed identity/merge
-- verification aborts approval and rolls back; never publishes a name early.
CREATE FUNCTION profile_link_private.apply_named_join_after_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $approved_join$
DECLARE v_member uuid;v_count bigint;v_confirmed timestamptz;
BEGIN
 IF NOT (OLD.status='pending' AND NEW.status='approved'
   AND NEW.club_display_name_requested IS NOT NULL) THEN RETURN NEW; END IF;

 IF NEW.club_display_name_confirmed_at IS NULL
 OR NEW.club_display_name_confirmed_at > statement_timestamp()
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
   club_display_name_public_confirmed_at=NEW.club_display_name_confirmed_at
 WHERE id=v_member AND club_id=NEW.club_id;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>1 THEN
  RAISE EXCEPTION 'グループ内表示名を反映できません' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $approved_join$;

REVOKE ALL ON FUNCTION profile_link_private.apply_named_join_after_approval()
 FROM PUBLIC,anon,authenticated;

CREATE TRIGGER task08_h17_apply_join_name_after_approval
AFTER UPDATE OF status ON public.join_requests
FOR EACH ROW
WHEN (OLD.status='pending' AND NEW.status='approved' AND NEW.club_display_name_requested IS NOT NULL)
EXECUTE FUNCTION profile_link_private.apply_named_join_after_approval();

DO $postflight$
BEGIN
 IF has_function_privilege('anon','public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 OR has_column_privilege('authenticated','public.join_requests','club_display_name_confirmed_at','UPDATE')
 OR has_column_privilege('authenticated','public.join_requests','club_display_name_requested','INSERT')
 OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.join_requests'::regclass
    AND tgname='task08_h17_apply_join_name_after_approval' AND tgenabled IN('O','A'))<>1
 THEN RAISE EXCEPTION 'H17 join alias consent privileges drift'; END IF;
END $postflight$;
-- [03] END

-- [04] supabase/migrations/0059_public_claim_named_alias_gateway.sql (source sha 482d4e56c4ebc47c2f7fff15cdb95ea7f969f4a6)
-- TASK-08-03 / H17: public-reference-safe entrypoint after 0058.
-- The internal member UUID must never be required by a public join client.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('public.submit_public_club_claim(uuid,uuid,text,text)') IS NULL
 OR to_regprocedure('group_read_private.claim_member(uuid,uuid)') IS NULL
 OR to_regprocedure('public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)') IS NULL
 OR to_regprocedure('public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)') IS NOT NULL
 THEN RAISE EXCEPTION 'H17 public-reference API prerequisites missing'; END IF;
END $preflight$;

CREATE FUNCTION public.submit_public_club_claim_named(
 p_club_id uuid,p_reference uuid,p_message text,p_review_token text,
 p_club_display_name text,p_public_confirmation boolean
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $public_join$
DECLARE v_member uuid;
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501';
 END IF;
 PERFORM profile_link_private.serialize_operations();
 IF p_reference IS NOT NULL THEN
  v_member:=group_read_private.claim_member(p_club_id,p_reference);
 ELSE v_member:=NULL; END IF;

 -- This internal function runs as postgres and is never callable directly by
 -- browser authenticated role, so raw member IDs cannot be accepted outside
 -- the directory-ref resolution.
 RETURN public.submit_profile_join_request_named(
  p_club_id,v_member,p_message,p_review_token,
  p_club_display_name,p_public_confirmation);
END $public_join$;

REVOKE ALL ON FUNCTION public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)
 TO authenticated;

DO $postflight$
BEGIN
 IF has_function_privilege('authenticated','public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 OR has_function_privilege('anon','public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 OR has_function_privilege('anon','public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 OR NOT (SELECT prosecdef FROM pg_proc
  WHERE oid='public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)'::regprocedure)
 THEN RAISE EXCEPTION 'H17 claim API privileges wrong'; END IF;
END $postflight$;
-- [04] END

-- [05] supabase/migrations/0060_named_join_merge_snapshot.sql (source sha df969ec30e6777c304508d93e452bdbaa2c193a2)
-- TASK-08-03 / H17: preserve reversible profile-merge audit snapshot after
-- recipient-confirmed alias is atomically applied to the merged club member.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('profile_link_private.apply_named_join_after_approval()') IS NULL
 OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='task08_h17_apply_join_name_after_approval'
   AND tgrelid='public.join_requests'::regclass AND tgenabled IN ('O','A'))
 OR to_regclass('profile_link_private.merge_changes') IS NULL
 OR to_regclass('public.player_profile_merges') IS NULL
 THEN RAISE EXCEPTION 'H17 merge history patch prerequisites missing'; END IF;
END $preflight$;

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

 IF NEW.club_display_name_confirmed_at IS NULL
 OR NEW.club_display_name_confirmed_at > statement_timestamp()
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
   club_display_name_public_confirmed_at=NEW.club_display_name_confirmed_at
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
END $function$
;

DO $postflight$
BEGIN
 IF position('after_row=to_jsonb(cm)' IN
    (SELECT pg_get_functiondef(oid) FROM pg_proc
     WHERE oid='profile_link_private.apply_named_join_after_approval()'::regprocedure))=0
 THEN RAISE EXCEPTION 'H17 merge history snapshot patch missing'; END IF;
END $postflight$;
-- [05] END

-- [06] supabase/maintenance/group-foundation/139_h38_prod_link_scoped_preview_candidate.sql (source sha da9e8f3533edd75278cba3067e5c98442d11117a)
-- TASK-08 / H38 Prod compatibility candidate for scoped profile-link detail.
-- Add only the private scoped_preview helper and narrowly replace the existing link-detail RPC.
-- Source helper: Stage definition; source public function: original 16_link_detail_staging_apply.sql.
-- This changes public RPC DTO; coordinate with app cutover and the later 0061 migration.
-- NOT authorized for production apply or automatic migrations.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $h38_preflight$
DECLARE current_body text;
BEGIN
  IF current_user<>'postgres'
    OR to_regprocedure('profile_link_private.preview(uuid,uuid)') IS NULL
    OR to_regprocedure('profile_link_private.scoped_preview(uuid,uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.get_player_profile_link_request(uuid)') IS NULL
    OR (SELECT pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef
       FROM pg_proc WHERE oid=to_regprocedure('public.get_player_profile_link_request(uuid)'))
    OR has_function_privilege('anon','public.get_player_profile_link_request(uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.get_player_profile_link_request(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'H38: profile link baseline has drifted'; END IF;
  current_body:=pg_get_functiondef('public.get_player_profile_link_request(uuid)'::regprocedure);
  IF position('to_jsonb(request)' IN current_body)=0
    OR position('profile_link_private.preview(' IN current_body)=0
  THEN RAISE EXCEPTION 'H38: legacy detail RPC unexpectedly changed'; END IF;
END $h38_preflight$;

CREATE FUNCTION profile_link_private.scoped_preview(p_source uuid, p_user uuid, p_club uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select profile_link_private.preview(p_source,p_user) || jsonb_build_object(
    'source',jsonb_build_object('id',p_source,'display_name',(select display_name from public.player_profiles where id=p_source)),
    'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',cm.id,'club_name',c.name,'role',cm.role,'status',case when cm.is_active then 'active' else 'inactive' end,'is_active',cm.is_active,'created_at',cm.created_at))
      from public.club_members cm join public.clubs c on c.id=cm.club_id where cm.player_profile_id=p_source and cm.club_id=p_club),'[]'::jsonb),
    'participant_count',(select count(*) from public.event_participants ep join public.events e on e.id=ep.event_id where ep.player_profile_id=p_source and e.club_id=p_club),
    'match_count',(select count(distinct m.id) from public.match_players mp join public.matches m on m.id=mp.match_id join public.event_participants ep on ep.id=mp.participant_id join public.events e on e.id=m.event_id where ep.player_profile_id=p_source and e.club_id=p_club),
    'result_count',(select count(distinct r.id) from public.match_results r join public.match_players mp on mp.match_id=r.match_id join public.event_participants ep on ep.id=mp.participant_id join public.events e on e.id=ep.event_id where ep.player_profile_id=p_source and e.club_id=p_club),
    'team_match_count',(select count(*) from public.event_team_matches m where p_source in(m.team_a_player1_profile_id,m.team_a_player2_profile_id,m.team_b_player1_profile_id,m.team_b_player2_profile_id) and exists(select 1 from public.event_team_sides s where s.event_id=m.event_id and s.club_id=p_club)),
    'official_match_count',(select count(*) from public.official_matches m join public.official_events e on e.id=m.official_event_id where p_source in(m.our_player1_profile_id,m.our_player2_profile_id) and e.club_id=p_club));
$function$;

REVOKE ALL ON FUNCTION profile_link_private.scoped_preview(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated;

create or replace function public.get_player_profile_link_request(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
end $$;

DO $h38_postflight$
BEGIN
 IF to_regprocedure('profile_link_private.scoped_preview(uuid,uuid,uuid)') IS NULL
   OR has_function_privilege('anon','profile_link_private.scoped_preview(uuid,uuid,uuid)','EXECUTE')
   OR has_function_privilege('authenticated','profile_link_private.scoped_preview(uuid,uuid,uuid)','EXECUTE')
   OR has_function_privilege('anon','public.get_player_profile_link_request(uuid)','EXECUTE')
   OR NOT has_function_privilege('authenticated','public.get_player_profile_link_request(uuid)','EXECUTE')
   OR (SELECT pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef
       FROM pg_proc WHERE oid=to_regprocedure('public.get_player_profile_link_request(uuid)'))
   OR position('profile_link_private.scoped_preview(' IN
       pg_get_functiondef('public.get_player_profile_link_request(uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'H38: scoped link detail cutover did not retain privileges or DTO'; END IF;
END $h38_postflight$;
-- [06] END

-- [07] supabase/migrations/0061_receiver_named_profile_link.sql (source sha 9b6d1758bce7bdc32ef82a2b2e18d0deeb116d66)
-- TASK-08-03 / H18: receiver-confirmed club-scoped alias on administrator-initiated profile linking.
-- Stage-first forward migration. Old approval/rejection/cancellation APIs remain unchanged.
-- DO NOT APPLY TO PROD before the coordinated P0 ACL and RPC cutover.

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
-- [07] END

-- [08] supabase/migrations/0062_owner_transfer_recipient_approval.sql (source sha 59c3195cf02b581ecb8e1550ffb3845eb0945a4e)
-- TASK-08 / owner handover (H19), explicitly confirmed by candidate.
-- Stage first. Do NOT apply to production without the coordinated release gate.
-- No implied expiry/auto-acceptance; only sender cancellation or candidate decision.

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
-- [08] END

-- [09] supabase/migrations/0063_owner_transfer_uuid_aggregate_fix.sql (source sha c01f908a5445a435772f7aa3153b8e33b9ba3d10)
-- H19 forward-only fix: PostgreSQL does not define min(uuid).
-- Keep 0062 immutable and use ordered array_agg for unique member IDs.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('public.request_club_owner_transfer(uuid,uuid)') IS NULL
 OR to_regprocedure('public.respond_club_owner_transfer(uuid,text)') IS NULL
 THEN RAISE EXCEPTION 'H19 uuid aggregate patch prerequisites missing'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.request_club_owner_transfer(p_club_id uuid, p_to_member_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 SELECT count(*),(array_agg(cm.id ORDER BY cm.id))[1] INTO v_count,v_source_member
 FROM public.club_members cm JOIN public.player_profiles pp
 ON pp.id=cm.player_profile_id AND pp.is_active
 WHERE cm.club_id=p_club_id AND cm.is_active AND cm.status='active'
  AND cm.role='main_admin' AND pp.linked_auth_user_id=v_actor;
 IF v_count<>1 THEN RAISE EXCEPTION '現オーナーの在籍・管理権限を確認してください'
  USING ERRCODE='42501'; END IF;
 SELECT count(*),(array_agg(pp.linked_auth_user_id ORDER BY pp.linked_auth_user_id))[1] INTO v_count,v_to_user
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
END $function$
;

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
 IF position('min(cm.id)' IN (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE oid='public.request_club_owner_transfer(uuid,uuid)'::regprocedure))<>0
 OR position('min(cm.id)' IN (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE oid='public.respond_club_owner_transfer(uuid,text)'::regprocedure))<>0
 OR position('min(pp.linked_auth_user_id)' IN (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE oid='public.request_club_owner_transfer(uuid,uuid)'::regprocedure))<>0
 OR has_function_privilege('anon','public.respond_club_owner_transfer(uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'H19 aggregate or grant postflight mismatch'; END IF;
END $postflight$;
-- [09] END

-- [10] supabase/migrations/0064_owner_transfer_decline_after_demotion.sql (source sha 6309910f16ccafd1ce2b4f2e8726619c7392eaba)
-- H19 forward-only: recipient can decline a pending request even after
-- their membership was demoted; only acceptance must revalidate main-admin.
-- Old owner must still be current, and all status changes remain atomic.

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
-- [10] END

-- [11] supabase/migrations/0065_public_club_member_count.sql (source sha e73647216981cf01aa42ec8fdc623c7a4b55c5d5)
-- TASK-08 H22: exact public-group active member count, separate from name disclosure.
-- Stage first. Do not apply to PROD or auto-publish profile or event data.

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
-- [11] END

DO $h40_prod_cutover_verify$
BEGIN
 IF has_any_column_privilege('anon','public.club_members','SELECT')
 OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='club_members' AND column_name='club_display_name')
 OR to_regprocedure('public.save_club_member_display_name(uuid,uuid,text,text,boolean)') IS NULL
 OR to_regprocedure('public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)') IS NULL
 OR to_regprocedure('public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)') IS NULL
 OR to_regprocedure('public.review_player_profile_link_named(uuid,text,text,text,boolean)') IS NULL
 OR to_regclass('public.club_owner_transfer_requests') IS NULL
 OR to_regprocedure('public.respond_club_owner_transfer(uuid,text)') IS NULL
 OR to_regprocedure('public.get_public_club_member_count(uuid)') IS NULL
 OR has_function_privilege('anon','public.get_public_club_member_count(uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.get_public_club_member_count(uuid)','EXECUTE')
 OR has_function_privilege('anon','profile_link_private.scoped_preview(uuid,uuid,uuid)','EXECUTE')
 OR to_regclass('public.event_fixed_pair_state') IS NULL
 OR to_regclass('public.profile_media_objects') IS NULL
 THEN RAISE EXCEPTION 'H40: atomic cutover postflight failed'; END IF;
END $h40_prod_cutover_verify$;

COMMIT;
