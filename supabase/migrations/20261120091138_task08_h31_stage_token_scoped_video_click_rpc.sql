-- TASK-08 H31: Staging-first additive, token-bound share video click RPCs.
-- Stage apply only until real HTTP + app release gate passes; DO NOT APPLY TO PROD.
-- Existing legacy click RPCs remain executable during compatibility period.
-- No changes to historical click rows, base-table RLS, GRANTS or event/score data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

DO $preflight$
DECLARE name text;
BEGIN
 IF current_user<>'postgres' THEN
   RAISE EXCEPTION 'H31 expected privileged controlled migration role';
 END IF;
 FOREACH name IN ARRAY ARRAY[
  'public.record_event_video_click_by_token(uuid,text,text,text)',
  'public.record_event_video_link_click_by_token(uuid,text,text,text)',
  'public.record_official_video_click_by_token(uuid,text,text,text)'
 ] LOOP
  IF to_regprocedure(name) IS NOT NULL THEN
    RAISE EXCEPTION 'H31 already exists; stop: %',name;
  END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY[
  'public.events','public.matches','public.event_video_clicks',
  'public.event_video_links','public.event_video_link_clicks',
  'public.official_events','public.official_matches','public.official_video_clicks'
 ] LOOP
  IF to_regclass(name) IS NULL THEN
    RAISE EXCEPTION 'H31 prerequisite table missing: %',name;
  END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY[
  'public.record_event_video_click(uuid,text,text)',
  'public.record_event_video_link_click(uuid,text,text)',
  'public.record_official_video_click(uuid,text,text)'
 ] LOOP
  IF to_regprocedure(name) IS NULL THEN
    RAISE EXCEPTION 'H31 legacy RPC missing: %',name;
  END IF;
 END LOOP;
 IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid IN('public.event_video_clicks'::regclass,
     'public.event_video_link_clicks'::regclass,
     'public.official_video_clicks'::regclass) AND NOT relrowsecurity
 ) THEN RAISE EXCEPTION 'H31 click RLS unexpectedly disabled'; END IF;
END
$preflight$;

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
      nullif(left(p_user_agent,500),''),nullif(left(p_referrer,500),''));
END $fn$;
REVOKE ALL ON FUNCTION public.record_event_video_click_by_token(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_video_click_by_token(uuid,text,text,text) TO anon,authenticated;

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
      nullif(left(p_user_agent,500),''),nullif(left(p_referrer,500),''));
END $fn$;
REVOKE ALL ON FUNCTION public.record_event_video_link_click_by_token(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_video_link_click_by_token(uuid,text,text,text) TO anon,authenticated;

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
      nullif(left(p_user_agent,500),''),nullif(left(p_referrer,500),''));
END $fn$;
REVOKE ALL ON FUNCTION public.record_official_video_click_by_token(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_official_video_click_by_token(uuid,text,text,text) TO anon,authenticated;

DO $postflight$
DECLARE name text; p oid;
BEGIN
 FOREACH name IN ARRAY ARRAY[
  'public.record_event_video_click_by_token(uuid,text,text,text)',
  'public.record_event_video_link_click_by_token(uuid,text,text,text)',
  'public.record_official_video_click_by_token(uuid,text,text,text)'
 ] LOOP
  SELECT to_regprocedure(name)::oid INTO p;
  IF p IS NULL OR NOT has_function_privilege('anon',p,'EXECUTE')
    OR NOT has_function_privilege('authenticated',p,'EXECUTE')
    OR NOT (SELECT prosecdef AND proconfig@>ARRAY['search_path=""']::text[] FROM pg_proc WHERE oid=p)
  THEN RAISE EXCEPTION 'H31 token RPC definer/ACL drift: %', name; END IF;
 END LOOP;
END
$postflight$;
COMMIT;
