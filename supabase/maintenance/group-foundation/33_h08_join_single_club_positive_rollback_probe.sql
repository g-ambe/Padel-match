-- TASK-08 H08: STAGING-only single-club public claim and manager approval positive probe.
-- ROLLBACK: synthetic player, member, request, notification and merge never persist.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $fixture$
DECLARE vclub uuid; vmanager uuid; vuser uuid; vsource uuid; vmember uuid; vtarget uuid; vref uuid;
BEGIN
 IF current_user<>'postgres' OR
  (SELECT count(*) FROM public.player_profiles WHERE display_name='TASK08-H08-CLAIM-SINGLE-ROLLBACK')<>0 OR
  (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0 OR
  (SELECT count(*) FROM public.player_profile_merges WHERE restored_at IS NULL)<>0
 THEN RAISE EXCEPTION 'H08 stage positive fixture drift'; END IF;
 SELECT id INTO STRICT vclub FROM public.clubs WHERE name='TASK08-P0-20261119-A';
 SELECT id INTO STRICT vmanager FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT vuser FROM auth.users WHERE lower(email)='outsider@example.com';
 SELECT id INTO STRICT vtarget FROM public.player_profiles WHERE linked_auth_user_id=vuser AND is_active;
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claim.sub',vmanager::text,true);
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H08-CLAIM-SINGLE-ROLLBACK',vmanager,true) RETURNING id INTO vsource;
 INSERT INTO public.club_members(club_id,player_profile_id,profile_id,role,is_active)
 VALUES(vclub,vsource,NULL,'member',true) RETURNING id INTO vmember;
 SELECT d.public_ref INTO STRICT vref FROM group_read_private.directory_refs d WHERE d.member_id=vmember;
 PERFORM set_config('task08.club',vclub::text,true);
 PERFORM set_config('task08.manager',vmanager::text,true);
 PERFORM set_config('task08.user',vuser::text,true);
 PERFORM set_config('task08.target',vtarget::text,true);
 PERFORM set_config('task08.source',vsource::text,true);
 PERFORM set_config('task08.ref',vref::text,true);
END $fixture$;
SET LOCAL ROLE authenticated;
DO $approve$
DECLARE preview jsonb;rid uuid;approved jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.user'),true);
 preview:=public.preview_public_club_claim(current_setting('task08.club')::uuid,current_setting('task08.ref')::uuid);
 IF preview->>'display_name'<>'TASK08-H08-CLAIM-SINGLE-ROLLBACK'
 OR (preview->>'membership_count')::int<>1 OR NOT (preview ? 'review_token')
 THEN RAISE EXCEPTION 'H08 single-club public preview incorrect'; END IF;
 rid:=public.submit_public_club_claim(current_setting('task08.club')::uuid,
  current_setting('task08.ref')::uuid,'TASK08 one-club rollback-only',preview->>'review_token');
 PERFORM set_config('task08.request',rid::text,true);
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.manager'),true);
 approved:=public.review_profile_join_request(rid,'approved');
 PERFORM set_config('task08.approved',(approved->>'status'='approved')::text,true);
END $approve$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'single_club_approval_succeeded',current_setting('task08.approved')::boolean,
 'single_club_member_transferred',(SELECT count(*)=1 FROM public.club_members cm
 WHERE cm.club_id=current_setting('task08.club')::uuid AND cm.player_profile_id=current_setting('task08.target')::uuid),
 'source_deactivated',(SELECT NOT is_active FROM public.player_profiles p WHERE p.id=current_setting('task08.source')::uuid),
 'cross_club_changes',(SELECT count(*) FROM public.club_members cm
 WHERE cm.player_profile_id=current_setting('task08.target')::uuid AND cm.club_id IS DISTINCT FROM current_setting('task08.club')::uuid),
 'merges_inside_transaction',(SELECT count(*) FROM public.player_profile_merges WHERE source_player_profile_id=current_setting('task08.source')::uuid AND restored_at IS NULL)
) AS report;
ROLLBACK;
