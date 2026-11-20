-- H19 Stage rollback probe: owner consent transfer and exit without mutating real data.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $seed$
DECLARE a uuid;b uuid;c uuid;ap uuid;bp uuid;cp uuid;club uuid;
BEGIN
 IF current_user<>'postgres' OR (SELECT count(*) FROM public.clubs)<>3
  OR (SELECT count(*) FROM public.club_members)<>12
  OR (SELECT count(*) FROM public.club_owner_transfer_requests)<>0
  OR (SELECT count(*) FROM public.notifications)<>0 THEN
 RAISE EXCEPTION 'H19 probe unsafe baseline'; END IF;
 SELECT id INTO STRICT a FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT b FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT c FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT ap FROM public.player_profiles WHERE linked_auth_user_id=a AND is_active;
 SELECT id INTO STRICT bp FROM public.player_profiles WHERE linked_auth_user_id=b AND is_active;
 SELECT id INTO STRICT cp FROM public.player_profiles WHERE linked_auth_user_id=c AND is_active;
 INSERT INTO public.clubs(name,owner_id,visibility) VALUES('TASK08-H19-CONSENT-RB',a,'private') RETURNING id INTO club;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(club,a,ap,'main_admin',true,'active'),(club,b,bp,'main_admin',true,'active'),(club,c,cp,'member',true,'active');
 PERFORM set_config('h19.club',club::text,true);PERFORM set_config('h19.owner',a::text,true);
 PERFORM set_config('h19.candidate',b::text,true);PERFORM set_config('h19.outsider',c::text,true);
 PERFORM set_config('h19.target',(SELECT id::text FROM public.club_members WHERE club_id=club AND profile_id=b),true);
 PERFORM set_config('h19.invalid',(SELECT id::text FROM public.club_members WHERE club_id=club AND profile_id=c),true);
END $seed$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h19.outsider'),true);
DO $outsider$
DECLARE denied boolean:=false;n integer;
BEGIN
 BEGIN PERFORM public.get_club_owner_transfer_candidates(current_setting('h19.club')::uuid);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 SELECT count(*) INTO n FROM public.list_my_club_owner_transfers();
 IF NOT denied OR n<>0 THEN RAISE EXCEPTION 'outsider transfer access'; END IF;
 PERFORM set_config('h19.outsider_denied','true',true);
END $outsider$;
SELECT set_config('request.jwt.claim.sub',current_setting('h19.owner'),true);
DO $owner$
DECLARE n int;mid uuid;denied boolean:=false;
BEGIN
 SELECT count(*),(array_agg(member_id))[1] INTO n,mid
 FROM public.get_club_owner_transfer_candidates(current_setting('h19.club')::uuid);
 IF n<>1 OR mid<>current_setting('h19.target')::uuid THEN RAISE EXCEPTION 'candidate mismatch'; END IF;
 BEGIN PERFORM public.request_club_owner_transfer(current_setting('h19.club')::uuid,current_setting('h19.invalid')::uuid);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'non main candidate accepted'; END IF;
 PERFORM set_config('h19.req',public.request_club_owner_transfer(current_setting('h19.club')::uuid,
 current_setting('h19.target')::uuid)::text,true);
 PERFORM set_config('h19.candidate_guard','true',true);
END $owner$;
DO $duplicate$
DECLARE denied boolean:=false;
BEGIN
 BEGIN PERFORM public.request_club_owner_transfer(current_setting('h19.club')::uuid,
 current_setting('h19.target')::uuid); EXCEPTION WHEN SQLSTATE 'PT409' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'duplicate request succeeded'; END IF;
 PERFORM set_config('h19.duplicate_denied','true',true);
END $duplicate$;
RESET ROLE;
DO $guard$
DECLARE denied boolean:=false;
BEGIN
 BEGIN UPDATE public.club_members SET role='sub_admin' WHERE club_id=current_setting('h19.club')::uuid
 AND profile_id=current_setting('h19.owner')::uuid;
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'owner demoted before consent'; END IF;
 PERFORM set_config('h19.owner_guard','true',true);
