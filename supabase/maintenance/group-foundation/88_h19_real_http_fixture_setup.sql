-- H19 STAGE ONLY real Auth fixture. Never production.
BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='35s';
DO $seed$
DECLARE a uuid;b uuid;c uuid;ap uuid;bp uuid;cp uuid;club uuid;
BEGIN
 IF current_user<>'postgres' OR (SELECT count(*) FROM public.clubs)<>3
 OR (SELECT count(*) FROM public.club_members)<>12 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.events)<>0 OR (SELECT count(*) FROM public.notifications)<>0
 OR (SELECT count(*) FROM public.club_owner_transfer_requests)<>0
 OR EXISTS(SELECT 1 FROM public.clubs WHERE name='TASK08-H19-HTTP-20261120') THEN
 RAISE EXCEPTION 'H19 Stage test baseline changed'; END IF;
 SELECT id INTO STRICT a FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT b FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT c FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT ap FROM public.player_profiles WHERE linked_auth_user_id=a AND is_active;
 SELECT id INTO STRICT bp FROM public.player_profiles WHERE linked_auth_user_id=b AND is_active;
 SELECT id INTO STRICT cp FROM public.player_profiles WHERE linked_auth_user_id=c AND is_active;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility,description)
 VALUES('TASK08-H19-HTTP-20261120',a,true,'private','Isolated ownership transfer real HTTP test')
 RETURNING id INTO club;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(club,a,ap,'main_admin',true,'active'),(club,b,bp,'main_admin',true,'active'),
 (club,c,cp,'member',true,'active');
 IF (SELECT count(*) FROM public.club_members WHERE club_id=club)<>3 THEN
  RAISE EXCEPTION 'H19 fixture member count mismatch'; END IF;
END $seed$;
SELECT jsonb_build_object('stage_only',true,
'fixture_clubs',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H19-HTTP-20261120'),
'fixture_members',(SELECT count(*) FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id WHERE c.name='TASK08-H19-HTTP-20261120'),
'owner_transfers',(SELECT count(*) FROM public.club_owner_transfer_requests)) report;
COMMIT;