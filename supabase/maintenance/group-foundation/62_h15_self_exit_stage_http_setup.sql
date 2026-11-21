-- TASK-08-03/H15: STAGING ONLY isolated one-shot authenticated HTTP fixture.
-- No production use. Reuses existing Stage test Auth + player profiles; does not alter them.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $seed$
DECLARE v_owner uuid;v_sub uuid;v_member uuid;v_owner_pp uuid;v_sub_pp uuid;v_member_pp uuid;v_club uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs WHERE name='TASK08-H15-SELF-EXIT-HTTP-20261119')<>0
 OR (SELECT count(*) FROM public.clubs)<>3
 OR (SELECT count(*) FROM public.club_members)<>12
 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0
 THEN RAISE EXCEPTION 'H15 Stage-only fixture isolation changed'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_sub FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_member FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_owner_pp FROM public.player_profiles WHERE linked_auth_user_id=v_owner AND is_active;
 SELECT id INTO STRICT v_sub_pp FROM public.player_profiles WHERE linked_auth_user_id=v_sub AND is_active;
 SELECT id INTO STRICT v_member_pp FROM public.player_profiles WHERE linked_auth_user_id=v_member AND is_active;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility,description)
 VALUES('TASK08-H15-SELF-EXIT-HTTP-20261119',v_owner,true,'private',
 'STAGING ONLY H15 self withdrawal HTTP test') RETURNING id INTO v_club;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_club,v_owner,v_owner_pp,'main_admin',true,'active'),
 (v_club,v_sub,v_sub_pp,'sub_admin',true,'active'),
 (v_club,v_member,v_member_pp,'member',true,'active');
 IF (SELECT count(*) FROM public.club_members WHERE club_id=v_club)<>3
 THEN RAISE EXCEPTION 'H15 membership fixture mismatch'; END IF;
END $seed$;
SELECT jsonb_build_object('stage_fixture_only',true,
 'test_club',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H15-SELF-EXIT-HTTP-20261119'),
 'test_members',(SELECT count(*) FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id WHERE c.name='TASK08-H15-SELF-EXIT-HTTP-20261119'),
 'baseline_profiles',(SELECT count(*) FROM public.player_profiles)
) AS report;
COMMIT;