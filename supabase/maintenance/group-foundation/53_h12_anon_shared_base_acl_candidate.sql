-- TASK-08 H12: candidate for share-RPC cutover only. Stage rollback first.
-- DO NOT APPLY TO PROD until matching secure get_shared_event RPC and shared pages deploy together.
-- Deliberately preserve authenticated SELECT, RLS, and all write privileges.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('public.get_shared_event(text,text)') IS NULL
 OR to_regprocedure('security_private.shared_event(text,text)') IS NULL
 OR NOT has_function_privilege('anon','public.get_shared_event(text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'H12 candidate: token sharing RPC is not ready'; END IF;
END $preflight$;
REVOKE SELECT ON TABLE
 public.event_team_matches,
 public.event_team_guests,
 public.event_team_sides,
 public.event_video_links,
 public.official_events,
 public.official_matches,
 public.official_opponents
FROM anon;
DO $postflight$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY[
 'event_team_matches','event_team_guests','event_team_sides','event_video_links',
 'official_events','official_matches','official_opponents'] LOOP
  IF has_table_privilege('anon',format('public.%I',t),'SELECT')
  OR has_any_column_privilege('anon',format('public.%I',t),'SELECT')
  OR NOT has_table_privilege('authenticated',format('public.%I',t),'SELECT')
  THEN RAISE EXCEPTION 'H12 candidate: anon SELECT not closed or authenticated access removed on %',t;
  END IF;
 END LOOP;
END $postflight$;
SELECT jsonb_build_object(
 'anon_raw_tables_closed',true,
 'anon_friendly_valid',public.get_shared_event('TASK08H12HTTPFRIENDLYONLY','event') IS NOT NULL,
 'anon_team_valid',public.get_shared_event('TASK08H12HTTPMIXEDONLY','event') IS NOT NULL,
 'anon_official_valid',public.get_shared_event('TASK08H12HTTPOFFICIALONLY','official') IS NOT NULL,
 'invalid_token_null',public.get_shared_event('TASK08H12INVALID','event') IS NULL
) AS report;
COMMIT;