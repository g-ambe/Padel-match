-- TASK-08 P0. Metadata-only inspection of legacy linking and row/column access.
-- Run separately on positively identified Supabase projects with authorized admin read-only access.
-- No application/Auth rows, function bodies, RLS expressions, or credentials are returned.
-- Keyword flags are textual indicators, NOT proof of secure behavior.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
WITH candidates AS (
  SELECT n.nspname AS schema_name,p.proname AS function_name,
         pg_get_function_identity_arguments(p.oid) AS arguments,
         pg_get_userbyid(p.proowner) AS owner_name,
         p.prosecdef AS security_definer,
         p.proconfig::text AS function_settings,
         has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
         has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
         md5(pg_get_functiondef(p.oid)) AS definition_md5,
         lower(pg_get_functiondef(p.oid)) AS internal_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='public' AND p.proname IN
    ('get_player_profile_link_request','preview_profile_join','submit_profile_join_request',
     'request_player_profile_link','review_player_profile_link'))
   OR (n.nspname='profile_link_private' AND p.proname IN ('preview','scoped_preview'))
), flags AS (
  SELECT schema_name,function_name,arguments,owner_name,security_definer,function_settings,
    anon_execute,authenticated_execute,definition_md5,
    strpos(internal_def,'to_jsonb(request)')>0 AS entire_request_json,
    strpos(internal_def,'profile_link_private.preview')>0 AS mentions_full_preview,
    strpos(internal_def,'profile_link_private.scoped_preview')>0 AS mentions_scoped_preview,
    strpos(internal_def,'can_manage_player_profile_club')>0 AS mentions_manager_check,
    strpos(internal_def,'auth.uid()')>0 AS mentions_auth_uid,
    strpos(internal_def,'source_club_member_id')>0 AS mentions_source_member,
    strpos(internal_def,'review_token')>0 AS mentions_review_token
  FROM candidates
), policies AS (
  SELECT p.tablename,p.policyname,p.cmd,p.permissive,p.roles::text AS roles,
    md5(coalesce(p.qual,'')) AS using_md5,
    md5(coalesce(p.with_check,'')) AS with_check_md5,
    trim(coalesce(p.qual,'')) IN ('true','(true)') AS unconditional_using,
    strpos(coalesce(p.qual,''),'auth.uid')>0 AS mentions_uid,
    strpos(coalesce(p.qual,''),'can_manage_player_profile_club')>0 AS mentions_manager
  FROM pg_policies p WHERE p.schemaname='public'
    AND p.tablename IN('clubs','club_members','player_profiles','profiles',
      'events','join_requests','player_profile_link_requests')
)
SELECT jsonb_build_object(
  'captured_at',transaction_timestamp(),
  'read_only',current_setting('transaction_read_only'),
  'functions',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.schema_name,f.function_name,f.arguments),'[]'::jsonb) FROM flags f),
  'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname),'[]'::jsonb) FROM policies p),
  'access',jsonb_build_object(
    'club_members_anon_select',has_table_privilege('anon','public.club_members','SELECT'),
    'club_members_authenticated_select',has_table_privilege('authenticated','public.club_members','SELECT'),
    'player_profiles_anon_select',has_table_privilege('anon','public.player_profiles','SELECT'),
    'player_profiles_authenticated_select',has_table_privilege('authenticated','public.player_profiles','SELECT'),
    'profiles_anon_display_name',has_column_privilege('anon','public.profiles','display_name','SELECT'),
    'profiles_anon_email',has_column_privilege('anon','public.profiles','email','SELECT')),
  'group_read_schema_exists',(to_regnamespace('group_read_private') IS NOT NULL),
  'club_member_insert_policy_count',(SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename='club_members' AND p.cmd IN ('INSERT','ALL'))
) AS summary;
ROLLBACK;
