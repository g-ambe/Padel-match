-- Catalog only: no application rows and no production mutations.
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SELECT json_build_object(
 'read_only',current_setting('transaction_read_only'),
 'columns',(SELECT json_agg(t ORDER BY table_name,ordinal_position) FROM (SELECT table_name,column_name,data_type,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('clubs','club_members','player_profiles','profiles','events','event_participants','event_team_sides','event_team_matches','official_events','official_matches','join_requests'))t),
 'policies',(SELECT json_agg(t ORDER BY tablename,policyname) FROM (SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('clubs','club_members','player_profiles','profiles','events','event_participants','event_team_sides','event_team_matches','official_events','official_matches','join_requests'))t),
 'grants',(SELECT json_agg(t ORDER BY table_name,grantee,privilege_type) FROM (SELECT table_name,grantee,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('clubs','club_members','player_profiles','profiles','events','event_participants','event_team_sides','event_team_matches','official_events','official_matches','join_requests'))t),
 'column_grants',(SELECT json_agg(t ORDER BY table_name,column_name,grantee,privilege_type) FROM (SELECT table_name,column_name,grantee,privilege_type FROM information_schema.column_privileges WHERE table_schema='public' AND table_name IN ('club_members','player_profiles','profiles'))t),
 'functions',(SELECT json_agg(t ORDER BY schema,name,args) FROM (SELECT n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND n.nspname IN ('public','profile_link_private') AND (p.proname IN ('is_super_user','club_role','can_manage_player_profile_club','can_edit_player_profile_member','get_shared_event_token','can_view_friendly_team_event_by_sides','can_manage_friendly_team_event_by_sides','preview_profile_join','request_profile_join','preview','check_reference_schema','lock_references','source_snapshot') OR p.proname LIKE '%shared%' OR p.proname LIKE '%player_profile_link%'))t),
 'history',(SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations)
);
ROLLBACK;
