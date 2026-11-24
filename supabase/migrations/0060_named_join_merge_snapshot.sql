-- TASK-08-03 / H17: preserve reversible profile-merge audit snapshot after
-- recipient-confirmed alias is atomically applied to the merged club member.
BEGIN;
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
COMMIT;