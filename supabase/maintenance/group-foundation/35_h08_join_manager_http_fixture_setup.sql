-- TASK-08 H08 STAGING ONLY: pending public claim for a real JWT manager-review refusal test.
-- Source belongs to both A/B, preview only shows A. A manager approval MUST be rejected.
-- Do NOT approve outside the script, do not commit a merge, do not apply to production.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $setup$
DECLARE c uuid; m uuid;ref uuid;uid uuid;source uuid;target uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0
 OR (SELECT count(*) FROM public.player_profile_link_requests WHERE status='pending')<>0
 OR (SELECT count(*) FROM public.player_profile_merges WHERE restored_at IS NULL)<>0
 THEN RAISE EXCEPTION 'H08 pending request fixture is not isolated'; END IF;
 SELECT p.id INTO STRICT source FROM public.player_profiles p
 WHERE p.display_name='TASK08-P0 provisional U' AND p.is_active AND p.linked_auth_user_id IS NULL;
 IF (SELECT count(*) FROM public.club_members WHERE player_profile_id=source)<>2
 THEN RAISE EXCEPTION 'H08 expected two synthetic source memberships'; END IF;
 SELECT clubs.id,cm.id,d.public_ref INTO STRICT c,m,ref
 FROM public.clubs clubs JOIN public.club_members cm ON cm.club_id=clubs.id
 JOIN group_read_private.directory_refs d ON d.member_id=cm.id
 WHERE clubs.name='TASK08-P0-20261119-A' AND cm.player_profile_id=source AND cm.is_active;
 SELECT id INTO STRICT uid FROM auth.users
 WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT target FROM public.player_profiles WHERE linked_auth_user_id=uid AND is_active;
 IF EXISTS(SELECT 1 FROM public.club_members WHERE player_profile_id=target)
 THEN RAISE EXCEPTION 'H08 recipient already has memberships; stop'; END IF;
 PERFORM set_config('task08.club',c::text,true);
 PERFORM set_config('task08.member',m::text,true);
 PERFORM set_config('task08.ref',ref::text,true);
 PERFORM set_config('task08.source',source::text,true);
 PERFORM set_config('task08.target',target::text,true);
 PERFORM set_config('task08.user',uid::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $create$
DECLARE p jsonb;rid uuid;
BEGIN
 p:=public.preview_public_club_claim(current_setting('task08.club')::uuid,
  current_setting('task08.ref')::uuid);
 IF coalesce((p->>'membership_count')::int,0)<>1 OR p->>'display_name'<>'TASK08-P0 provisional U'
 OR coalesce(length(p->>'review_token'),0)=0
 THEN RAISE EXCEPTION 'H08 fixture preview not scoped'; END IF;
 rid:=public.submit_public_club_claim(current_setting('task08.club')::uuid,
  current_setting('task08.ref')::uuid,'TASK08 isolated H08 negative HTTP review',
  p->>'review_token');
 IF rid IS NULL THEN RAISE EXCEPTION 'H08 request not created'; END IF;
 PERFORM set_config('task08.request',rid::text,true);
END $create$;
RESET ROLE;
DO $verify$
BEGIN
 IF (SELECT count(*) FROM public.join_requests jr
    WHERE jr.id=current_setting('task08.request')::uuid
      AND jr.club_id=current_setting('task08.club')::uuid
      AND jr.target_club_member_id=current_setting('task08.member')::uuid
      AND jr.requester_auth_user_id=current_setting('task08.user')::uuid
      AND jr.consent_source_player_profile_id=current_setting('task08.source')::uuid
      AND jr.status='pending' AND jr.consent_at IS NOT NULL
      AND jr.consent_snapshot IS NOT NULL)<>1
 OR (SELECT count(*) FROM public.notifications n
     WHERE n.related_join_request_id=current_setting('task08.request')::uuid)=0
 THEN RAISE EXCEPTION 'H08 pending join fixture/notification preflight failed'; END IF;
END $verify$;
SELECT jsonb_build_object('fixture_created',true,
 'pending_join_requests',(SELECT count(*) FROM public.join_requests WHERE status='pending'),
 'related_notifications',(SELECT count(*) FROM public.notifications
  WHERE related_join_request_id=current_setting('task08.request')::uuid)) AS report;
COMMIT;
