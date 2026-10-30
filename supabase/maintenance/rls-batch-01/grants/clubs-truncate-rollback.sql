BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF has_table_privilege('anon','public.clubs','TRUNCATE') IS DISTINCT FROM false
 OR has_table_privilege('authenticated','public.clubs','TRUNCATE') IS DISTINCT FROM false THEN RAISE EXCEPTION 'clubs-truncate privilege drift; stop'; END IF;
END $guard$;
GRANT TRUNCATE ON public.clubs TO anon;
GRANT TRUNCATE ON public.clubs TO authenticated;
DO $guard$ BEGIN
 IF has_table_privilege('anon','public.clubs','TRUNCATE') IS DISTINCT FROM true
 OR has_table_privilege('authenticated','public.clubs','TRUNCATE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'clubs-truncate privilege drift; stop'; END IF;
END $guard$;
COMMIT;
