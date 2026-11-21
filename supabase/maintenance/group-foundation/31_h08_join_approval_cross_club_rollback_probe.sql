-- TASK-08 H08: STAGING ONLY / rollback-only alternate join-review merge path.
-- Does a one-club public claim preview allow an administrator to merge another club?
-- Creates only a synthetic pending consent request inside this transaction.
-- No production use, no COMMIT, no tokens/UUIDs/personal values in output.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $setup$
DECLARE v_club uuid;v_member uuid;v_ref uuid;v_main uuid;v_outsider uuid;v_source uuid;v_target uuid;
BEGIN
 IF current_user<>'postgres'
  OR (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0
  OR (SELECT count(*) FROM public.player_profile_merges WHERE restored_at IS NULL)<>0
 THEN RAISE EXCEPTION 'H08 join alternate fixture drift'; END IF;
 SELECT p.id INTO STRICT v_source FROM public.player_profiles p
 WHERE p.display_name='TASK08-P0 provisional U' AND p.linked_auth_user_id IS NULL AND p.is_active;
 SELECT c.id,cm.id,d.public_ref INTO STRICT v_club,v_member,v_ref
 FROM public.clubs c JOIN public.club_members cm ON cm.club_id=c.id
 JOIN group_read_private.directory_refs d ON d.member_id=cm.id
 WHERE c.name='TASK08-P0-20261119-A' AND cm.player_profile_id=v_source AND cm.is_active;
 SELECT id INTO STRICT v_main FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT v_outsider FROM auth.users WHERE lower(email)='outsider@example.com';
 SELECT id INTO STRICT v_target FROM public.player_profiles WHERE linked_auth_user_id=v_outsider AND is_active;
 IF (SELECT count(*) FROM public.club_members WHERE player_profile_id=v_source)<>2
 OR (SELECT count(*) FROM public.club_members WHERE player_profile_id=v_target)<>0
 THEN RAISE EXCEPTION 'H08 expected A/B synthetic source membership drift'; END IF;
 PERFORM set_config('task08.club',v_club::text,true);
 PERFORM set_config('task08.member',v_member::text,true);
 PERFORM set_config('task08.ref',v_ref::text,true);
 PERFORM set_config('task08.source',v_source::text,true);
 PERFORM set_config('task08.target',v_target::text,true);
 PERFORM set_config('task08.main',v_main::text,true);
 PERFORM set_config('task08.outsider',v_outsider::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $consent$
DECLARE preview jsonb;rid uuid;
BEGIN
 preview:=public.preview_public_club_claim(
  current_setting('task08.club')::uuid,current_setting('task08.ref')::uuid);
 IF preview->>'display_name'<>'TASK08-P0 provisional U'
 OR (preview->>'membership_count')::int<>1
 OR NOT (preview ? 'review_token')
 THEN RAISE EXCEPTION 'H08 public claim preview not scoped'; END IF;
 rid:=public.submit_public_club_claim(current_setting('task08.club')::uuid,
  current_setting('task08.ref')::uuid,
  'TASK08 isolated rollback-only consent preview',preview->>'review_token');
 PERFORM set_config('task08.request',rid::text,true);
 PERFORM set_config('task08.scope_one','true',true);
END $consent$;
RESET ROLE;
DO $snapshot$
BEGIN
 IF (SELECT count(*) FROM public.join_requests jr WHERE jr.id=current_setting('task08.request')::uuid
 AND jr.status='pending' AND jr.consent_at IS NOT NULL
 AND jr.consent_snapshot IS NOT NULL
 AND jr.consent_source_player_profile_id=current_setting('task08.source')::uuid)<>1
 THEN RAISE EXCEPTION 'H08 consent was not recorded'; END IF;
END $snapshot$;
SET LOCAL ROLE authenticated;
DO $approve$
DECLARE result jsonb;err text;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.main'),true);
 BEGIN
  result:=public.review_profile_join_request(current_setting('task08.request')::uuid,'approved');
  PERFORM set_config('task08.approved',(result->>'status'='approved')::text,true);
  PERFORM set_config('task08.err','',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS err=RETURNED_SQLSTATE;
  PERFORM set_config('task08.approved','false',true);
  PERFORM set_config('task08.err',err,true);
 END;
END $approve$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'public_preview_one_club',current_setting('task08.scope_one')::boolean,
 'manager_join_approval_succeeded',current_setting('task08.approved')::boolean,
 'join_approval_error_code',nullif(current_setting('task08.err'),''),
 'A_member_rewritten',(SELECT count(*)=1 FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id
 WHERE c.name='TASK08-P0-20261119-A' AND cm.player_profile_id=current_setting('task08.target')::uuid),
 'B_member_rewritten',(SELECT count(*)=1 FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id
 WHERE c.name='TASK08-P0-20261119-B' AND cm.player_profile_id=current_setting('task08.target')::uuid),
 'source_deactivated',(SELECT NOT is_active FROM public.player_profiles WHERE id=current_setting('task08.source')::uuid),
 'merge_rows_inside_transaction',(SELECT count(*) FROM public.player_profile_merges WHERE source_player_profile_id=current_setting('task08.source')::uuid AND restored_at IS NULL)
) AS report;
ROLLBACK;
