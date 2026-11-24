-- TASK-08 / H37: production-compatible ADDITIVE video click RPC candidate.
-- Stage H31/H33 source functions, without H33's Stage-specific no-events/no-fixed-pairs guard.
-- Not yet approved for Prod execution or migration-history registration.
-- Existing legacy RPCs/anonymous grants are NOT modified here; H35 is a later release step.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

DO $preflight$
DECLARE name text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H37 privileged migration owner required'; END IF;
 FOREACH name IN ARRAY ARRAY[
  'public.record_event_video_click_by_token(uuid,text,text,text)',
  'public.record_event_video_link_click_by_token(uuid,text,text,text)',
  'public.record_official_video_click_by_token(uuid,text,text,text)'
 ] LOOP
   IF to_regprocedure(name) IS NOT NULL THEN
     RAISE EXCEPTION 'H37 token-bound RPC already present: % (no replacement)',name;
   END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY[
  'public.record_event_video_click(uuid,text,text)',
  'public.record_event_video_link_click(uuid,text,text)',
  'public.record_official_video_click(uuid,text,text)'
 ] LOOP
   IF to_regprocedure(name) IS NULL THEN RAISE EXCEPTION 'H37 missing legacy video RPC: %',name; END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY[
  'public.events','public.matches','public.event_video_clicks','public.event_video_links',
  'public.event_video_link_clicks','public.official_events','public.official_matches',
  'public.official_video_clicks'
 ] LOOP
   IF to_regclass(name) IS NULL THEN RAISE EXCEPTION 'H37 missing source table: %',name; END IF;
 END LOOP;
 IF EXISTS (
   SELECT 1 FROM pg_class
   WHERE oid IN ('public.event_video_clicks'::regclass,
    'public.event_video_link_clicks'::regclass,'public.official_video_clicks'::regclass)
   AND NOT relrowsecurity
 ) THEN RAISE EXCEPTION 'H37 click-table RLS disabled'; END IF;
END $preflight$;

CREATE FUNCTION public.record_event_video_click_by_token(
  p_match_id uuid, p_share_token text, p_user_agent text DEFAULT NULL,
  p_referrer text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r record;
BEGIN
  IF p_share_token IS NULL OR length(p_share_token)=0 OR length(p_share_token)>256 THEN RETURN; END IF;
  SELECT m.id AS match_id,m.event_id,m.round_id INTO r
    FROM public.matches m JOIN public.events e ON e.id=m.event_id
   WHERE m.id=p_match_id AND e.share_token=p_share_token AND e.share_token <> ''
     AND e.status='closed' AND e.share_enabled AND NOT coalesce(e.is_deleted,false)
     AND m.youtube_url IS NOT NULL AND btrim(m.youtube_url)<>''
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.event_video_clicks(event_id,round_id,match_id,source,user_agent,referrer)
    VALUES(r.event_id,r.round_id,r.match_id,'share',
      nullif(left(p_user_agent,500),''),NULL /* H33: never persist untrusted referrer URL */);
END $fn$;


CREATE FUNCTION public.record_event_video_link_click_by_token(
  p_video_link_id uuid, p_share_token text, p_user_agent text DEFAULT NULL,
  p_referrer text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r record;
BEGIN
  IF p_share_token IS NULL OR length(p_share_token)=0 OR length(p_share_token)>256 THEN RETURN; END IF;
  SELECT v.id AS link_id,v.event_id INTO r
    FROM public.event_video_links v JOIN public.events e ON e.id=v.event_id
   WHERE v.id=p_video_link_id AND e.share_token=p_share_token AND e.share_token <> ''
     AND e.status='closed' AND e.share_enabled AND NOT coalesce(e.is_deleted,false)
     AND v.video_url IS NOT NULL AND btrim(v.video_url)<>''
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.event_video_link_clicks(event_video_link_id,event_id,source,user_agent,referrer)
    VALUES(r.link_id,r.event_id,'share',
      nullif(left(p_user_agent,500),''),NULL /* H33: never persist untrusted referrer URL */);
END $fn$;


CREATE FUNCTION public.record_official_video_click_by_token(
  p_match_id uuid, p_share_token text, p_user_agent text DEFAULT NULL,
  p_referrer text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r record;
BEGIN
  IF p_share_token IS NULL OR length(p_share_token)=0 OR length(p_share_token)>256 THEN RETURN; END IF;
  SELECT m.id AS match_id,m.official_event_id,m.official_opponent_id INTO r
    FROM public.official_matches m JOIN public.official_events e ON e.id=m.official_event_id
   WHERE m.id=p_match_id AND e.share_token=p_share_token AND e.share_token <> ''
     AND e.status='closed' AND e.share_enabled AND NOT coalesce(e.is_deleted,false)
     AND m.youtube_url IS NOT NULL AND btrim(m.youtube_url)<>''
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.official_video_clicks(official_event_id,official_opponent_id,official_match_id,source,user_agent,referrer)
    VALUES(r.official_event_id,r.official_opponent_id,r.match_id,'share',
      nullif(left(p_user_agent,500),''),NULL /* H33: never persist untrusted referrer URL */);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.record_event_video_click_by_token(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.record_event_video_link_click_by_token(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.record_official_video_click_by_token(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_video_click_by_token(uuid,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_video_link_click_by_token(uuid,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_official_video_click_by_token(uuid,text,text,text) TO anon,authenticated;

DO $postflight$
DECLARE name text; f oid;
BEGIN
 FOREACH name IN ARRAY ARRAY[
  'public.record_event_video_click_by_token(uuid,text,text,text)',
  'public.record_event_video_link_click_by_token(uuid,text,text,text)',
  'public.record_official_video_click_by_token(uuid,text,text,text)'
 ] LOOP
  f:=to_regprocedure(name);
  IF f IS NULL
    OR NOT has_function_privilege('anon',f,'EXECUTE')
    OR NOT has_function_privilege('authenticated',f,'EXECUTE')
    OR (SELECT pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef
         OR NOT (proconfig @> ARRAY['search_path=""']::text[]) FROM pg_proc WHERE oid=f)
    OR position('NULL /* H33:' in (SELECT pg_get_functiondef(f)))=0
  THEN RAISE EXCEPTION 'H37 video click RPC verification failed: %',name; END IF;
 END LOOP;
END $postflight$;

COMMIT;
