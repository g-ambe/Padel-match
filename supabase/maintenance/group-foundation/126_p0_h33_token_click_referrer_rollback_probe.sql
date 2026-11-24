-- TASK-08 H33: Referrer URL minimization on installed token-bound click RPCs; Stage-only ROLLBACK.
-- Existing function definitions remain in place; only synthetic event and click
-- rows are created inside a transaction and fully rolled back. Never use Prod.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';
DO $guard$
BEGIN
 IF current_user<>'postgres'
 OR to_regnamespace('security_private') IS NULL
 OR to_regnamespace('fixed_pair_private') IS NOT NULL
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.official_events)<>0
 OR (SELECT count(*) FROM public.event_video_clicks)<>0
 OR (SELECT count(*) FROM public.event_video_link_clicks)<>0
 OR (SELECT count(*) FROM public.official_video_clicks)<>0
 OR to_regprocedure('public.record_event_video_click_by_token(uuid,text,text,text)') IS NULL
 OR to_regprocedure('public.record_event_video_link_click_by_token(uuid,text,text,text)') IS NULL
 OR to_regprocedure('public.record_official_video_click_by_token(uuid,text,text,text)') IS NULL
 THEN RAISE EXCEPTION 'H33 installed RPC rollback preflight failed'; END IF;
END
$guard$;

DO $fixture$
DECLARE v_club uuid;v_actor uuid;v_event uuid;v_official uuid;v_opponent uuid;
        v_match uuid;v_link uuid;v_om uuid;
BEGIN
  SELECT id INTO STRICT v_club FROM public.clubs
   WHERE name='TASK08-P0-20261119-A' AND is_active AND NOT coalesce(is_deleted,false);
  SELECT id INTO STRICT v_actor FROM auth.users
   WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
  INSERT INTO public.events(club_id,name,category,court_count,status,closed_at,
    share_enabled,share_token,event_mode,created_by_auth_user_id)
  VALUES(v_club,'TASK08-H30-CLICK-ROLLBACK','club',1,'closed',now(),
    true,'TASK08H30CLICKFRIENDLY','manual',v_actor) RETURNING id INTO v_event;
  INSERT INTO public.matches(event_id,court_number,completed,youtube_url)
  VALUES(v_event,1,true,'https://youtu.be/TASK08H30') RETURNING id INTO v_match;
  INSERT INTO public.event_video_links(event_id,title,video_url)
  VALUES(v_event,'TASK08-H30','https://youtu.be/TASK08H30') RETURNING id INTO v_link;
  INSERT INTO public.official_events(club_id,title,event_date,status,
    share_enabled,share_token,created_by_auth_user_id)
  VALUES(v_club,'TASK08-H30-OFFICIAL-ROLLBACK',CURRENT_DATE,'closed',
    true,'TASK08H30CLICKOFFICIAL',v_actor) RETURNING id INTO v_official;
  INSERT INTO public.official_opponents(official_event_id,opponent_team_name)
  VALUES(v_official,'TASK08-H30-OPPONENT') RETURNING id INTO v_opponent;
  INSERT INTO public.official_matches(official_event_id,official_opponent_id,match_order,
    our_score,opponent_score,result,youtube_url)
  VALUES(v_official,v_opponent,1,4,2,'win','https://youtu.be/TASK08H30')
  RETURNING id INTO v_om;
  PERFORM set_config('task08_h30.match',v_match::text,true);
  PERFORM set_config('task08_h30.link',v_link::text,true);
  PERFORM set_config('task08_h30.official_match',v_om::text,true);
  PERFORM set_config('task08_h30.event',v_event::text,true);
  PERFORM set_config('task08_h30.official',v_official::text,true);
END
$fixture$;

SET LOCAL ROLE anon;
-- The untrusted caller must not be able to write using a wrong or other-kind token.
SELECT public.record_event_video_click_by_token(
  current_setting('task08_h30.match')::uuid,'TASK08H30CLICKOFFICIAL');
SELECT public.record_event_video_link_click_by_token(
  current_setting('task08_h30.link')::uuid,'TASK08H30CLICKOFFICIAL');
SELECT public.record_official_video_click_by_token(
  current_setting('task08_h30.official_match')::uuid,'TASK08H30CLICKFRIENDLY');
SELECT public.record_event_video_click_by_token(
  current_setting('task08_h30.match')::uuid,'');
