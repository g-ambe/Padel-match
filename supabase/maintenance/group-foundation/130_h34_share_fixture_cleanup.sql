-- H12 STAGING ONLY: guarded cleanup of the exact 3 disposable HTTP fixtures.
-- Never delete real users, clubs, player profiles, or their memberships.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $cleanup$
DECLARE ef uuid;et uuid;eo uuid;mf uuid;om uuid;
        event_deleted integer;official_deleted integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H12 cleanup restricted to postgres'; END IF;
 SELECT id INTO STRICT ef FROM public.events WHERE name='TASK08-H12-HTTP-FRIENDLY-ONLY'
 AND share_token='TASK08H12HTTPFRIENDLYONLY' AND event_mode='manual' AND status='closed' AND share_enabled;
 SELECT id INTO STRICT et FROM public.events WHERE name='TASK08-H12-HTTP-MIXED-ONLY'
 AND share_token='TASK08H12HTTPMIXEDONLY' AND event_mode='team' AND status='closed' AND share_enabled;
 SELECT id INTO STRICT eo FROM public.official_events WHERE title='TASK08-H12-HTTP-OFFICIAL-ONLY'
 AND share_token='TASK08H12HTTPOFFICIALONLY' AND status='closed' AND share_enabled;
 IF ef=et
 OR (SELECT count(*) FROM public.events)<>2
 OR (SELECT count(*) FROM public.official_events)<>1
 OR (SELECT count(*) FROM public.event_participants WHERE event_id=ef)<>4
 OR (SELECT count(*) FROM public.match_players mp JOIN public.matches m ON m.id=mp.match_id WHERE m.event_id=ef)<>4
 OR (SELECT count(*) FROM public.matches WHERE event_id=ef)<>1
 OR (SELECT count(*) FROM public.event_team_sides WHERE event_id=et)<>2
 OR (SELECT count(*) FROM public.event_team_guests WHERE event_id=et)<>4
 OR (SELECT count(*) FROM public.event_team_rounds WHERE event_id=et)<>1
 OR (SELECT count(*) FROM public.event_team_matches WHERE event_id=et AND generation_mode='mixed')<>1
 OR (SELECT count(*) FROM public.event_team_attendance WHERE event_id=et)<>0
 OR (SELECT count(*) FROM public.official_matches WHERE official_event_id=eo)<>1
 OR (SELECT count(*) FROM public.official_opponents WHERE official_event_id=eo)<>1
 OR (SELECT count(*) FROM public.event_video_links WHERE event_id IN(ef,et))<>1
 OR (SELECT count(*) FROM public.event_video_links WHERE event_id=ef AND title='TASK08-H34-VIDEO')<>1
 THEN RAISE EXCEPTION 'H12 unexpected fixture mutation; no cleanup performed'; END IF;
 SELECT id INTO STRICT mf FROM public.matches WHERE event_id=ef;
 SELECT id INTO STRICT om FROM public.official_matches WHERE official_event_id=eo;
 IF (SELECT count(*) FROM public.match_results WHERE match_id=mf AND score_a=4 AND score_b=2)<>1
 OR (SELECT count(*) FROM public.event_team_matches WHERE event_id=et AND pair_1_score=4 AND pair_2_score=2 AND pair_result='win')<>1
 OR (SELECT count(*) FROM public.official_matches WHERE id=om AND our_score=4 AND opponent_score=2)<>1
 THEN RAISE EXCEPTION 'H12 fixture score changed; review before deletion'; END IF;
 DELETE FROM public.event_video_clicks WHERE event_id=ef AND match_id=mf;
 DELETE FROM public.event_video_link_clicks WHERE event_id=ef AND event_video_link_id IN(SELECT id FROM public.event_video_links WHERE event_id=ef AND title='TASK08-H34-VIDEO');
 DELETE FROM public.official_video_clicks WHERE official_event_id=eo AND official_match_id=om;
 DELETE FROM public.event_video_links WHERE event_id=ef AND title='TASK08-H34-VIDEO';
 DELETE FROM public.match_results WHERE match_id=mf;
 DELETE FROM public.match_players WHERE match_id=mf;
 DELETE FROM public.matches WHERE id=mf;
 DELETE FROM public.event_participants WHERE event_id=ef;
 DELETE FROM public.event_team_matches WHERE event_id=et;
 DELETE FROM public.event_team_rounds WHERE event_id=et;
 DELETE FROM public.event_team_guests WHERE event_id=et;
 DELETE FROM public.event_team_sides WHERE event_id=et;
 DELETE FROM public.official_matches WHERE official_event_id=eo;
 DELETE FROM public.official_opponents WHERE official_event_id=eo;
 DELETE FROM public.official_events WHERE id=eo;
 GET DIAGNOSTICS official_deleted=ROW_COUNT;
 DELETE FROM public.events WHERE id IN (ef,et);
 GET DIAGNOSTICS event_deleted=ROW_COUNT;
 IF event_deleted<>2 OR official_deleted<>1
 OR EXISTS(SELECT 1 FROM public.events WHERE id IN(ef,et))
 OR EXISTS(SELECT 1 FROM public.official_events WHERE id=eo)
 THEN RAISE EXCEPTION 'H12 cleanup count mismatch'; END IF;
END $cleanup$;
SELECT jsonb_build_object(
 'cleanup_test_only',true,
 'remaining_events',(SELECT count(*) FROM public.events),
 'remaining_official_events',(SELECT count(*) FROM public.official_events),
 'remaining_team_matches',(SELECT count(*) FROM public.event_team_matches),
 'remaining_team_guests',(SELECT count(*) FROM public.event_team_guests)
) AS report;
COMMIT;