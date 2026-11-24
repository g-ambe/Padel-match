-- TASK-08 / P0-H33: Stage-first referrer minimization for H31 token click RPCs.
-- Only replaces 3 existing RPC bodies, keeping signatures/EXECUTE permissions,
-- token checks, user-agent and click count semantics unchanged.
-- Referrer is NEVER saved, even if an API caller submits a malicious URL.
-- DO NOT apply to production; do not alter H31 recorded migration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

DO $guard$
DECLARE r record; f oid;
BEGIN
 IF current_user<>'postgres'
    OR to_regnamespace('security_private') IS NULL
    OR to_regnamespace('fixed_pair_private') IS NOT NULL
    OR (SELECT count(*) FROM public.events)<>0
    OR (SELECT count(*) FROM public.official_events)<>0
 THEN RAISE EXCEPTION 'H33 Stage identity / fixture isolation mismatch'; END IF;
 FOR r IN SELECT * FROM (VALUES
  ('record_event_video_click_by_token','269f2978121721ad8a78284a0870a873'),
  ('record_event_video_link_click_by_token','5a2dd89d5edb8807b5a75303cc8844aa'),
  ('record_official_video_click_by_token','e95266eae6fa6fb138a261d2af8b3029')
 ) AS expected(function_name,definition_hash)
 LOOP
   SELECT p.oid INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=r.function_name
      AND pg_get_function_identity_arguments(p.oid) IN (
        'p_match_id uuid, p_share_token text, p_user_agent text, p_referrer text',
        'p_video_link_id uuid, p_share_token text, p_user_agent text, p_referrer text'
      );
   IF f IS NULL OR
     (SELECT md5(pg_get_functiondef(f))) IS DISTINCT FROM r.definition_hash
     OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid=f)
     OR NOT has_function_privilege('anon',f,'EXECUTE')
     OR NOT has_function_privilege('authenticated',f,'EXECUTE')
   THEN RAISE EXCEPTION 'H33 RPC drift: %',r.function_name; END IF;
 END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.record_event_video_click_by_token(
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


CREATE OR REPLACE FUNCTION public.record_event_video_link_click_by_token(
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


CREATE OR REPLACE FUNCTION public.record_official_video_click_by_token(
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


DO $verify$
DECLARE r record; f oid; d text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   ('record_event_video_click_by_token'),
   ('record_event_video_link_click_by_token'),
   ('record_official_video_click_by_token')
 ) AS targets(name)
 LOOP
   SELECT p.oid,pg_get_functiondef(p.oid) INTO f,d FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname=r.name;
   IF f IS NULL OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid=f)
     OR NOT has_function_privilege('anon',f,'EXECUTE')
     OR NOT has_function_privilege('authenticated',f,'EXECUTE')
     OR position('p_share_token' in d)=0
     OR position('NULL /* H33:' in d)=0
     OR position('nullif(left(p_referrer,500)' in d)>0
   THEN RAISE EXCEPTION 'H33 postflight failed: %',r.name; END IF;
 END LOOP;
END $verify$;
COMMIT;
