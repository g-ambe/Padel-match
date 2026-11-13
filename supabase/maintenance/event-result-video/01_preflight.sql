-- 読み取り専用。接続先の検証は既存cloud_connection_probe.pyでも実施する。
DO $preflight$ BEGIN
 IF to_regprocedure('public.save_friendly_team_match_video(uuid,uuid,text,text)') IS NOT NULL
 OR to_regclass('public.event_team_attendance') IS NULL
 OR to_regclass('public.event_team_rounds') IS NULL
 OR to_regprocedure('public.can_manage_friendly_team_event_by_sides(uuid,uuid)') IS NULL
 OR to_regprocedure('public.can_view_friendly_team_event_by_sides(uuid,uuid)') IS NULL
 OR to_regprocedure('public.create_friendly_team_round(uuid,uuid,text,text,integer,jsonb)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_preferences' AND column_name='tutorial_status')
 THEN RAISE EXCEPTION '0047_prerequisite_or_already_applied'; END IF;
 PERFORM profile_link_private.check_reference_schema();
END $preflight$;
