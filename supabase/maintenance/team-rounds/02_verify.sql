BEGIN READ ONLY;
SELECT profile_link_private.check_reference_schema();
SELECT relrowsecurity AND NOT has_table_privilege('authenticated','public.event_team_rounds','INSERT')
 AND NOT has_table_privilege('authenticated','public.event_team_rounds','UPDATE')
 AND NOT has_table_privilege('authenticated','public.event_team_rounds','DELETE') AS rounds_write_rpc_only
 FROM pg_class WHERE oid='public.event_team_rounds'::regclass;
SELECT p.oid::regprocedure AS function,p.prosecdef,p.proconfig,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_should_be_false
 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('get_friendly_team_round_context','create_friendly_team_round','update_friendly_team_round_card','delete_friendly_team_round_card');
SELECT team_rounds_private.check_round(id) FROM public.event_team_rounds;
SELECT count(*) AS generated_cards FROM public.event_team_matches WHERE round_id IS NOT NULL;
SELECT count(*) AS generated_rounds FROM public.event_team_rounds;
SELECT tgname,tgenabled,pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.event_team_matches'::regclass AND NOT tgisinternal;
ROLLBACK;
