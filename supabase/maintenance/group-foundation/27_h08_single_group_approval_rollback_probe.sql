-- TASK-08 / H08: STAGING-ONLY single-club positive approval (ROLLBACK only).
-- Run after injecting 26's function candidate in the same transaction; do not commit.
-- Creates a synthetic one-club unlinked player for this transaction only.
-- Leaves auth, player, group, notifications and merge tables unchanged after ROLLBACK.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $setup$
DECLARE v_club uuid;v_manager uuid;v_recipient uuid;v_source uuid;v_member uuid;v_target uuid;
BEGIN
 IF current_user <> 'postgres'
 OR (SELECT count(*) FROM public.player_profile_link_requests WHERE status='pending')<>0
 OR (SELECT count(*) FROM public.player_profile_merges WHERE restored_at IS NULL)<>0
 OR (SELECT count(*) FROM public.player_profiles WHERE display_name='TASK08-H08-SINGLE-ROLLBACK')<>0
 THEN RAISE EXCEPTION 'H08 positive preflight differs'; END IF;
 SELECT id INTO STRICT v_club FROM public.clubs WHERE name='TASK08-P0-20261119-A';
 SELECT id INTO STRICT v_manager FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT v_recipient FROM auth.users WHERE lower(email)='outsider@example.com';
 SELECT id INTO STRICT v_target FROM public.player_profiles
  WHERE linked_auth_user_id=v_recipient AND is_active;
 PERFORM set_config('request.jwt.claim.sub',v_manager::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 INSERT INTO public.player_profiles(display_name,is_active,created_by_auth_user_id)
 VALUES('TASK08-H08-SINGLE-ROLLBACK',true,v_manager) RETURNING id INTO v_source;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active)
 VALUES(v_club,NULL,v_source,'member',true) RETURNING id INTO v_member;
 PERFORM set_config('task08.club',v_club::text,true);
 PERFORM set_config('task08.manager',v_manager::text,true);
 PERFORM set_config('task08.recipient',v_recipient::text,true);
 PERFORM set_config('task08.target',v_target::text,true);
 PERFORM set_config('task08.source',v_source::text,true);
 PERFORM set_config('task08.member',v_member::text,true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $approve$
DECLARE rid uuid;preview jsonb;outcome jsonb;
BEGIN
 rid:=public.request_player_profile_link(current_setting('task08.club')::uuid,
   current_setting('task08.member')::uuid,current_setting('task08.recipient')::uuid);
 PERFORM set_config('task08.request',rid::text,true);
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.recipient'),true);
 preview:=public.get_player_profile_link_request(rid);
 IF coalesce(jsonb_array_length(preview->'memberships'),0)<>1
 OR preview->>'detail_scope'<>'recipient'
 OR NOT (preview ? 'review_token')
 THEN RAISE EXCEPTION 'H08 one-club recipient preview mismatch'; END IF;
 outcome:=public.review_player_profile_link(rid,'approved',preview->>'review_token');
 PERFORM set_config('task08.approved',(outcome->>'status'='approved')::text,true);
END $approve$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'approved',current_setting('task08.approved')::boolean,
 'new_club_membership_transferred',(SELECT count(*)=1 FROM public.club_members
   WHERE club_id=current_setting('task08.club')::uuid
     AND player_profile_id=current_setting('task08.target')::uuid
     AND is_active),
 'test_source_deactivated',(SELECT NOT is_active FROM public.player_profiles
   WHERE id=current_setting('task08.source')::uuid),
 'source_any_other_club',(SELECT count(*) FROM public.club_members
   WHERE player_profile_id=current_setting('task08.source')::uuid
     AND club_id IS DISTINCT FROM current_setting('task08.club')::uuid),
 'test_merge_records_in_transaction',(SELECT count(*) FROM public.player_profile_merges
   WHERE source_player_profile_id=current_setting('task08.source')::uuid
     AND restored_at IS NULL)
) AS report;
ROLLBACK;
