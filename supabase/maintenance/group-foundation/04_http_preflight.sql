-- Preparation only. Run separately through an authorized READ ONLY connection to each
-- positively identified project. Never execute through a browser/anon client.
-- Catalogs only: no application/Auth rows, keys, migration statements or function bodies.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
WITH relevant_relations AS (
  SELECT c.*, n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','profile_link_private','group_read_private') AND c.relkind IN ('r','p','v','m')
), detailed_relations AS (
  SELECT * FROM relevant_relations WHERE relname IN (
    'clubs','club_members','player_profiles','profiles','events','event_participants',
    'event_team_sides','event_team_matches','official_events','official_matches',
    'join_requests','player_profile_link_requests','player_profile_merges','app_admins','directory_refs',
    'event_fixed_pair_state','event_fixed_pairs','event_fixed_pair_rounds',
    'friendly_round_lineup_state','friendly_match_operations','event_team_attendance','event_team_rounds',
    'profile_media_objects','player_profile_private','profile_media_operations','profile_media_attempts'
  )
), relevant_functions AS (
  SELECT p.*, n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prokind='f' AND (
    n.nspname IN ('profile_link_private','group_read_private') OR
    (n.nspname='public' AND (
      p.proname IN ('is_super_user','can_manage_player_profile_club','can_edit_player_profile_member',
        'can_view_friendly_team_event_by_sides','can_manage_friendly_team_event_by_sides',
        'ensure_my_player_profile','add_provisional_club_member','find_profile_link_account')
      OR p.proname LIKE '%player_profile_link%' OR p.proname LIKE '%profile_join%'
      OR p.proname LIKE '%public_club_claim%' OR p.proname LIKE 'get_club_%'
      OR p.proname IN ('get_public_club_directory','get_my_club_memberships',
        'get_event_club_candidates','get_event_player_names','get_official_player_names',
        'get_shared_event_player_names','get_shared_official_player_names',
        'get_admin_group_member_counts','get_admin_account_names')
    ))
  )
)
SELECT jsonb_build_object(
  'captured_at', transaction_timestamp(),
  'read_only', current_setting('transaction_read_only'),
  'server_version_num', current_setting('server_version_num'),
  'history', (SELECT coalesce(jsonb_agg(jsonb_build_object('version',m.version,'name',to_jsonb(m)->>'name') ORDER BY m.version),'[]') FROM supabase_migrations.schema_migrations m),
  'relations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema',nspname,'name',relname,'kind',relkind,'owner',pg_get_userbyid(relowner),
    'rls',relrowsecurity,'force_rls',relforcerowsecurity,'acl',relacl::text,
    'anon_select',has_table_privilege('anon',oid,'SELECT'),
    'authenticated_select',has_table_privilege('authenticated',oid,'SELECT')
  ) ORDER BY nspname,relname),'[]') FROM relevant_relations),
  'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema',c.nspname,'table',c.relname,'column',a.attname,'position',a.attnum,
    'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'acl',a.attacl::text,
    'identity',a.attidentity,'generated',a.attgenerated,
    'default_md5',(SELECT md5(pg_get_expr(d.adbin,d.adrelid)) FROM pg_attrdef d WHERE d.adrelid=c.oid AND d.adnum=a.attnum),
    'anon_select',has_column_privilege('anon',c.oid,a.attnum,'SELECT'),
    'authenticated_select',has_column_privilege('authenticated',c.oid,a.attnum,'SELECT'),
    'authenticated_update',has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE')
  ) ORDER BY c.nspname,c.relname,a.attnum),'[]') FROM detailed_relations c JOIN pg_attribute a ON a.attrelid=c.oid WHERE a.attnum>0 AND NOT a.attisdropped),
  'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema',c.nspname,'table',c.relname,'name',p.polname,'command',p.polcmd,
    'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY r) FROM unnest(p.polroles) r),
    'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)
  ) ORDER BY c.nspname,c.relname,p.polname),'[]') FROM pg_policy p JOIN detailed_relations c ON c.oid=p.polrelid),
  'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema',c.nspname,'table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid,true)
  ) ORDER BY c.nspname,c.relname,k.conname),'[]') FROM pg_constraint k JOIN detailed_relations c ON c.oid=k.conrelid),
  'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema',c.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,
    'definition',pg_get_triggerdef(t.oid,true)
  ) ORDER BY c.nspname,c.relname,t.tgname),'[]') FROM pg_trigger t JOIN detailed_relations c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal),
  'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema',c.nspname,'table',c.relname,'definition',pg_get_indexdef(i.indexrelid),
    'valid',i.indisvalid,'ready',i.indisready
  ) ORDER BY c.nspname,c.relname,pg_get_indexdef(i.indexrelid)),'[]') FROM pg_index i JOIN detailed_relations c ON c.oid=i.indrelid),
  'functions', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema',nspname,'name',proname,'args',pg_get_function_identity_arguments(oid),
    'result',pg_get_function_result(oid),'owner',pg_get_userbyid(proowner),
    'security_definer',prosecdef,'config',proconfig,'acl',proacl::text,
    'anon_execute',has_function_privilege('anon',oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',oid,'EXECUTE'),
    'definition_md5',md5(pg_get_functiondef(oid))
  ) ORDER BY nspname,proname,pg_get_function_identity_arguments(oid)),'[]') FROM relevant_functions),
  'schema_access', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text,
    'anon_usage',has_schema_privilege('anon',oid,'USAGE'),
    'authenticated_usage',has_schema_privilege('authenticated',oid,'USAGE'),
    'authenticated_create',has_schema_privilege('authenticated',oid,'CREATE')
  ) ORDER BY nspname),'[]') FROM pg_namespace WHERE nspname IN ('public','profile_link_private','group_read_private')),
  'default_acl', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'object_type',d.defaclobjtype,'acl',d.defaclacl::text
  ) ORDER BY pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype),'[]') FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclnamespace=0 OR n.nspname IN ('public','profile_link_private','group_read_private')),
  'roles', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',rolname,'superuser',rolsuper,'bypass_rls',rolbypassrls,'inherit',rolinherit
  ) ORDER BY rolname),'[]') FROM pg_roles WHERE rolname IN ('anon','authenticated','authenticator','postgres','service_role')),
  'role_memberships', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'member',pg_get_userbyid(member),'role',pg_get_userbyid(roleid),'admin_option',admin_option
  ) ORDER BY pg_get_userbyid(member),pg_get_userbyid(roleid)),'[]') FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','authenticator')))
);
ROLLBACK;
