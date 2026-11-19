-- H17: STAGE ONLY, synthetic public join and provisional claim both ROLLBACK.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='70s';
DO $seed$
DECLARE v_owner uuid;v_recipient uuid;v_outsider uuid;v_owner_pp uuid;
 v_recipient_pp uuid;v_outsider_pp uuid;v_club uuid;v_source uuid;v_mid uuid;v_ref uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs)<>3
 OR (SELECT count(*) FROM public.club_members)<>12
 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0
 OR EXISTS(SELECT 1 FROM public.clubs WHERE name='TASK08-H17-ROLLBACK-NAMED-JOIN')
 THEN RAISE EXCEPTION 'H17 Stage baseline changed'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_recipient FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_outsider FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_owner_pp FROM public.player_profiles WHERE linked_auth_user_id=v_owner AND is_active;
 SELECT id INTO STRICT v_recipient_pp FROM public.player_profiles WHERE linked_auth_user_id=v_recipient AND is_active;
 SELECT id INTO STRICT v_outsider_pp FROM public.player_profiles WHERE linked_auth_user_id=v_outsider AND is_active;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility,description)
 VALUES('TASK08-H17-ROLLBACK-NAMED-JOIN',v_owner,true,'public','Stage-only named join')
 RETURNING id INTO v_club;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_club,v_owner,v_owner_pp,'main_admin',true,'active');
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H17-UNLINKED-SOURCE',v_owner,true) RETURNING id INTO v_source;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status,club_display_name)
 VALUES(v_club,NULL,v_source,'member',true,'active','H17 Old Provisional Name')
 RETURNING id INTO v_mid;
 SELECT public_ref INTO STRICT v_ref FROM group_read_private.directory_refs WHERE member_id=v_mid;
 PERFORM set_config('h17.owner',v_owner::text,true);
 PERFORM set_config('h17.recipient',v_recipient::text,true);
 PERFORM set_config('h17.outsider',v_outsider::text,true);
 PERFORM set_config('h17.club',v_club::text,true);
 PERFORM set_config('h17.source',v_source::text,true);
 PERFORM set_config('h17.member_id',v_mid::text,true);
 PERFORM set_config('h17.public_reference',v_ref::text,true);
 PERFORM set_config('h17.recipient_pp',v_recipient_pp::text,true);
 PERFORM set_config('h17.outsider_pp',v_outsider_pp::text,true);
END $seed$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h17.recipient'),true);
DO $deny_public_unconfirmed$
BEGIN
 BEGIN
  PERFORM public.submit_public_club_claim_named(
   current_setting('h17.club')::uuid,NULL,NULL,NULL,'H17 Not Approved',false);
  RAISE EXCEPTION 'Missing consent was accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN
  PERFORM set_config('h17.no_consent_blocked','true',true);
 END;
END $deny_public_unconfirmed$;
SELECT set_config('h17.recipient_req',public.submit_public_club_claim_named(
 current_setting('h17.club')::uuid,NULL,NULL,NULL,'H17 Selected Recipient',true)::text,true);

SELECT set_config('request.jwt.claim.sub',current_setting('h17.owner'),true);
DO $approve_normal$
DECLARE r jsonb;
BEGIN
 r:=public.review_profile_join_request(current_setting('h17.recipient_req')::uuid,'approved');
 IF r->>'status'<>'approved' THEN RAISE EXCEPTION 'H17 normal review status'; END IF;
END $approve_normal$;

SELECT set_config('request.jwt.claim.sub',current_setting('h17.outsider'),true);
SELECT set_config('h17.preview_token',(
 public.preview_public_club_claim(current_setting('h17.club')::uuid,
 current_setting('h17.public_reference')::uuid)->>'review_token'),true);
DO $preview_guard$
BEGIN
 IF nullif(current_setting('h17.preview_token',true),'') IS NULL
 THEN RAISE EXCEPTION 'H17 preview missing'; END IF;
END $preview_guard$;
SELECT set_config('h17.outsider_req',public.submit_public_club_claim_named(
 current_setting('h17.club')::uuid,current_setting('h17.public_reference')::uuid,
 NULL,current_setting('h17.preview_token'),
 'H17 Approved Chosen Provisional',true)::text,true);
SELECT set_config('request.jwt.claim.sub',current_setting('h17.owner'),true);
DO $approve_claim$
DECLARE r jsonb;
BEGIN
 r:=public.review_profile_join_request(current_setting('h17.outsider_req')::uuid,'approved');
 IF r->>'status'<>'approved' THEN RAISE EXCEPTION 'H17 claim review status'; END IF;
END $approve_claim$;
RESET ROLE;

SELECT jsonb_build_object('rollback_only',true,
 'no_consent_rejected',current_setting('h17.no_consent_blocked',true)='true',
 'approval_requests',(SELECT count(*)=2 FROM public.join_requests
 WHERE club_id=current_setting('h17.club')::uuid AND status='approved'
  AND club_display_name_requested IS NOT NULL AND club_display_name_confirmed_at IS NOT NULL),
 'recipient_name_applied',(SELECT cm.club_display_name='H17 Selected Recipient'
   AND cm.club_display_name_public_confirmed_at IS NOT NULL FROM public.club_members cm
 WHERE cm.club_id=current_setting('h17.club')::uuid AND cm.player_profile_id=current_setting('h17.recipient_pp')::uuid),
 'claimed_name_applied',(SELECT cm.club_display_name='H17 Approved Chosen Provisional'
   AND cm.club_display_name_public_confirmed_at IS NOT NULL
   AND cm.player_profile_id=current_setting('h17.outsider_pp')::uuid
   FROM public.club_members cm WHERE cm.id=current_setting('h17.member_id')::uuid),
 'provisional_profile_inactivated',(SELECT NOT is_active AND linked_auth_user_id IS NULL
 FROM public.player_profiles WHERE id=current_setting('h17.source')::uuid),
 'public_directory_only_consented',(SELECT count(*)=2
 FROM public.get_public_club_directory(current_setting('h17.club')::uuid)),
 'public_ref_not_real_member_id',(current_setting('h17.public_reference')::uuid <> current_setting('h17.member_id')::uuid),
 'direct_named_raw_rpc_revoked',NOT has_function_privilege('authenticated','public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
) report;
ROLLBACK;