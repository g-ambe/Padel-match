-- TASK-08-03 / H17: public-reference-safe entrypoint after 0058.
-- The internal member UUID must never be required by a public join client.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('public.submit_public_club_claim(uuid,uuid,text,text)') IS NULL
 OR to_regprocedure('group_read_private.claim_member(uuid,uuid)') IS NULL
 OR to_regprocedure('public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)') IS NULL
 OR to_regprocedure('public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)') IS NOT NULL
 THEN RAISE EXCEPTION 'H17 public-reference API prerequisites missing'; END IF;
END $preflight$;

CREATE FUNCTION public.submit_public_club_claim_named(
 p_club_id uuid,p_reference uuid,p_message text,p_review_token text,
 p_club_display_name text,p_public_confirmation boolean
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $public_join$
DECLARE v_member uuid;
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501';
 END IF;
 PERFORM profile_link_private.serialize_operations();
 IF p_reference IS NOT NULL THEN
  v_member:=group_read_private.claim_member(p_club_id,p_reference);
 ELSE v_member:=NULL; END IF;

 -- This internal function runs as postgres and is never callable directly by
 -- browser authenticated role, so raw member IDs cannot be accepted outside
 -- the directory-ref resolution.
 RETURN public.submit_profile_join_request_named(
  p_club_id,v_member,p_message,p_review_token,
  p_club_display_name,p_public_confirmation);
END $public_join$;

REVOKE ALL ON FUNCTION public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)
 TO authenticated;

DO $postflight$
BEGIN
 IF has_function_privilege('authenticated','public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 OR has_function_privilege('anon','public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 OR has_function_privilege('anon','public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
 OR NOT (SELECT prosecdef FROM pg_proc
  WHERE oid='public.submit_public_club_claim_named(uuid,uuid,text,text,text,boolean)'::regprocedure)
 THEN RAISE EXCEPTION 'H17 claim API privileges wrong'; END IF;
END $postflight$;
COMMIT;