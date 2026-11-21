-- TASK-08 H08: STAGING ONLY / pending cross-club consent-review HTTP fixture.
-- Sender main-A, source unlinked U belonging to club A+B, recipient outsider
-- who has no club memberships. The review must be rejected by scoped consent guard.
-- If unexpected review occurs, cleanup intentionally aborts (request no longer pending).
-- TASK-08: temporary STAGING-only linked-profile request for real Auth HTTP checks.
-- Creates ONLY a pending link request + its normal notification using fixture users.
-- Never print UUIDs, token, password, email, preview JSON. Revert with file 18.
-- DO NOT APPLY TO PRODUCTION. Do not approve, merge, or review this request.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $setup$
DECLARE c uuid; m uuid; a uuid; r uuid;
BEGIN
 IF current_user<>'postgres'
   OR (SELECT COUNT(*) FROM public.player_profile_link_requests)<>0
   OR (SELECT COUNT(*) FROM public.club_members cm JOIN public.player_profiles pp
     ON pp.id=cm.player_profile_id WHERE pp.display_name='TASK08-P0 provisional U')<>2
 OR (SELECT COUNT(*) FROM public.join_requests WHERE status='pending')<>0
   OR (SELECT COUNT(*) FROM public.clubs WHERE name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>2
 THEN RAISE EXCEPTION 'TASK08 link fixture preflight changed; refuse'; END IF;
 SELECT clubs.id,cm.id INTO STRICT c,m
 FROM public.clubs clubs JOIN public.club_members cm ON cm.club_id=clubs.id
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE clubs.name='TASK08-P0-20261119-A'
   AND cm.is_active AND pp.is_active AND pp.linked_auth_user_id IS NULL
   AND pp.display_name='TASK08-P0 provisional U';
 SELECT id INTO STRICT a FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT r FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 PERFORM set_config('task08.club',c::text,true);
 PERFORM set_config('task08.member',m::text,true);
 PERFORM set_config('task08.manager',a::text,true);
 PERFORM set_config('task08.recipient',r::text,true);
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $request$
DECLARE v uuid;
BEGIN
 v:=public.request_player_profile_link(
 current_setting('task08.club')::uuid,
 current_setting('task08.member')::uuid,
 current_setting('task08.recipient')::uuid);
 IF v IS NULL THEN RAISE EXCEPTION 'link request not created'; END IF;
 PERFORM set_config('task08.fixture_request',v::text,true);
END $request$;
RESET ROLE;
DO $validate$
DECLARE rid uuid:=current_setting('task08.fixture_request')::uuid;
BEGIN
 IF (SELECT count(*) FROM public.player_profile_link_requests
     WHERE id=rid AND club_id=current_setting('task08.club')::uuid
       AND source_club_member_id=current_setting('task08.member')::uuid
       AND requested_by_auth_user_id=current_setting('task08.manager')::uuid
       AND target_auth_user_id=current_setting('task08.recipient')::uuid
       AND status='pending')<>1
 OR (SELECT count(*) FROM public.notifications
     WHERE related_profile_link_request_id=rid
       AND target_auth_user_id=current_setting('task08.recipient')::uuid)<>1
 THEN RAISE EXCEPTION 'link fixture request/notification mismatch; rollback'; END IF;
END $validate$;
SELECT jsonb_build_object(
  'fixture_request_created',true,
  'pending_requests',(SELECT count(*) FROM public.player_profile_link_requests WHERE status='pending'),
  'linked_notifications',(SELECT count(*) FROM public.notifications WHERE related_profile_link_request_id=current_setting('task08.fixture_request')::uuid)
) AS report;
COMMIT;
