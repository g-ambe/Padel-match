-- TASK-08 H09/H10: read-only, same-SQL ACL baseline for staging and production.
-- Only schema, column grants and hashes of RLS predicates are returned.
-- Table-level UPDATE=false does not imply column-level UPDATE=false.
-- Do not broaden table SELECT/UPDATE to fix RETURNING without a scoped design.
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
WITH roles AS (
 SELECT 'anon'::text AS role_name UNION ALL SELECT 'authenticated'
), targets AS (
 SELECT 'club_members'::text AS name UNION ALL SELECT 'player_profiles'
)
SELECT jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),
 'policies',(
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'table',tablename,'policy',policyname,'command',cmd,'roles',roles,
   'using_md5',md5(coalesce(qual,'')),'check_md5',md5(coalesce(with_check,'')))
   ORDER BY tablename,policyname),'[]'::jsonb)
  FROM pg_policies WHERE schemaname='public' AND tablename IN('club_members','player_profiles')
 ),
 'table_acl',(
  SELECT jsonb_agg(jsonb_build_object(
   'table',t.name,'role',r.role_name,
   'select',has_table_privilege(r.role_name,'public.'||t.name,'SELECT'),
   'update',has_table_privilege(r.role_name,'public.'||t.name,'UPDATE'))
  ORDER BY t.name,r.role_name)
  FROM targets t CROSS JOIN roles r
 ),
 'column_acl',(
  SELECT jsonb_agg(jsonb_build_object(
   'table',c.relname,'column',a.attname,
   'auth_select',has_column_privilege('authenticated',c.oid,a.attnum,'SELECT'),
   'auth_update',has_column_privilege('authenticated',c.oid,a.attnum,'UPDATE'),
   'anon_select',has_column_privilege('anon',c.oid,a.attnum,'SELECT'))
  ORDER BY c.relname,a.attnum)
  FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0
   AND NOT a.attisdropped WHERE c.relnamespace='public'::regnamespace
     AND c.relname IN('club_members','player_profiles')
 )
) AS report;
ROLLBACK;
