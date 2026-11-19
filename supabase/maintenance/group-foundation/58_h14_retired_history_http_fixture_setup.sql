-- TASK-08/H14: STAGE ONLY synthetic retired-member history HTTP fixture.
-- NEVER RUN IN PRODUCTION. Requires empty events/matches and exact test accounts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $setup$
DECLARE v_auth uuid;v_profile uuid;v_club uuid;v_event uuid;v_match uuid;
        v_p1 uuid;v_p2 uuid;v_retired uuid;v_a uuid;v_b uuid;v_c uuid;v_d uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.matches)<>0
 OR (SELECT count(*) FROM public.match_results)<>0
 OR (SELECT count(*) FROM public.event_participants)<>0
 OR (SELECT count(*) FROM public.clubs WHERE name='TASK08-H14-RETIRED-HTTP-20261119')<>0
 OR (SELECT count(*) FROM public.player_profiles WHERE display_name LIKE 'TASK08-H14-RETIRED-%')<>0
 OR (SELECT count(*) FROM public.clubs WHERE name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>2
 OR (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0
 THEN RAISE EXCEPTION 'H14 stage fixture isolation failed'; END IF;
 SELECT id INTO STRICT v_auth FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_profile FROM public.player_profiles WHERE linked_auth_user_id=v_auth AND is_active;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility,description)
 VALUES('TASK08-H14-RETIRED-HTTP-20261119',v_auth,true,'private','H14 synthetic history HTTP fixture') RETURNING id INTO v_club;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H14-RETIRED-ACTIVE-1',v_auth,true) RETURNING id INTO v_p1;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H14-RETIRED-ACTIVE-2',v_auth,true) RETURNING id INTO v_p2;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H14-RETIRED-INACTIVE',v_auth,true) RETURNING id INTO v_retired;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES (v_club,v_auth,v_profile,'main_admin',true,'active'),
 (v_club,NULL,v_p1,'member',true,'active'),
 (v_club,NULL,v_p2,'member',true,'active'),
 (v_club,NULL,v_retired,'member',false,'active');
 INSERT INTO public.events(club_id,name,category,court_count,status,closed_at,event_mode,stats_mode,share_enabled,created_by_auth_user_id)
 VALUES(v_club,'TASK08-H14-RETIRED-HISTORY-ONLY','club',1,'closed',now(),'auto','official',false,v_auth) RETURNING id INTO v_event;
 INSERT INTO public.event_participants(event_id,player_profile_id,participant_type,status,guest_name)
 VALUES(v_event,v_profile,'member','active','TASK08-H14-MANAGER') RETURNING id INTO v_a;
 INSERT INTO public.event_participants(event_id,player_profile_id,participant_type,status,guest_name)
 VALUES(v_event,v_p1,'member','active','TASK08-H14-ACTIVE-1') RETURNING id INTO v_b;
 INSERT INTO public.event_participants(event_id,player_profile_id,participant_type,status,guest_name)
 VALUES(v_event,v_p2,'member','active','TASK08-H14-ACTIVE-2') RETURNING id INTO v_c;
 INSERT INTO public.event_participants(event_id,player_profile_id,participant_type,status,guest_name)
 VALUES(v_event,v_retired,'member','active','TASK08-H14-RETIRED') RETURNING id INTO v_d;
 INSERT INTO public.matches(event_id,court_number,completed) VALUES(v_event,1,true) RETURNING id INTO v_match;
 INSERT INTO public.match_players(match_id,participant_id,team)
 VALUES(v_match,v_a,'A'),(v_match,v_b,'A'),(v_match,v_c,'B'),(v_match,v_d,'B');
 INSERT INTO public.match_results(match_id,score_a,score_b,winner_team) VALUES(v_match,4,2,'A');
 IF (SELECT count(*) FROM public.club_members cm WHERE cm.club_id=v_club)<>4
 OR (SELECT count(*) FROM public.event_participants ep WHERE ep.event_id=v_event)<>4
 OR (SELECT count(*) FROM public.match_players mp WHERE mp.match_id=v_match)<>4
 THEN RAISE EXCEPTION 'H14 fixture count mismatch'; END IF;
END $setup$;
SELECT jsonb_build_object('stage_synthetic_only',true,
 'club_count',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H14-RETIRED-HTTP-20261119'),
 'event_count',(SELECT count(*) FROM public.events WHERE name='TASK08-H14-RETIRED-HISTORY-ONLY'),
 'retired_members',(SELECT count(*) FROM public.club_members cm JOIN public.clubs c ON c.id=cm.club_id WHERE c.name='TASK08-H14-RETIRED-HTTP-20261119' AND NOT cm.is_active),
 'match_count',(SELECT count(*) FROM public.matches)) AS report;
COMMIT;