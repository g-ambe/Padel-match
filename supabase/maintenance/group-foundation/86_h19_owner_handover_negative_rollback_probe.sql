-- H19 Stage-only rollback negatives: cancel, replays, demotion, anon and actor changes.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $seed$
DECLARE a uuid;b uuid;c uuid;ap uuid;bp uuid;cp uuid;club uuid;
BEGIN
 IF current_user<>'postgres' OR (SELECT count(*) FROM public.clubs)<>3
  OR (SELECT count(*) FROM public.club_members)<>12
  OR (SELECT count(*) FROM public.notifications)<>0
  OR (SELECT count(*) FROM public.club_owner_transfer_requests)<>0
 THEN RAISE EXCEPTION 'H19 stale probe baseline changed'; END IF;
 SELECT id INTO STRICT a FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT b FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT c FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT ap FROM public.player_profiles WHERE linked_auth_user_id=a AND is_active;
 SELECT id INTO STRICT bp FROM public.player_profiles WHERE linked_auth_user_id=b AND is_active;
 SELECT id INTO STRICT cp FROM public.player_profiles WHERE linked_auth_user_id=c AND is_active;
 INSERT INTO public.clubs(name,owner_id,visibility) VALUES('TASK08-H19-STALE-RB',a,'private') RETURNING id INTO club;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(club,a,ap,'main_admin',true,'active'),(club,b,bp,'main_admin',true,'active'),(club,c,cp,'member',true,'active');
 PERFORM set_config('h19s.club',club::text,true); PERFORM set_config('h19s.owner',a::text,true);
 PERFORM set_config('h19s.recipient',b::text,true); PERFORM set_config('h19s.other',c::text,true);
 PERFORM set_config('h19s.member',(SELECT id::text FROM public.club_members WHERE club_id=club AND profile_id=b),true);
END $seed$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
DO $anon$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN PERFORM public.request_club_owner_transfer(current_setting('h19s.club')::uuid,
 current_setting('h19s.member')::uuid);
 EXCEPTION WHEN OTHERS THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H19 anon could send owner transfer'; END IF;
 PERFORM set_config('h19s.anon_denied','true',true);
END $anon$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h19s.other'),true);
DO $not_owner$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN PERFORM public.request_club_owner_transfer(current_setting('h19s.club')::uuid,
 current_setting('h19s.member')::uuid);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H19 nonowner requested handover'; END IF;
 PERFORM set_config('h19s.notowner_denied','true',true);
END $not_owner$;
SELECT set_config('request.jwt.claim.sub',current_setting('h19s.owner'),true);
DO $req$
BEGIN
 PERFORM set_config('h19s.req',public.request_club_owner_transfer(current_setting('h19s.club')::uuid,
 current_setting('h19s.member')::uuid)::text,true);
END $req$;
SELECT set_config('request.jwt.claim.sub',current_setting('h19s.other'),true);
DO $cancel_denied$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN PERFORM public.cancel_club_owner_transfer(current_setting('h19s.req')::uuid);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H19 non-owner could cancel transfer'; END IF;
 PERFORM set_config('h19s.cancel_other_denied','true',true);
END $cancel_denied$;
RESET ROLE;
UPDATE public.club_members SET role='sub_admin' WHERE id=current_setting('h19s.member')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h19s.recipient'),true);
DO $demoted$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN PERFORM public.respond_club_owner_transfer(current_setting('h19s.req')::uuid,'accepted');
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H19 demoted candidate accepted transfer'; END IF;
 PERFORM set_config('h19s.demoted_denied','true',true);
END $demoted$;
SELECT set_config('request.jwt.claim.sub',current_setting('h19s.owner'),true);
DO $owner_cancel$
DECLARE blocked boolean:=false;
BEGIN
 IF public.cancel_club_owner_transfer(current_setting('h19s.req')::uuid)<>'cancelled'
 THEN RAISE EXCEPTION 'H19 owner failed to cancel'; END IF;
 BEGIN PERFORM public.cancel_club_owner_transfer(current_setting('h19s.req')::uuid);
 EXCEPTION WHEN SQLSTATE 'PT409' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H19 cancel replay was accepted'; END IF;
 PERFORM set_config('h19s.owner_cancelled','true',true);
END $owner_cancel$;
SELECT set_config('request.jwt.claim.sub',current_setting('h19s.recipient'),true);
DO $cancelled_cannot_accept$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN PERFORM public.respond_club_owner_transfer(current_setting('h19s.req')::uuid,'accepted');
 EXCEPTION WHEN SQLSTATE 'PT409' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H19 cancelled request accepted'; END IF;
 PERFORM set_config('h19s.cancelled_replay_denied','true',true);
END $cancelled_cannot_accept$;
SELECT set_config('request.jwt.claim.sub',current_setting('h19s.owner'),true);
DO $demoted_not_candidate$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN PERFORM public.request_club_owner_transfer(current_setting('h19s.club')::uuid,
 current_setting('h19s.member')::uuid);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H19 demoted candidate proposed'; END IF;
 PERFORM set_config('h19s.demoted_not_candidate','true',true);
END $demoted_not_candidate$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'anonymous_denied',current_setting('h19s.anon_denied',true)='true',
 'other_cannot_request',current_setting('h19s.notowner_denied',true)='true',
 'other_cannot_cancel',current_setting('h19s.cancel_other_denied',true)='true',
 'demoted_candidate_cannot_accept',current_setting('h19s.demoted_denied',true)='true',
 'owner_can_cancel',current_setting('h19s.owner_cancelled',true)='true',
 'cancelled_request_cannot_accept',current_setting('h19s.cancelled_replay_denied',true)='true',
 'demoted_candidate_not_proposable',current_setting('h19s.demoted_not_candidate',true)='true',
 'owner_not_changed',(SELECT owner_id=current_setting('h19s.owner')::uuid FROM public.clubs WHERE id=current_setting('h19s.club')::uuid),
 'cancelled_state',(SELECT count(*)=1 FROM public.club_owner_transfer_requests WHERE id=current_setting('h19s.req')::uuid AND status='cancelled' AND responded_at IS NOT NULL),
 'notifications_consistent',(SELECT count(*)=2 FROM public.notifications WHERE related_owner_transfer_request_id=current_setting('h19s.req')::uuid)
) report;
ROLLBACK;