-- Read only. Run before, immediately after, and after any rollback.
BEGIN READ ONLY;
SELECT current_database(), current_user, now();
SELECT policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' AND tablename='clubs' ORDER BY policyname;
SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c WHERE c.oid='public.clubs'::regclass;
SELECT r.rolname, has_table_privilege(r.rolname,'public.clubs','SELECT') AS sel,
 has_table_privilege(r.rolname,'public.clubs','INSERT') AS ins,
 has_table_privilege(r.rolname,'public.clubs','UPDATE') AS upd,
 has_table_privilege(r.rolname,'public.clubs','DELETE') AS del
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated');
SELECT t.tgname,pg_get_triggerdef(t.oid) FROM pg_trigger t
WHERE t.tgrelid='public.clubs'::regclass AND NOT t.tgisinternal;
COMMIT;
