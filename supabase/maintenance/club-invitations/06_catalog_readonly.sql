-- TASK-08-02 catalog only. Read-only access must be separately authorized.
-- Do not use on an unapproved hosted target. No business rows, key values or secret names.
-- Expected 2026-11-27 production fingerprint: cb7dd9058615a43fe0efa1f2378254fb (56 entries, missing 0).
BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog;
WITH target_relations AS (
 SELECT unnest(ARRAY['public.app_admins','public.clubs','public.club_members','public.events','public.event_participants','public.event_team_matches','public.event_team_sides','public.join_requests','public.match_players','public.matches','public.match_results','public.official_events','public.official_matches','public.official_opponents','public.player_profile_link_requests','public.player_profile_merges','public.player_profile_private','public.player_profiles','public.profile_media_objects','public.profile_media_operations','public.profiles','public.notifications','profile_link_private.merge_changes','profile_link_private.account_lookups','auth.users','vault.decrypted_secrets']) AS object_name
), rel AS (
 SELECT tr.object_name,c.oid,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions FROM target_relations tr LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass(tr.object_name)
), fingerprints AS (
 SELECT 'relation' AS kind,r.object_name,CASE WHEN r.oid IS NULL THEN NULL ELSE md5(jsonb_build_object(
 'kind',r.relkind,'owner',pg_get_userbyid(r.relowner),'acl',r.relacl,'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,'options',r.reloptions,
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attacl,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(c.conname,pg_get_constraintdef(c.oid),c.convalidated) ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid=r.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(ic.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready) ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=r.oid),
 'policies',(SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=r.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid),md5(pg_get_functiondef(t.tgfoid))) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),
 'view',CASE WHEN r.relkind IN ('v','m') THEN pg_get_viewdef(r.oid) ELSE NULL END)::text) END AS fingerprint FROM rel r
 UNION ALL
 SELECT 'function',n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',md5(jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),has_function_privilege('service_role',p.oid,'EXECUTE'))::text)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND (n.nspname='profile_link_private' OR (n.nspname='public' AND p.proname IN ('add_provisional_club_member','find_profile_link_account','request_player_profile_link','review_player_profile_link_named','review_player_profile_link','get_player_profile_link_request','submit_profile_join_request','submit_profile_join_request_named','review_profile_join_request','ensure_my_player_profile','can_manage_player_profile_club','can_edit_player_profile_member')) OR (n.nspname='auth' AND p.proname='uid'))
 UNION ALL
 SELECT 'foreign_keys','public.player_profiles',md5(coalesce(jsonb_agg(jsonb_build_array(c.conrelid::regclass::text,c.conname,pg_get_constraintdef(c.oid),c.convalidated) ORDER BY c.conrelid::regclass::text,c.conname)::text,'[]')) FROM pg_constraint c WHERE c.contype='f' AND c.confrelid=to_regclass('public.player_profiles')
)
SELECT jsonb_build_object('read_only',current_setting('transaction_read_only'),'count',count(*),'missing',count(*) FILTER(WHERE fingerprint IS NULL),'fingerprint',md5(jsonb_agg(jsonb_build_array(kind,object_name,fingerprint) ORDER BY kind,object_name)::text),'objects',jsonb_agg(jsonb_build_array(kind,object_name,fingerprint) ORDER BY kind,object_name)) AS metadata FROM fingerprints;
ROLLBACK;
