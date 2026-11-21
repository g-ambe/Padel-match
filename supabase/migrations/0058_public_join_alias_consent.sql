-- TASK-08-03 / H17: new PUBLIC group join name + affirmative disclosure consent.
-- Preserve existing four-arg join API for old pending requests; the new named
-- entrypoint is opt-in until Codex updates the UI. No user/profile backfill.
-- NOTE: do not apply to production without P0 ACL/RLS cutover.
BEGIN;
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
COMMIT;