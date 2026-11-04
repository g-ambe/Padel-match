-- 現行本番のメタデータ確認専用。変更・個人データの取得は行わない。
-- SQL Editorで手動実行し、1行のJSON結果をレビューする。本番への自動実行は禁止。
begin read only;
with targets as (
  select c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in
    ('events','event_participants','rounds','matches','match_players','match_results','clubs','club_members','player_profiles','profiles','app_admins')
)
select jsonb_build_object(
  'captured_at',now(),
  'tables',(select jsonb_agg(jsonb_build_object('table',relname,'rls',relrowsecurity,'force_rls',relforcerowsecurity) order by relname) from targets),
  'columns',(select jsonb_agg(jsonb_build_object('table',t.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by t.relname,a.attnum)
    from targets t join pg_attribute a on a.attrelid=t.oid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attnum>0 and not a.attisdropped),
  'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public' and tablename in(select relname from targets)),
  'table_acl',(select jsonb_agg(jsonb_build_object('table',t.relname,'role',case when x.grantee=0 then 'PUBLIC' else x.grantee::regrole::text end,'privilege',x.privilege_type,'grantable',x.is_grantable) order by t.relname,x.grantee,x.privilege_type)
    from targets t cross join lateral aclexplode(t.relacl) x),
  'column_acl',(select coalesce(jsonb_agg(jsonb_build_object('table',t.relname,'column',a.attname,'role',case when x.grantee=0 then 'PUBLIC' else x.grantee::regrole::text end,'privilege',x.privilege_type) order by t.relname,a.attname,x.grantee,x.privilege_type),'[]'::jsonb)
    from targets t join pg_attribute a on a.attrelid=t.oid cross join lateral aclexplode(a.attacl) x where a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_object('table',t.relname,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) order by t.relname,c.conname) from targets t join pg_constraint c on c.conrelid=t.oid),
  'indexes',(select jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) order by tablename,indexname) from pg_indexes where schemaname='public' and tablename in(select relname from targets)),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',t.relname,'name',g.tgname,'enabled',g.tgenabled,'definition',pg_get_triggerdef(g.oid),'function',pg_get_functiondef(g.tgfoid)) order by t.relname,g.tgname),'[]'::jsonb) from targets t join pg_trigger g on g.tgrelid=t.oid where not g.tgisinternal),
  'permission_helpers',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',p.proowner::regrole::text,'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl,'definition',pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('is_super_user','can_manage_friendly_team_event_by_sides','can_view_friendly_team_event_by_sides')),
  'new_schema_present',to_regnamespace('fixed_pair_private') is not null
) as fixed_pair_preflight;
rollback;
