BEGIN READ ONLY;
SELECT policyname,permissive,roles::text,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' AND tablename='clubs' ORDER BY policyname;
SELECT n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE (n.nspname='shared_read_private' AND p.proname='official_club_name')
 OR (n.nspname='public' AND p.proname='get_shared_official_club_name');
SELECT r.rolname,has_table_privilege(r.rolname,'public.clubs','SELECT') AS table_select_grant
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated');
COMMIT;
