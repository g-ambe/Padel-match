-- 適用直後、書き込み停止中に管理者が実行する。業務データの変更なし。
begin transaction read only;
set local statement_timeout = '120s';
set local row_security = off;
do $$
begin
  if exists (select 1 from pg_policies where schemaname='public'
    and tablename in ('clubs','events','event_participants','rounds','matches','match_players','match_results','player_stats')
    and policyname like 'dev_all_%') then
    raise exception '対象のdev_allポリシーが残っています';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and (has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE')
        or has_table_privilege('anon',c.oid,'DELETE') or has_any_column_privilege('anon',c.oid,'INSERT')
        or has_any_column_privilege('anon',c.oid,'UPDATE'))) then
    raise exception '匿名の実効テーブル/列書き込み権限が残っています';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and policyname in
    ('official_events_access','official_matches_access','official_opponents_access')) then
    raise exception '適用済みの公式戦緊急修正が再現されていません';
  end if;
  if to_regprocedure('public.get_shared_event(text)') is null then
    raise exception '共有RPCがありません。共有画面を公開する前にSQLを適用してください';
  end if;
  if exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attname='profile_id'
    where c.conrelid='public.player_stats'::regclass and c.contype='f' and a.attnum=any(c.conkey))
    or (select count(*) from pg_trigger where tgname='security_p0_stats_identity_delete'
      and tgrelid in ('public.profiles'::regclass,'public.player_profiles'::regclass) and tgenabled<>'D')<>2 then
    raise exception '戦績IDの両形式対応または親ID削除時の保護が不完全です';
  end if;
end $$;

select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in
  ('clubs','events','event_participants','rounds','matches','match_players','match_results','player_stats','event_team_sides')
order by tablename,policyname;
select n.nspname,p.oid::regprocedure as signature,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='security_private' or (n.nspname='public' and p.proname='get_shared_event')
order by n.nspname,p.oid::regprocedure::text;
select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where t.tgname like 'security_p0_%' order by c.relname,t.tgname;

-- 1行でも出たらデータが変更されている。アプリ再開前に原因を調べる。
-- 検証用の行を本番へ作成しない。バックアップ後の正規操作も差分として検出される。
do $$ declare r record; total bigint; fingerprint text; begin
  for r in select * from security_p0_backup_20261026.row_fingerprints order by table_name loop
    execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.table_name)
      into total,fingerprint;
    if total is distinct from r.row_count or fingerprint is distinct from r.content_hash then
      raise exception '業務データの差分を検出しました: public.%',r.table_name;
    end if;
  end loop;
end $$;
commit;

-- 匿名読取の確認。共有URLのトークンはテーブルSELECTから取得できない。
begin transaction read only;
set local role anon;
do $$ declare table_name text; total bigint; begin
  foreach table_name in array array['events','event_participants','rounds','matches','match_players','match_results','player_stats'] loop
    begin
      execute format('select count(*) from public.%I',table_name) into total;
      if total<>0 then raise exception '匿名から%.%行を直接参照できます',table_name,total; end if;
      raise notice '%: 匿名の可視行は0件です',table_name;
    exception when insufficient_privilege then
      raise notice '%: 匿名のSELECT権限がありません（拒否）',table_name;
    end;
  end loop;
end $$;
select public.get_shared_event('invalid-token-for-security-verification') is null as invalid_share_rejected;
rollback;
