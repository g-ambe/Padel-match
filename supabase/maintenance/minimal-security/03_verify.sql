-- 書込停止中の適用直後に実行。実データの変更をせず、件数・内容・実効権限を確認する。
begin transaction read only;
set local statement_timeout='120s';
do $$ declare r record; actual_hash text; begin
  for r in select * from security_minimal_backup.row_fingerprints loop
    execute format('select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.table_name) into actual_hash;
    if actual_hash is distinct from r.content_hash then raise exception '業務行が変更されています: %',r.table_name; end if;
  end loop;
  if has_column_privilege('anon','public.profiles','email','SELECT') or has_column_privilege('authenticated','public.profiles','email','SELECT')
    or has_column_privilege('anon','public.player_profiles','bio','SELECT') or has_column_privilege('authenticated','public.player_profiles','bio','SELECT')
    or has_column_privilege('authenticated','public.join_requests','consent_snapshot','SELECT')
    or has_column_privilege('anon','public.official_events','share_token','SELECT') then raise exception '非公開情報の列権限を確認してください'; end if;
  if has_table_privilege('authenticated','public.clubs','DELETE') or has_table_privilege('authenticated','public.events','DELETE')
    or has_table_privilege('authenticated','public.rounds','DELETE') or has_table_privilege('authenticated','public.matches','DELETE')
    or has_table_privilege('authenticated','public.player_stats','INSERT,UPDATE,DELETE') then raise exception '物理削除・旧累計の書込権限が残っています'; end if;
  if to_regclass('security_p0_history.operations') is not null then raise exception '旧PRの汎用監査と混在しています'; end if;
end $$;
select tablename,policyname,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname;
select n.nspname,p.oid::regprocedure,p.prosecdef,p.provolatile,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='security_private';
rollback;
