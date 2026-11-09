-- 読み取り専用。結果には個人情報・試合IDを含めない。
BEGIN READ ONLY;
SELECT to_regclass('public.event_team_attendance') IS NOT NULL AS attendance_already_present;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('events','event_team_sides','event_team_matches','event_team_guests') ORDER BY tablename,policyname;
SELECT count(*) AS team_events FROM public.events WHERE event_mode='team';
SELECT count(*) AS team_cards FROM public.event_team_matches;
SELECT profile_link_private.check_reference_schema();
ROLLBACK;
