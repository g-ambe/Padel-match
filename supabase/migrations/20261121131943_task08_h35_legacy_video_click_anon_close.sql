-- TASK-08 H35: retire anonymous execution of legacy video click RPCs.
-- Keep the functions for authenticated callers until a separate compatibility decision.
-- Apply to production only in coordination with the deployed token-bound share UI.
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'postgres'
     OR to_regprocedure('public.record_event_video_click(uuid,text,text)') IS NULL
     OR to_regprocedure('public.record_event_video_link_click(uuid,text,text)') IS NULL
     OR to_regprocedure('public.record_official_video_click(uuid,text,text)') IS NULL
     OR to_regprocedure('public.record_event_video_click_by_token(uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.record_event_video_link_click_by_token(uuid,text,text,text)') IS NULL
     OR to_regprocedure('public.record_official_video_click_by_token(uuid,text,text,text)') IS NULL
  THEN
    RAISE EXCEPTION 'TASK08-H35: required click RPCs/privileged role missing';
  END IF;
END $guard$;

REVOKE EXECUTE ON FUNCTION public.record_event_video_click(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_event_video_link_click(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_official_video_click(uuid,text,text) FROM PUBLIC, anon;

-- Preserve the existing authenticated legacy caller surface.
GRANT EXECUTE ON FUNCTION public.record_event_video_click(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_video_link_click(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_official_video_click(uuid,text,text) TO authenticated;

DO $verify$
BEGIN
  IF has_function_privilege('anon','public.record_event_video_click(uuid,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.record_event_video_link_click(uuid,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.record_official_video_click(uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.record_event_video_click(uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.record_event_video_link_click(uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.record_official_video_click(uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('anon','public.record_event_video_click_by_token(uuid,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('anon','public.record_event_video_link_click_by_token(uuid,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('anon','public.record_official_video_click_by_token(uuid,text,text,text)','EXECUTE')
  THEN
    RAISE EXCEPTION 'TASK08-H35: post-revoke privileges invalid';
  END IF;
END $verify$;
COMMIT;