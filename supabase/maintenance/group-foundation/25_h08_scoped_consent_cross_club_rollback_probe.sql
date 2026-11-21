-- TASK-08 / H08: STAGING-ONLY consent-scope security probe.
-- Critical: do not commit. The source synthetic player belongs to club A and B,
-- while the authenticating recipient (outsider fixture) has no memberships.
-- Purpose: see whether a token from a one-club scoped preview can approve a
-- cross-club merge. No token/UUID/row body is included in results.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '40s';
DO $fixture$
DECLARE v_source uuid;v_member uuid;v_club_a uuid;v_main uuid;v_outsider uuid;v_target uuid;
BEGIN
 IF current_user <> 'postgres'
 OR (SELECT count(*) FROM public.player_profile_link_requests WHERE status='pending')<>0
 OR (SELECT count(*) FROM public.player_profile_merges WHERE restored_at IS NULL)<>0
 OR (SELECT count(*) FROM public.clubs WHERE name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>2
 THEN RAISE EXCEPTION 'TASK08 H08 stage isolation preflight changed'; END IF;
 SELECT id INTO STRICT v_source FROM public.player_profiles
  WHERE display_name='TASK08-P0 provisional U' AND is_active AND linked_auth_user_id IS NULL;
 SELECT c.id,cm.id INTO STRICT v_club_a,v_member FROM public.clubs c
  JOIN public.club_members cm ON cm.club_id=c.id AND cm.player_profile_id=v_source
  WHERE c.name='TASK08-P0-20261119-A' AND cm.is_active;
 SELECT id INTO STRICT v_main FROM auth.users
  WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_outsider FROM auth.users
  WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_target FROM public.player_profiles
  WHERE linked_auth_user_id=v_outsider AND is_active;
 IF (SELECT count(*) FROM public.club_members WHERE player_profile_id=v_source)<>2
 OR (SELECT count(*) FROM public.club_members WHERE player_profile_id=v_target)<>0
 THEN RAISE EXCEPTION 'H08 expected synthetic A/B memberships absent'; END IF;
 PERFORM set_config('task08.src',v_source::text,true);
 PERFORM set_config('task08.target',v_target::text,true);
 PERFORM set_config('task08.club_a',v_club_a::text,true);
 PERFORM set_config('task08.member',v_member::text,true);
 PERFORM set_config('task08.main',v_main::text,true);
 PERFORM set_config('task08.outsider',v_outsider::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',v_main::text,true);
END $fixture$;
SET LOCAL ROLE authenticated;
DO $create$
DECLARE rid uuid;
BEGIN
 rid:=public.request_player_profile_link(
  current_setting('task08.club_a')::uuid,
  current_setting('task08.member')::uuid,
  current_setting('task08.outsider')::uuid);
 IF rid IS NULL THEN RAISE EXCEPTION 'H08 fixture request creation failed'; END IF;
 PERFORM set_config('task08.request',rid::text,true);
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.outsider'),true);
END $create$;
DO $recipient_preview$
DECLARE d jsonb;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('task08.request')::uuid);
 IF d->>'detail_scope' <> 'recipient' OR NOT (d ? 'review_token')
 THEN RAISE EXCEPTION 'H08 recipient preview not available'; END IF;
 PERFORM set_config('task08.token',d->>'review_token',true);
 PERFORM set_config('task08.preview_count',jsonb_array_length(d->'memberships')::text,true);
 PERFORM set_config('task08.preview_hidden_B',(
   position('TASK08-P0-20261119-B' in coalesce(d->'memberships','[]'::jsonb)::text)=0
 )::text,true);
END $recipient_preview$;
RESET ROLE;
DO $compare$
DECLARE g jsonb;
BEGIN
 g:=profile_link_private.preview(
   current_setting('task08.src')::uuid,current_setting('task08.outsider')::uuid);
 PERFORM set_config('task08.global_count',jsonb_array_length(g->'memberships')::text,true);
 PERFORM set_config('task08.same_global_token',(
   g->>'review_token'=current_setting('task08.token'))::text,true);
END $compare$;
SET LOCAL ROLE authenticated;
DO $approval$
DECLARE result jsonb;reject_code text;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.outsider'),true);
 BEGIN
  result:=public.review_player_profile_link(
   current_setting('task08.request')::uuid,'approved',current_setting('task08.token'));
  PERFORM set_config('task08.approved',(result->>'status'='approved')::text,true);
  PERFORM set_config('task08.error_code','',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS reject_code=RETURNED_SQLSTATE;
  PERFORM set_config('task08.approved','false',true);
  PERFORM set_config('task08.error_code',reject_code,true);
 END;
END $approval$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'scoped_preview_memberships',current_setting('task08.preview_count')::int,
 'preview_excludes_B',current_setting('task08.preview_hidden_B')::boolean,
 'global_source_memberships',current_setting('task08.global_count')::int,
 'scope_token_matches_global',current_setting('task08.same_global_token')::boolean,
 'approval_succeeded',current_setting('task08.approved')::boolean,
 'approval_error_code',nullif(current_setting('task08.error_code'),''),
 'B_membership_transferred_to_recipient',(SELECT count(*)=1 FROM public.club_members cm
   JOIN public.clubs c ON c.id=cm.club_id
   WHERE c.name='TASK08-P0-20261119-B'
    AND cm.player_profile_id=current_setting('task08.target')::uuid),
 'A_membership_transferred_to_recipient',(SELECT count(*)=1 FROM public.club_members cm
   JOIN public.clubs c ON c.id=cm.club_id
   WHERE c.name='TASK08-P0-20261119-A'
    AND cm.player_profile_id=current_setting('task08.target')::uuid),
 'source_now_inactive',(SELECT NOT p.is_active FROM public.player_profiles p
   WHERE p.id=current_setting('task08.src')::uuid),
 'merge_records_in_transaction',(SELECT count(*) FROM public.player_profile_merges
   WHERE source_player_profile_id=current_setting('task08.src')::uuid
     AND restored_at IS NULL)
) AS report;
ROLLBACK;
