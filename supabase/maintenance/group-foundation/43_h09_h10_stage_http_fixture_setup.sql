-- TASK-08 H09/H10: STAGING ONLY - deterministic disposable club and member fixtures.
-- No production use. These belong only to dedicated Auth HTTP test 45 and cleanup 44.
-- Creates one private club, one synthetic unlinked player, and three memberships:
-- mainA main_admin, outsider sub_admin, and synthetic unlinked member.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $setup$
DECLARE ua uuid;ux uuid; pa uuid; px uuid;c uuid;u uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs WHERE name='TASK08-H09H10-HTTP-20261119')<>0
 OR (SELECT count(*) FROM public.player_profiles WHERE display_name='TASK08-H09H10-HTTP-UNLINKED')<>0
 OR (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0
 OR (SELECT count(*) FROM public.player_profile_link_requests WHERE status='pending')<>0
 OR (SELECT count(*) FROM public.clubs WHERE name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>2
 THEN RAISE EXCEPTION 'H09/H10 stage fixture setup drift'; END IF;
 SELECT id INTO STRICT ua FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT ux FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT pa FROM public.player_profiles WHERE linked_auth_user_id=ua AND is_active;
 SELECT id INTO STRICT px FROM public.player_profiles WHERE linked_auth_user_id=ux AND is_active;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility,description)
 VALUES('TASK08-H09H10-HTTP-20261119',ua,true,'private','TASK08 staging-only controlled security test')
 RETURNING id INTO c;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H09H10-HTTP-UNLINKED',ua,true) RETURNING id INTO u;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES
  (c,ua,pa,'main_admin',true,'active'),
  (c,ux,px,'sub_admin',true,'active'),
  (c,NULL,u,'member',true,'active');
 IF (SELECT count(*) FROM public.club_members WHERE club_id=c)<>3
 THEN RAISE EXCEPTION 'H09/H10 expected three controlled members'; END IF;
END $setup$;
SELECT jsonb_build_object(
 'fixture_clubs',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H09H10-HTTP-20261119'),
 'fixture_players',(SELECT count(*) FROM public.player_profiles WHERE display_name='TASK08-H09H10-HTTP-UNLINKED'),
 'fixture_members',(SELECT count(*) FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id WHERE c.name='TASK08-H09H10-HTTP-20261119')
) AS report;
COMMIT;
