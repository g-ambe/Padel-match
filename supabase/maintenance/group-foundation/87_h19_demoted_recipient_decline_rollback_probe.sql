-- H19 STAGING only. Demoted recipient may safely DECLINE but never ACCEPT.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='35s';
DO $setup$
DECLARE a uuid;b uuid;ap uuid;bp uuid;club uuid;
BEGIN
 IF current_user<>'postgres' OR (SELECT count(*) FROM public.clubs)<>3
 OR (SELECT count(*) FROM public.club_members)<>12
 OR (SELECT count(*) FROM public.club_owner_transfer_requests)<>0
 OR (SELECT count(*) FROM public.notifications)<>0 THEN
 RAISE EXCEPTION 'H19 decline probe Stage isolation failed';END IF;
 SELECT id INTO STRICT a FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT b FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT ap FROM public.player_profiles WHERE linked_auth_user_id=a AND is_active;
 SELECT id INTO STRICT bp FROM public.player_profiles WHERE linked_auth_user_id=b AND is_active;
 INSERT INTO public.clubs(name,owner_id) VALUES('TASK08-H19-DECLINE-RB',a) RETURNING id INTO club;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(club,a,ap,'main_admin',true,'active'),(club,b,bp,'main_admin',true,'active');
 PERFORM set_config('h19d.owner',a::text,true);
 PERFORM set_config('h19d.recipient',b::text,true);
 PERFORM set_config('h19d.club',club::text,true);
 PERFORM set_config('h19d.target',(SELECT id::text FROM public.club_members WHERE club_id=club AND profile_id=b),true);
END $setup$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h19d.owner'),true);
DO $send$ BEGIN
 PERFORM set_config('h19d.request',
 public.request_club_owner_transfer(current_setting('h19d.club')::uuid,
 current_setting('h19d.target')::uuid)::text,true);
END $send$;
RESET ROLE;
UPDATE public.club_members SET role='sub_admin' WHERE id=current_setting('h19d.target')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h19d.recipient'),true);
DO $decision$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN PERFORM public.respond_club_owner_transfer(current_setting('h19d.request')::uuid,'accepted');
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'demoted recipient could accept';END IF;
 IF public.respond_club_owner_transfer(current_setting('h19d.request')::uuid,'declined')<>'declined'
 THEN RAISE EXCEPTION 'demoted recipient could not decline'; END IF;
 PERFORM set_config('h19d.works','true',true);
END $decision$;
RESET ROLE;
SELECT jsonb_build_object(
'rollback_only',true,
'demoted_recipient_can_decline_but_not_accept',current_setting('h19d.works',true)='true',
'owner_unchanged',(SELECT owner_id=current_setting('h19d.owner')::uuid FROM public.clubs WHERE id=current_setting('h19d.club')::uuid),
'declined_recorded',(SELECT count(*)=1 FROM public.club_owner_transfer_requests WHERE id=current_setting('h19d.request')::uuid AND status='declined'),
'notice_to_owner',(SELECT count(*)=2 FROM public.notifications WHERE related_owner_transfer_request_id=current_setting('h19d.request')::uuid)) report;
ROLLBACK;