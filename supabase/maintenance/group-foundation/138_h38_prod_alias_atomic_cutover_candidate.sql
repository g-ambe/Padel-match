-- TASK-08 / H38: Prod-compatible ATOMIC alias cutover candidate. NOT approved for Prod.
-- Keep original 0056 DDL, guards, RPCs and consent behavior unchanged.
-- REVOKE anon club_members SELECT in the SAME transaction before 0056 columns are added.
-- New app must be deployed immediately after all required DB migrations have succeeded;
-- old anonymous group screens may temporarily stop working during the cutover window.
-- Never commit this in isolation or apply with stale app consumers.
BEGIN;
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
COMMIT;
