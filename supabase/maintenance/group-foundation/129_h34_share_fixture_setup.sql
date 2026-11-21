-- H12 STAGING ONLY. Dedicated disposable HTTP positives; never use on production.
-- Fixture tokens identify SYNTHETIC-only records. Do not use production users/profiles.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $seed$
DECLARE c1 uuid;c2 uuid;actor uuid; ef uuid;et uuid;eo uuid;ro uuid;opp uuid;
        players uuid[];mf uuid;a1 uuid;a2 uuid;b1 uuid;b2 uuid;
BEGIN
 IF current_user<>'postgres'
 OR to_regclass('public.event_team_rounds') IS NULL
 OR (SELECT count(*) FROM public.event_video_clicks)<>0
 OR (SELECT count(*) FROM public.event_video_link_clicks)<>0
 OR (SELECT count(*) FROM public.official_video_clicks)<>0
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.official_events)<>0
 OR (SELECT count(*) FROM public.event_participants)<>0
 OR (SELECT count(*) FROM public.matches)<>0
 OR (SELECT count(*) FROM public.match_results)<>0
 OR (SELECT count(*) FROM public.event_team_rounds)<>0
 OR (SELECT count(*) FROM public.event_team_matches)<>0
 OR (SELECT count(*) FROM public.event_team_guests)<>0
 OR (SELECT count(*) FROM public.event_team_sides)<>0
 OR (SELECT count(*) FROM public.event_team_attendance)<>0
 THEN RAISE EXCEPTION 'H12 STAGE ONLY: fixture isolation failed'; END IF;
 SELECT id INTO STRICT c1 FROM public.clubs WHERE name='TASK08-P0-20261119-A' AND is_active AND NOT coalesce(is_deleted,false);
 SELECT id INTO STRICT c2 FROM public.clubs WHERE name='TASK08-P0-20261119-B' AND is_active AND NOT coalesce(is_deleted,false);
 SELECT id INTO STRICT actor FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;

 INSERT INTO public.events(club_id,name,category,court_count,status,closed_at,share_enabled,share_token,event_mode,created_by_auth_user_id)
 VALUES(c1,'TASK08-H12-HTTP-FRIENDLY-ONLY','club',1,'closed',now(),true,'TASK08H12HTTPFRIENDLYONLY','manual',actor) RETURNING id INTO ef;
 INSERT INTO public.event_participants(event_id,guest_name,participant_type,status)
 SELECT ef,'TASK08-H12-TEST-GUEST-'||n,'guest','active' FROM generate_series(1,4) n;
 SELECT array_agg(id ORDER BY guest_name) INTO STRICT players FROM public.event_participants WHERE event_id=ef;
 IF cardinality(players)<>4 THEN RAISE EXCEPTION 'H12 expected four friendly guests'; END IF;
 INSERT INTO public.matches(event_id,court_number,completed,youtube_url) VALUES(ef,1,true,'https://youtu.be/TASK08H34') RETURNING id INTO mf;
 INSERT INTO public.match_players(match_id,participant_id,team)
 SELECT mf,players[n],CASE WHEN n<=2 THEN 'A' ELSE 'B' END FROM generate_series(1,4) n;
 INSERT INTO public.match_results(match_id,score_a,score_b,winner_team) VALUES(mf,4,2,'A');
 INSERT INTO public.event_video_links(event_id,title,video_url) VALUES(ef,'TASK08-H34-VIDEO','https://youtu.be/TASK08H34');

 INSERT INTO public.events(club_id,name,category,court_count,status,closed_at,share_enabled,share_token,event_mode,created_by_auth_user_id)
 VALUES(c1,'TASK08-H12-HTTP-MIXED-ONLY','club',1,'closed',now(),true,'TASK08H12HTTPMIXEDONLY','team',actor) RETURNING id INTO et;
 INSERT INTO public.event_team_sides(event_id,side,team_name,club_id)
 VALUES(et,'team_a','TASK08-緑チーム',c1),(et,'team_b','TASK08-青チーム',c2);
 INSERT INTO public.event_team_guests(event_id,side,guest_name) VALUES(et,'team_a','TASK08-A1') RETURNING id INTO a1;
 INSERT INTO public.event_team_guests(event_id,side,guest_name) VALUES(et,'team_a','TASK08-A2') RETURNING id INTO a2;
 INSERT INTO public.event_team_guests(event_id,side,guest_name) VALUES(et,'team_b','TASK08-B1') RETURNING id INTO b1;
 INSERT INTO public.event_team_guests(event_id,side,guest_name) VALUES(et,'team_b','TASK08-B2') RETURNING id INTO b2;
 INSERT INTO public.event_team_rounds(event_id,round_number,mode,court_count,eligible,request_id,request_fingerprint,created_by)
 VALUES(et,1,'mixed',1,'[]'::jsonb,gen_random_uuid(),'TASK08-H12-HTTP-MIXED-ONLY',actor) RETURNING id INTO ro;
 INSERT INTO public.event_team_matches(event_id,match_order,round_id,round_number,court_number,generation_mode,
 team_a_player1_guest_id,team_a_player1_guest_name,team_a_player1_source_side,
 team_a_player2_guest_id,team_a_player2_guest_name,team_a_player2_source_side,
 team_b_player1_guest_id,team_b_player1_guest_name,team_b_player1_source_side,
 team_b_player2_guest_id,team_b_player2_guest_name,team_b_player2_source_side,
 team_a_score,team_b_score,result,pair_1_score,pair_2_score,pair_result)
 VALUES(et,1,ro,1,1,'mixed',a1,'TASK08-A1','team_a',b1,'TASK08-B1','team_b',
 a2,'TASK08-A2','team_a',b2,'TASK08-B2','team_b',NULL,NULL,'undecided',4,2,'win');
 PERFORM team_rounds_private.check_round(ro);

 INSERT INTO public.official_events(club_id,title,event_date,status,share_enabled,share_token,created_by_auth_user_id)
 VALUES(c1,'TASK08-H12-HTTP-OFFICIAL-ONLY',CURRENT_DATE,'closed',true,'TASK08H12HTTPOFFICIALONLY',actor) RETURNING id INTO eo;
 INSERT INTO public.official_opponents(official_event_id,opponent_team_name)
 VALUES(eo,'TASK08-H12-TEST-OPPONENT') RETURNING id INTO opp;
 INSERT INTO public.official_matches(official_event_id,official_opponent_id,match_order,
 our_player1_guest_name,our_player2_guest_name,opponent_player1_name,opponent_player2_name,
 our_score,opponent_score,result,youtube_url)
 VALUES(eo,opp,1,'TASK08-OUR1','TASK08-OUR2','TASK08-THEIR1','TASK08-THEIR2',4,2,'win','https://youtu.be/TASK08H34');
END $seed$;
SELECT jsonb_build_object(
 'staging_disposable_only',true,
 'friendly_events',(SELECT count(*) FROM public.events WHERE name='TASK08-H12-HTTP-FRIENDLY-ONLY'),
 'mixed_events',(SELECT count(*) FROM public.events WHERE name='TASK08-H12-HTTP-MIXED-ONLY'),
 'official_events',(SELECT count(*) FROM public.official_events WHERE title='TASK08-H12-HTTP-OFFICIAL-ONLY'),
 'friendly_matches',(SELECT count(*) FROM public.matches),
 'team_matches',(SELECT count(*) FROM public.event_team_matches),
 'official_matches',(SELECT count(*) FROM public.official_matches)
) AS report;
COMMIT;