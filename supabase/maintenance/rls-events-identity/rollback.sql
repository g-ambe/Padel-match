-- Removes this guard only. Does not restore broad INSERT/DELETE/SELECT policies.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.events IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.events'::regclass
   AND tgname='guard_event_identity'
   AND tgfoid='events_identity_private.guard_event_identity()'::regprocedure)
 THEN RAISE EXCEPTION 'Unexpected trigger state; stop and review'; END IF;
END $guard$;
DROP TRIGGER guard_event_identity ON public.events;
DROP FUNCTION events_identity_private.guard_event_identity();
DROP SCHEMA events_identity_private;
COMMIT;
