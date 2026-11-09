BEGIN READ ONLY;
SELECT to_regclass('public.event_team_attendance') IS NOT NULL AS attendance_present;
SELECT profile_link_private.check_reference_schema();
SELECT has_table_privilege('authenticated','public.event_team_attendance','SELECT') AS can_read,
 has_table_privilege('authenticated','public.event_team_attendance','INSERT') AS cannot_insert_should_be_false,
 has_table_privilege('authenticated','public.event_team_attendance','UPDATE') AS cannot_update_should_be_false,
 has_function_privilege('anon','public.set_friendly_team_attendance(uuid,text,uuid,uuid,text)','EXECUTE') AS anon_cannot_execute_should_be_false;
SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid IN ('public.event_team_matches'::regclass,'public.event_team_sides'::regclass) AND NOT tgisinternal;
SELECT count(*) AS attendance_rows FROM public.event_team_attendance;
SELECT count(*) AS team_cards FROM public.event_team_matches;
ROLLBACK;
