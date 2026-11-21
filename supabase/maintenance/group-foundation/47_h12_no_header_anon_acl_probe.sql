-- TASK-08 H12: read-only no-token anonymous RLS/Data API exposure probe.
-- Run on stage AND production; return only counts/status, never event titles,
-- actual tokens, UUIDs, score rows, names or raw RLS expressions.
-- A base-table read without an explicitly supplied shared token must not reveal
-- official or friendly event rows if the product promises token-only access.
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL request.headers='{}';
SET LOCAL ROLE anon;
DO $audit$
DECLARE n bigint;code text;
BEGIN
 BEGIN
  SELECT count(*) INTO n FROM public.events;
  PERFORM set_config('task08.events',n::text,true);
  PERFORM set_config('task08.events_err','',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  PERFORM set_config('task08.events','-1',true);
  PERFORM set_config('task08.events_err',code,true);
 END;
 BEGIN
  SELECT count(*) INTO n FROM public.official_events;
  PERFORM set_config('task08.official_events',n::text,true);
  PERFORM set_config('task08.official_events_err','',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  PERFORM set_config('task08.official_events','-1',true);
  PERFORM set_config('task08.official_events_err',code,true);
 END;
 BEGIN
  SELECT count(*) INTO n FROM public.official_opponents;
  PERFORM set_config('task08.official_opponents',n::text,true);
  PERFORM set_config('task08.official_opponents_err','',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  PERFORM set_config('task08.official_opponents','-1',true);
  PERFORM set_config('task08.official_opponents_err',code,true);
 END;
 BEGIN
  SELECT count(*) INTO n FROM public.official_matches;
  PERFORM set_config('task08.official_matches',n::text,true);
  PERFORM set_config('task08.official_matches_err','',true);
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
  PERFORM set_config('task08.official_matches','-1',true);
  PERFORM set_config('task08.official_matches_err',code,true);
 END;
END $audit$;
RESET ROLE;
SELECT jsonb_build_object(
  'read_only',current_setting('transaction_read_only'),
  'request_has_no_share_header',current_setting('request.headers')='{}',
  'anon_events_rows_without_token',current_setting('task08.events')::bigint,
  'anon_events_error',nullif(current_setting('task08.events_err'),''),
  'anon_official_events_rows_without_token',current_setting('task08.official_events')::bigint,
  'anon_official_events_error',nullif(current_setting('task08.official_events_err'),''),
  'anon_official_opponents_rows_without_token',current_setting('task08.official_opponents')::bigint,
  'anon_official_opponents_error',nullif(current_setting('task08.official_opponents_err'),''),
  'anon_official_matches_rows_without_token',current_setting('task08.official_matches')::bigint,
  'anon_official_matches_error',nullif(current_setting('task08.official_matches_err'),'')
) AS report;
ROLLBACK;
