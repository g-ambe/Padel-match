BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF has_table_privilege('anon','public.events','DELETE') IS DISTINCT FROM false
 OR has_table_privilege('authenticated','public.events','DELETE') IS DISTINCT FROM false THEN RAISE EXCEPTION 'events-delete privilege drift; stop'; END IF;
END $guard$;
GRANT DELETE ON public.events TO authenticated;
DO $guard$ BEGIN
 IF has_table_privilege('anon','public.events','DELETE') IS DISTINCT FROM false
 OR has_table_privilege('authenticated','public.events','DELETE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'events-delete privilege drift; stop'; END IF;
END $guard$;
COMMIT;