SELECT public.record_event_video_link_click_by_token(
  current_setting('task08_h30.link')::uuid,NULL);
SELECT public.record_official_video_click_by_token(
  current_setting('task08_h30.official_match')::uuid,'H30BAD');
RESET ROLE;

SELECT set_config('task08_h30.invalid_denied',(
 (SELECT count(*) FROM public.event_video_clicks)=0
 AND (SELECT count(*) FROM public.event_video_link_clicks)=0
 AND (SELECT count(*) FROM public.official_video_clicks)=0
)::text,true);

SET LOCAL ROLE anon;
-- Matching synthetic share token permits exactly one click per designated item.
SELECT public.record_event_video_click_by_token(
  current_setting('task08_h30.match')::uuid,'TASK08H30CLICKFRIENDLY','test agent','https://staging.example/share/events/TASK08H30CLICKFRIENDLY');
SELECT public.record_event_video_link_click_by_token(
  current_setting('task08_h30.link')::uuid,'TASK08H30CLICKFRIENDLY','test agent','https://staging.example/share/events/TASK08H30CLICKFRIENDLY');
SELECT public.record_official_video_click_by_token(
  current_setting('task08_h30.official_match')::uuid,'TASK08H30CLICKOFFICIAL','test agent','https://staging.example/share/events/TASK08H30CLICKFRIENDLY');
RESET ROLE;

SELECT set_config('task08_h30.valid_recorded',(
 (SELECT count(*) FROM public.event_video_clicks)=1
 AND (SELECT count(*) FROM public.event_video_link_clicks)=1
 AND (SELECT count(*) FROM public.official_video_clicks)=1
 AND NOT EXISTS(SELECT 1 FROM public.event_video_clicks
   WHERE user_agent IS DISTINCT FROM 'test agent' OR referrer IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.event_video_link_clicks
   WHERE user_agent IS DISTINCT FROM 'test agent' OR referrer IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.official_video_clicks
   WHERE user_agent IS DISTINCT FROM 'test agent' OR referrer IS NOT NULL)
)::text,true);

-- Once the share is revoked, the old token must not produce additional clicks.
UPDATE public.events SET share_enabled=false WHERE id=current_setting('task08_h30.event')::uuid;
UPDATE public.official_events SET share_enabled=false WHERE id=current_setting('task08_h30.official')::uuid;
SET LOCAL ROLE anon;
SELECT public.record_event_video_click_by_token(
  current_setting('task08_h30.match')::uuid,'TASK08H30CLICKFRIENDLY');
SELECT public.record_event_video_link_click_by_token(
  current_setting('task08_h30.link')::uuid,'TASK08H30CLICKFRIENDLY');
SELECT public.record_official_video_click_by_token(
  current_setting('task08_h30.official_match')::uuid,'TASK08H30CLICKOFFICIAL');
RESET ROLE;

SELECT jsonb_build_object(
 'rollback_only',true,
 'invalid_and_cross_kind_tokens_denied',current_setting('task08_h30.invalid_denied')::boolean,
 'valid_tokens_record_one_each',current_setting('task08_h30.valid_recorded')::boolean,
 'after_disabling_share_no_extra_clicks',
   (SELECT count(*) FROM public.event_video_clicks)=1
   AND (SELECT count(*) FROM public.event_video_link_clicks)=1
   AND (SELECT count(*) FROM public.official_video_clicks)=1,
 'anon_can_execute_new_click_rpcs',
   has_function_privilege('anon','public.record_event_video_click_by_token(uuid,text,text,text)','EXECUTE')
   AND has_function_privilege('anon','public.record_event_video_link_click_by_token(uuid,text,text,text)','EXECUTE')
   AND has_function_privilege('anon','public.record_official_video_click_by_token(uuid,text,text,text)','EXECUTE'),
 'legacy_rpcs_untouched',
   to_regprocedure('public.record_event_video_click(uuid,text,text)') IS NOT NULL
   AND to_regprocedure('public.record_event_video_link_click(uuid,text,text)') IS NOT NULL
   AND to_regprocedure('public.record_official_video_click(uuid,text,text)') IS NOT NULL
) AS h31_report;

-- ROLLBACK is mandatory. The new token-bound RPCs, click rows, and events vanish.
ROLLBACK;
