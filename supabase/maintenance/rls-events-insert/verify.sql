BEGIN READ ONLY;
SELECT policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename='events' ORDER BY policyname;
SELECT rolname,has_table_privilege(rolname,'public.events','SELECT') sel,
has_table_privilege(rolname,'public.events','INSERT') ins,
has_table_privilege(rolname,'public.events','UPDATE') upd,
has_table_privilege(rolname,'public.events','DELETE') del
FROM pg_roles WHERE rolname IN ('anon','authenticated');
COMMIT;
