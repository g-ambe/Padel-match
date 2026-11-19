-- TASK-08 H12/H14: STAGING ONLY / strictly ROLLBACK positive and negative token tests.
-- Synthetic friendly + official closed events with score and guest entries.
-- No real user, profile, club, score, video, history or token is persisted/modified.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $setup$
DECLARE club uuid; actor uuid; ev uuid; ev_disabled uuid; official uuid; opponent uuid;
        match_id uuid; official_match uuid; players uuid[];
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.official_events)<>0
 OR (SELECT count(*) FROM public.matches)<>0
 OR (SELECT count(*) FROM public.match_results)<>0
 OR (SELECT count(*) FROM public.event_participants)<>0
 THEN RAISE EXCEPTION 'H12 stage sharing fixture isolation changed'; END IF;
 SELECT id INTO STRICT club FROM public.clubs
 WHERE name='TASK08-P0-20261119-A' AND is_active AND NOT coalesce(is_deleted,false);
 SELECT id INTO STRICT actor FROM auth.users
 WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 INSERT INTO public.events(club_id,name,category,court_count,status,closed_at,
   share_enabled,share_token,event_mode,created_by_auth_user_id)
 VALUES(club,'TASK08-H12-ROLLBACK-FRIENDLY','club',1,'closed',now(),
   true,'TASK08-H12-ROLLBACK-TOKEN-VALID-A','manual',actor)
 RETURNING id INTO ev;
 INSERT INTO public.events(club_id,name,category,court_count,status,closed_at,
   share_enabled,share_token,event_mode,created_by_auth_user_id)
 VALUES(club,'TASK08-H12-ROLLBACK-NO-SHARE','club',1,'closed',now(),
   false,'TASK08-H12-ROLLBACK-TOKEN-DISABLED','manual',actor)
 RETURNING id INTO ev_disabled;
 INSERT INTO public.event_participants(event_id,guest_name,participant_type,status)
 SELECT ev,'TASK08-H12-ROLLBACK-GUEST-'||n,'guest','active'
 FROM generate_series(1,4) AS n;
 SELECT array_agg(id ORDER BY guest_name) INTO players FROM public.event_participants
 WHERE event_id=ev;
 IF cardinality(players)<>4 THEN RAISE EXCEPTION 'H12 participants missing'; END IF;
 INSERT INTO public.matches(event_id,court_number,completed)
 VALUES(ev,1,true) RETURNING id INTO match_id;
 INSERT INTO public.match_players(match_id,participant_id,team)
 SELECT match_id,players[n],CASE WHEN n<=2 THEN 'A' ELSE 'B' END
 FROM generate_series(1,4) AS n;
 INSERT INTO public.match_results(match_id,score_a,score_b,winner_team)
 VALUES(match_id,4,2,'A');
 INSERT INTO public.official_events(club_id,title,event_date,status,share_enabled,share_token,
    created_by_auth_user_id)
 VALUES(club,'TASK08-H12-ROLLBACK-OFFICIAL',CURRENT_DATE,'closed',true,
  'TASK08-H12-ROLLBACK-TOKEN-VALID-B',actor)
 RETURNING id INTO official;
 INSERT INTO public.official_opponents(official_event_id,opponent_team_name)
 VALUES(official,'TASK08-H12-OPPONENT') RETURNING id INTO opponent;
 INSERT INTO public.official_matches(official_event_id,official_opponent_id,match_order,
  our_player1_guest_name,our_player2_guest_name,opponent_player1_name,opponent_player2_name,
  our_score,opponent_score,result)
 VALUES(official,opponent,1,'TASK08-H12-TEAM-1','TASK08-H12-TEAM-2','TASK08-H12-RIVAL-1','TASK08-H12-RIVAL-2',4,2,'win')
 RETURNING id INTO official_match;
END $setup$;
SET LOCAL ROLE anon;
DO $unauthorized$
DECLARE code text; t jsonb;
BEGIN
 BEGIN PERFORM id FROM public.events LIMIT 1;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE; END;
 PERFORM set_config('task08.events_anon_direct_denied',(code='42501')::text,true);
 code:=null;
 BEGIN PERFORM id FROM public.official_events LIMIT 1;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE; END;
 PERFORM set_config('task08.official_anon_direct_denied',(code='42501')::text,true);
 t:=public.get_shared_event('TASK08-H12-ROLLBACK-TOKEN-VALID-A','event');
 PERFORM set_config('task08.event_valid',(
   t->'event'->>'name'='TASK08-H12-ROLLBACK-FRIENDLY'
   AND jsonb_array_length(t->'participants')=4
   AND jsonb_array_length(t->'matches')=1
   AND (t->'matches'->0->'result'->>'score_a')::int=4
   AND (t->'matches'->0->'result'->>'score_b')::int=2
   AND t->'event' ? 'event_mode'
   AND NOT (t->'event' ? 'share_token')
   AND NOT (t->'event' ? 'created_by_auth_user_id')
 )::text,true);
 t:=public.get_shared_event('TASK08-H12-ROLLBACK-TOKEN-VALID-B','official');
 PERFORM set_config('task08.official_valid',(
   t->'event'->>'title'='TASK08-H12-ROLLBACK-OFFICIAL'
   AND jsonb_array_length(t->'opponents')=1
   AND jsonb_array_length(t->'matches')=1
   AND (t->'matches'->0->>'our_score')::int=4
   AND (t->'matches'->0->>'opponent_score')::int=2
   AND NOT (t->'event' ? 'share_token')
   AND NOT (t->'matches'->0 ? 'created_by_auth_user_id')
 )::text,true);
 PERFORM set_config('task08.wrong_token_denied',(
  public.get_shared_event('TASK08-H12-ROLLBACK-TOKEN-WRONG','event') IS NULL)::text,true);
 PERFORM set_config('task08.disabled_token_denied',(
  public.get_shared_event('TASK08-H12-ROLLBACK-TOKEN-DISABLED','event') IS NULL)::text,true);
 PERFORM set_config('task08.wrong_kind_denied',(
  public.get_shared_event('TASK08-H12-ROLLBACK-TOKEN-VALID-A','official') IS NULL
  AND public.get_shared_event('TASK08-H12-ROLLBACK-TOKEN-VALID-B','event') IS NULL)::text,true);
 PERFORM set_config('task08.unexpected_kind_denied',(
  public.get_shared_event('TASK08-H12-ROLLBACK-TOKEN-VALID-A','bad') IS NULL)::text,true);
END $unauthorized$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'anon_friendly_base_select_denied',current_setting('task08.events_anon_direct_denied')::boolean,
 'anon_official_base_select_denied',current_setting('task08.official_anon_direct_denied')::boolean,
 'anon_token_friendly_score_success',current_setting('task08.event_valid')::boolean,
 'anon_token_official_score_success',current_setting('task08.official_valid')::boolean,
 'invalid_token_returns_null',current_setting('task08.wrong_token_denied')::boolean,
 'disabled_sharing_returns_null',current_setting('task08.disabled_token_denied')::boolean,
 'cross_type_token_returns_null',current_setting('task08.wrong_kind_denied')::boolean,
 'unsupported_type_returns_null',current_setting('task08.unexpected_kind_denied')::boolean,
 'fixture_events_in_transaction',(SELECT count(*) FROM public.events),
 'fixture_official_in_transaction',(SELECT count(*) FROM public.official_events),
 'fixture_matches_in_transaction',(SELECT count(*) FROM public.matches),
 'fixture_results_in_transaction',(SELECT count(*) FROM public.match_results)
) AS report;
ROLLBACK;
