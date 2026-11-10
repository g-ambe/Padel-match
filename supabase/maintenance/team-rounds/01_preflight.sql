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
SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND c.relname IN ('events','event_team_matches','event_team_sides','event_team_guests','event_team_attendance','club_members','player_profiles') ORDER BY c.relname,a.attnum;
SELECT conrelid::regclass AS table_name,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
 WHERE conrelid IN ('public.events'::regclass,'public.event_team_matches'::regclass,'public.event_team_sides'::regclass,'public.event_team_guests'::regclass,'public.event_team_attendance'::regclass,'public.club_members'::regclass,'public.player_profiles'::regclass) ORDER BY conrelid::regclass::text,conname;
SELECT count(*) AS team_cards FROM public.event_team_matches;
SELECT p.oid::regprocedure AS function,p.prosecdef,p.proconfig,p.proacl,md5(pg_get_functiondef(p.oid)) AS definition_hash
 FROM pg_proc p WHERE p.oid IN ('public.set_friendly_team_attendance(uuid,text,uuid,uuid,text)'::regprocedure,'public.can_manage_friendly_team_event_by_sides(uuid,uuid)'::regprocedure,'public.can_view_friendly_team_event_by_sides(uuid,uuid)'::regprocedure);
ROLLBACK;
