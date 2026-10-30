BEGIN READ ONLY;
SELECT policyname,permissive,roles::text,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' AND tablename='clubs' ORDER BY policyname;
SELECT rolname, has_table_privilege(rolname,'public.clubs','DELETE') AS table_delete_grant
FROM pg_roles WHERE rolname IN ('anon','authenticated');
COMMIT;
