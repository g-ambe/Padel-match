-- TASK-08/H14: STAGING ONLY. Remove exact disposable history fixture after HTTP tests.
-- Never delete real profiles, auth.users, other clubs or events.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $cleanup$
DECLARE v_auth uuid;v_club uuid;v_event uuid;v_match uuid;v_profiles uuid[];
        v_deleted integer;v_name text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H14 cleanup role denied'; END IF;
 SELECT id INTO STRICT v_auth FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_club FROM public.clubs WHERE name='TASK08-H14-RETIRED-HTTP-20261119'
 AND owner_id=v_auth AND visibility='private' AND is_active;
 SELECT id INTO STRICT v_event FROM public.events WHERE club_id=v_club
 AND name='TASK08-H14-RETIRED-HISTORY-ONLY' AND status='closed' AND stats_mode='official' AND event_mode='auto'
 AND share_enabled=false AND NOT coalesce(is_deleted,false);
 SELECT id INTO STRICT v_match FROM public.matches WHERE event_id=v_event AND completed AND court_number=1;
 SELECT array_agg(id ORDER BY display_name) INTO STRICT v_profiles FROM public.player_profiles
 WHERE created_by_auth_user_id=v_auth AND linked_auth_user_id IS NULL AND display_name IN(
  'TASK08-H14-RETIRED-ACTIVE-1','TASK08-H14-RETIRED-ACTIVE-2','TASK08-H14-RETIRED-INACTIVE');
 IF cardinality(v_profiles)<>3
 OR (SELECT count(*) FROM public.events)<>1
 OR (SELECT count(*) FROM public.matches)<>1
 OR (SELECT count(*) FROM public.match_results WHERE match_id=v_match AND score_a=4 AND score_b=2 AND winner_team='A')<>1
 OR (SELECT count(*) FROM public.match_players WHERE match_id=v_match)<>4
 OR (SELECT count(*) FROM public.event_participants WHERE event_id=v_event)<>4
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_club)<>4
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_club AND NOT is_active AND player_profile_id=ANY(v_profiles))<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_club AND is_active)<>3
 OR (SELECT count(*) FROM public.player_stats WHERE club_id=v_club)<>0
 OR (SELECT count(*) FROM public.join_requests WHERE club_id=v_club)<>0
 OR (SELECT count(*) FROM public.official_events WHERE club_id=v_club)<>0
 OR (SELECT count(*) FROM public.notifications WHERE related_club_id=v_club)<>0
 OR (SELECT count(*) FROM public.event_team_sides WHERE club_id=v_club)<>0
 OR (SELECT count(*) FROM public.player_profile_link_requests WHERE club_id=v_club)<>0
 OR (SELECT count(*) FROM public.player_profile_merges WHERE club_id=v_club)<>0
 OR (SELECT count(*) FROM public.club_members WHERE player_profile_id=ANY(v_profiles) AND club_id<>v_club)<>0
 OR (SELECT count(*) FROM public.event_participants WHERE player_profile_id=ANY(v_profiles) AND event_id<>v_event)<>0
 THEN RAISE EXCEPTION 'H14 fixture changed or unexpected dependent data: refusing delete'; END IF;
 DELETE FROM public.match_results WHERE match_id=v_match;
 DELETE FROM public.match_players WHERE match_id=v_match;
 DELETE FROM public.matches WHERE id=v_match;
 DELETE FROM public.event_participants WHERE event_id=v_event;
 DELETE FROM public.events WHERE id=v_event;
 DELETE FROM public.clubs WHERE id=v_club;  -- CASCADE only its 4 exact memberships/directory refs.
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 IF v_deleted<>1 THEN RAISE EXCEPTION 'H14 cleanup club row count mismatch'; END IF;
 DELETE FROM public.player_profiles WHERE id=ANY(v_profiles);
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 IF v_deleted<>3 THEN RAISE EXCEPTION 'H14 cleanup profile row count mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.clubs WHERE id=v_club)
 OR EXISTS(SELECT 1 FROM public.events WHERE id=v_event)
 OR EXISTS(SELECT 1 FROM public.player_profiles WHERE id=ANY(v_profiles))
 OR EXISTS(SELECT 1 FROM public.club_members WHERE club_id=v_club)
 THEN RAISE EXCEPTION 'H14 fixture cleanup incomplete'; END IF;
END $cleanup$;
SELECT jsonb_build_object('stage_cleanup_only',true,
 'fixture_clubs',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H14-RETIRED-HTTP-20261119'),
 'fixture_players',(SELECT count(*) FROM public.player_profiles WHERE display_name LIKE 'TASK08-H14-RETIRED-%'),
 'events',(SELECT count(*) FROM public.events),
 'matches',(SELECT count(*) FROM public.matches)) AS report;
COMMIT;