END $guard$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h19.outsider'),true);
DO $other$
DECLARE denied boolean:=false;
BEGIN
 BEGIN PERFORM public.respond_club_owner_transfer(current_setting('h19.req')::uuid,'accepted');
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'third party acceptance'; END IF;
 PERFORM set_config('h19.other_denied','true',true);
END $other$;
SELECT set_config('request.jwt.claim.sub',current_setting('h19.candidate'),true);
DO $decline$
BEGIN
 IF public.respond_club_owner_transfer(current_setting('h19.req')::uuid,'declined')<>'declined'
 THEN RAISE EXCEPTION 'recipient decline failed'; END IF;
 PERFORM set_config('h19.declined','true',true);
END $decline$;
SELECT set_config('request.jwt.claim.sub',current_setting('h19.owner'),true);
DO $second$
BEGIN
 PERFORM set_config('h19.accept_req',public.request_club_owner_transfer(current_setting('h19.club')::uuid,
 current_setting('h19.target')::uuid)::text,true);
END $second$;
SELECT set_config('request.jwt.claim.sub',current_setting('h19.candidate'),true);
DO $accept$
DECLARE denied boolean:=false;
BEGIN
 IF public.respond_club_owner_transfer(current_setting('h19.accept_req')::uuid,'accepted')<>'accepted'
 THEN RAISE EXCEPTION 'recipient acceptance failed'; END IF;
 BEGIN PERFORM public.respond_club_owner_transfer(current_setting('h19.accept_req')::uuid,'accepted');
 EXCEPTION WHEN SQLSTATE 'PT409' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'acceptance replay allowed'; END IF;
 PERFORM set_config('h19.accepted','true',true);
END $accept$;
RESET ROLE;
DO $new_owner_guard$
DECLARE denied boolean:=false;
BEGIN
 BEGIN UPDATE public.club_members SET is_active=false WHERE id=current_setting('h19.target')::uuid;
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'new owner allowed to exit'; END IF;
 PERFORM set_config('h19.new_guard','true',true);
END $new_owner_guard$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h19.owner'),true);
DO $exit$
DECLARE mid uuid;
BEGIN
 SELECT id INTO mid FROM public.get_my_club_memberships()
 WHERE club_id=current_setting('h19.club')::uuid;
 IF mid IS NULL OR public.leave_my_club(current_setting('h19.club')::uuid,mid)<>mid
 OR public.can_manage_player_profile_club(current_setting('h19.club')::uuid)
 THEN RAISE EXCEPTION 'former owner failed to exit cleanly'; END IF;
 PERFORM set_config('h19.old_exited','true',true);
END $exit$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'candidate_owner_only',current_setting('h19.candidate_guard',true)='true',
 'outsider_denied',current_setting('h19.outsider_denied',true)='true',
 'duplicate_rejected',current_setting('h19.duplicate_denied',true)='true',
 'owner_role_guarded',current_setting('h19.owner_guard',true)='true',
 'third_party_cannot_accept',current_setting('h19.other_denied',true)='true',
 'decline_saved',(SELECT count(*)=1 FROM public.club_owner_transfer_requests WHERE id=current_setting('h19.req')::uuid AND status='declined'),
 'explicit_acceptance',current_setting('h19.accepted',true)='true',
 'accepted_saved',(SELECT count(*)=1 FROM public.club_owner_transfer_requests WHERE id=current_setting('h19.accept_req')::uuid AND status='accepted'),
 'recipient_is_owner',(SELECT owner_id=current_setting('h19.candidate')::uuid FROM public.clubs WHERE id=current_setting('h19.club')::uuid),
 'new_owner_guarded',current_setting('h19.new_guard',true)='true',
 'former_owner_can_leave',current_setting('h19.old_exited',true)='true',
 'old_owner_still_member_but_inactive',(SELECT count(*)=1 FROM public.club_members WHERE club_id=current_setting('h19.club')::uuid AND profile_id=current_setting('h19.owner')::uuid AND NOT is_active),
 'notification_count',(SELECT count(*)=4 FROM public.notifications WHERE related_club_id=current_setting('h19.club')::uuid AND related_owner_transfer_request_id IS NOT NULL),
 'raw_table_denied',NOT has_table_privilege('authenticated','public.club_owner_transfer_requests','SELECT')
) AS report;
ROLLBACK;