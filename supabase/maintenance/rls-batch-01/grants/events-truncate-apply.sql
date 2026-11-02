BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF has_table_privilege('anon','public.events','TRUNCATE') IS DISTINCT FROM true
 OR has_table_privilege('authenticated','public.events','TRUNCATE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'events-truncate privilege drift; stop'; END IF;
END $guard$;
REVOKE TRUNCATE ON public.events FROM anon,authenticated;
DO $guard$ BEGIN
 IF has_table_privilege('anon','public.events','TRUNCATE') IS DISTINCT FROM false
 OR has_table_privilege('authenticated','public.events','TRUNCATE') IS DISTINCT FROM false THEN RAISE EXCEPTION 'events-truncate privilege drift; stop'; END IF;
END $guard$;
COMMIT;
