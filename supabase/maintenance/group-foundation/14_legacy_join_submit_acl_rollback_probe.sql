-- TASK-08 P0: staging-only legacy join submit EXECUTE narrowing, ROLLBACK probe.
-- Compare legacy direct call with authenticated public-ref wrapper and consent.
-- No auth/password/JWT or application data are returned. Do not use in production.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF current_user<>'postgres'
 OR NOT EXISTS (SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.submit_profile_join_request(uuid,uuid,text,text)')
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
      AND md5(pg_get_functiondef(p.oid))='17ef49cbc3079fa06a4ccddc756ca1df'
      AND has_function_privilege('authenticated',p.oid,'EXECUTE'))
 OR NOT EXISTS (SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.submit_public_club_claim(uuid,uuid,text,text)')
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
      AND md5(pg_get_functiondef(p.oid))='41a7616c55203d4bd6c9f3020ecc744e'
      AND has_function_privilege('authenticated',p.oid,'EXECUTE'))
 OR (SELECT COUNT(*) FROM public.join_requests WHERE status='pending')<>0
 THEN RAISE EXCEPTION 'TASK08 H08 legacy submit isolation preflight changed'; END IF;
END $guard$;
DO $fixture$
DECLARE c uuid;m uuid;pub uuid; uid uuid;
BEGIN
 SELECT clubs.id,cm.id,r.public_ref INTO STRICT c,m,pub
 FROM public.clubs clubs JOIN public.club_members cm ON cm.club_id=clubs.id
 JOIN public.player_profiles p ON p.id=cm.player_profile_id
 JOIN group_read_private.directory_refs r ON r.member_id=cm.id
 WHERE clubs.name='TASK08-P0-20261119-A' AND p.display_name='TASK08-P0 provisional U';
 SELECT id INTO STRICT uid FROM auth.users
 WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 PERFORM set_config('task08.club',c::text,true);
 PERFORM set_config('task08.member',m::text,true);
 PERFORM set_config('task08.public_ref',pub::text,true);
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $fixture$;
SET LOCAL ROLE authenticated;
DO $baseline$
DECLARE preview jsonb;
BEGIN
 preview:=public.preview_public_club_claim(
    current_setting('task08.club')::uuid,current_setting('task08.public_ref')::uuid);
 IF coalesce(length(preview->>'review_token'),0)=0 THEN RAISE EXCEPTION 'preview token absent'; END IF;
 PERFORM set_config('task08.token',preview->>'review_token',true);
 PERFORM set_config('task08.before_authenticated_exec',
   has_function_privilege('authenticated','public.submit_profile_join_request(uuid,uuid,text,text)','EXECUTE')::text,true);
END $baseline$;
RESET ROLE;
REVOKE EXECUTE ON FUNCTION public.submit_profile_join_request(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE is_denied boolean:=false; wrong_token_rejected boolean:=false; request_id uuid;
BEGIN
 BEGIN
  PERFORM public.submit_profile_join_request(
   current_setting('task08.club')::uuid,current_setting('task08.member')::uuid,
   'TASK08 test only',current_setting('task08.token'));
 EXCEPTION WHEN insufficient_privilege THEN is_denied:=true;
 END;
 PERFORM set_config('task08.legacy_denied',is_denied::text,true);
 BEGIN
  PERFORM public.submit_public_club_claim(
   current_setting('task08.club')::uuid,current_setting('task08.public_ref')::uuid,
   'TASK08 test only','INVALID-TOKEN-CASE');
 EXCEPTION WHEN OTHERS THEN
  wrong_token_rejected:=position('再確認' IN SQLERRM)>0;
 END;
 PERFORM set_config('task08.wrong_token_rejected',wrong_token_rejected::text,true);
 request_id:=public.submit_public_club_claim(
  current_setting('task08.club')::uuid,current_setting('task08.public_ref')::uuid,
  'TASK08 test only',current_setting('task08.token'));
 PERFORM set_config('task08.request_id',request_id::text,true);
END $test$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'authenticated_legacy_exec_before',current_setting('task08.before_authenticated_exec')::boolean,
 'direct_legacy_denied',current_setting('task08.legacy_denied')::boolean,
 'wrong_token_rejected',current_setting('task08.wrong_token_rejected')::boolean,
 'wrapper_valid_consent_created',(SELECT count(*)=1 FROM public.join_requests r
   WHERE r.id=current_setting('task08.request_id')::uuid AND r.status='pending'
     AND r.consent_at IS NOT NULL AND r.consent_snapshot IS NOT NULL
     AND r.consent_source_player_profile_id IS NOT NULL AND r.target_club_member_id IS NOT NULL),
 'pending_rows_in_transaction',(SELECT count(*) FROM public.join_requests r
   WHERE r.id=current_setting('task08.request_id')::uuid),
 'legacy_authenticated_exec_during_trial',
   has_function_privilege('authenticated','public.submit_profile_join_request(uuid,uuid,text,text)','EXECUTE'),
 'wrapper_authenticated_exec_during_trial',
   has_function_privilege('authenticated','public.submit_public_club_claim(uuid,uuid,text,text)','EXECUTE')
) AS report;
ROLLBACK;
