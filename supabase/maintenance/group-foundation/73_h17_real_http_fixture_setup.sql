-- TASK-08/H17: STAGING ONLY. Synthetic unlinked public directory candidate.
-- This fixture belongs to the dedicated one-shot JWT HTTP test; never production.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $setup$
DECLARE v_owner uuid;v_owner_pp uuid;v_club uuid;v_player uuid;v_member uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs)<>3
 OR (SELECT count(*) FROM public.club_members)<>12
 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.join_requests)<>0
 OR (SELECT count(*) FROM public.player_profile_merges)<>0
 OR (SELECT count(*) FROM public.notifications)<>0
 OR EXISTS(SELECT 1 FROM public.clubs WHERE name='TASK08-H17-HTTP-20261120-PUBLIC')
 OR EXISTS(SELECT 1 FROM public.player_profiles WHERE display_name='TASK08-H17-HTTP-UNLINKED')
 OR (SELECT count(*) FROM public.club_members
    WHERE club_display_name IS NOT NULL OR club_display_name_public_confirmed_at IS NOT NULL)<>0
 THEN RAISE EXCEPTION 'H17 setup baseline changed; no fixture created'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_owner_pp FROM public.player_profiles WHERE linked_auth_user_id=v_owner AND is_active;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility,description)
 VALUES('TASK08-H17-HTTP-20261120-PUBLIC',v_owner,true,'public','Temporary Stage named join HTTP verification') RETURNING id INTO v_club;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_club,v_owner,v_owner_pp,'main_admin',true,'active');
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H17-HTTP-UNLINKED',v_owner,true) RETURNING id INTO v_player;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status,club_display_name)
 VALUES(v_club,NULL,v_player,'member',true,'active','H17 Public Provisional Alias') RETURNING id INTO v_member;
 IF NOT EXISTS(
    SELECT 1 FROM group_read_private.directory_refs WHERE member_id=v_member)
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_club)<>2
 THEN RAISE EXCEPTION 'H17 public directory reference not installed'; END IF;
END $setup$;
SELECT jsonb_build_object('stage_fixture_only',true,
 'clubs',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H17-HTTP-20261120-PUBLIC'),
 'members',(SELECT count(*) FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id WHERE c.name='TASK08-H17-HTTP-20261120-PUBLIC'),
 'profiles',(SELECT count(*) FROM public.player_profiles WHERE display_name='TASK08-H17-HTTP-UNLINKED'),
 'other_requests',(SELECT count(*) FROM public.join_requests)) report;
COMMIT;