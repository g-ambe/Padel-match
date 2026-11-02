-- Read-only snapshot: save immediately before and after apply/rollback.
BEGIN READ ONLY;
SELECT jsonb_build_object(
 'row_count', (SELECT count(*) FROM public.events),
 'rls_enabled', (SELECT relrowsecurity FROM pg_class WHERE oid='public.events'::regclass),
 'policies', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY policyname),'[]'::jsonb)
   FROM pg_policies p WHERE schemaname='public' AND tablename='events'),
 'direct_acl', (SELECT jsonb_agg(jsonb_build_object('grantor',grantor::regrole::text,
   'grantee',CASE WHEN grantee=0 THEN 'PUBLIC' ELSE grantee::regrole::text END,
   'privilege',privilege_type,'grantable',is_grantable) ORDER BY grantee,privilege_type)
   FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl)
   WHERE c.oid='public.events'::regclass),
 'effective_privileges', (SELECT jsonb_agg(jsonb_build_object('role',r,'privilege',p,
   'allowed',has_table_privilege(r,'public.events',p)) ORDER BY r,p)
   FROM unnest(ARRAY['anon','authenticated','service_role']) AS roles(r)
   CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS privileges(p)),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('def',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'function_hash',md5(replace(pg_get_functiondef(p.oid),chr(13),''))) ORDER BY t.tgname) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.events'::regclass AND NOT t.tgisinternal),
 'columns',(SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='events'),
 'linking_functions', (SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
   'owner',p.proowner::regrole::text,'security_definer',p.prosecdef,
   'owner_bypassrls',r.rolbypassrls,'definition_hash',md5(pg_get_functiondef(p.oid))) ORDER BY p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
   WHERE n.nspname='profile_link_private' AND p.proname='merge_profiles'),
 'other_public_policies_hash', (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname)::text,''))
   FROM pg_policies p WHERE schemaname='public' AND tablename<>'events'),
 'other_public_acl_hash', (SELECT md5(coalesce(jsonb_agg(jsonb_build_object('table',c.relname,
   'acl',c.relacl::text) ORDER BY c.relname)::text,''))
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND c.relname<>'events')
) AS evidence;
COMMIT;
