-- Prerequisite only. Does not change RLS. Production approval required.
-- Target padel-hub / ntczrmvffmpjzilfebyi.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
CREATE SCHEMA shared_read_private;
REVOKE ALL ON SCHEMA shared_read_private FROM PUBLIC;
GRANT USAGE ON SCHEMA shared_read_private TO anon, authenticated;
CREATE FUNCTION shared_read_private.official_club_name(p_share_token text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $body$
 SELECT c.name
 FROM public.official_events oe JOIN public.clubs c ON c.id=oe.club_id
 WHERE p_share_token IS NOT NULL AND btrim(p_share_token)<>''
   AND oe.share_token=p_share_token AND oe.share_enabled=true
   AND oe.status='closed' AND coalesce(oe.is_deleted,false)=false
 LIMIT 1
$body$;
REVOKE ALL ON FUNCTION shared_read_private.official_club_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION shared_read_private.official_club_name(text) TO anon, authenticated;
CREATE FUNCTION public.get_shared_official_club_name(p_share_token text)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $body$ SELECT shared_read_private.official_club_name(p_share_token) $body$;
REVOKE ALL ON FUNCTION public.get_shared_official_club_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_official_club_name(text) TO anon, authenticated;
COMMIT;
