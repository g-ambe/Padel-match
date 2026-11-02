BEGIN READ ONLY;
SELECT pg_get_functiondef('events_operation_private.guard_member_fields()'::regprocedure) AS member_field_guard;
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger WHERE tgrelid='public.events'::regclass AND NOT tgisinternal ORDER BY tgname;
SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='events' ORDER BY policyname;
SELECT relrowsecurity,relacl FROM pg_class WHERE oid='public.events'::regclass;
SELECT proowner::regrole,prosecdef,proacl,proconfig FROM pg_proc
WHERE oid='events_operation_private.guard_member_fields()'::regprocedure;
COMMIT;
