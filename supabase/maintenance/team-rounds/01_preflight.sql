-- 本番では承認後・読み取り専用接続で実行。個人情報・実スコア・試合IDは出力しない。
BEGIN READ ONLY;
SELECT current_setting('server_version') AS postgres_version,
 to_regclass('public.event_team_attendance') IS NOT NULL AS attendance_0044_present,
 to_regclass('public.event_team_rounds') IS NULL AS migration_0045_not_applied;
SELECT profile_link_private.check_reference_schema();
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('events','event_team_matches','event_team_sides','event_team_guests','event_team_attendance','club_members','player_profiles') ORDER BY c.relname;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('events','event_team_matches','event_team_sides','event_team_guests','event_team_attendance') ORDER BY tablename,policyname;
SELECT tgname,tgenabled,pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid IN ('public.event_team_matches'::regclass,'public.event_team_sides'::regclass) AND NOT tgisinternal;
SELECT count(*) AS team_cards FROM public.event_team_matches;
SELECT p.oid::regprocedure AS function,p.prosecdef,p.proconfig,p.proacl,md5(pg_get_functiondef(p.oid)) AS definition_hash
 FROM pg_proc p WHERE p.oid IN ('public.set_friendly_team_attendance(uuid,text,uuid,uuid,text)'::regprocedure,'public.can_manage_friendly_team_event_by_sides(uuid,uuid)'::regprocedure,'public.can_view_friendly_team_event_by_sides(uuid,uuid)'::regprocedure);
ROLLBACK;
