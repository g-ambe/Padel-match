-- 任意の読み取り確認用。DDL・DML・権限変更は含まない。
-- この作業では本番に自動実行しない。既存の管理用接続、またはSQL Editorでの確認用。
select
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  has_column_privilege('anon', 'public.events', 'court_count', 'UPDATE') as anon_can_update_court_column,
  has_column_privilege('authenticated', 'public.events', 'court_count', 'UPDATE') as authenticated_can_update_court_column,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public' and c.relname = 'events'
order by p.policyname;
