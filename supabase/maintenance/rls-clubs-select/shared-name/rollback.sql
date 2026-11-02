-- Restore clubs SELECT first and roll back the UI prerequisite before removing this API.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
DROP FUNCTION public.get_shared_official_club_name(text);
DROP FUNCTION shared_read_private.official_club_name(text);
DROP SCHEMA shared_read_private; -- RESTRICT by default; no unrelated objects removed
COMMIT;
