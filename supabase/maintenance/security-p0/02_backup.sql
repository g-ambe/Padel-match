-- 適用直前に書き込みを止め、管理者が手動実行する。業務データは読むだけ。
-- 同名schemaがあれば中止する。再適用時も最初のバックアップを上書きしない。
-- 業務データの復元には別途SupabaseのDBバックアップ/PITRを確保する。
begin isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local row_security = off;
create schema security_p0_backup_20261026;
revoke all on schema security_p0_backup_20261026 from public,anon,authenticated;
create table security_p0_backup_20261026.manifest as
select now() as captured_at,current_database() as database_name,current_user as captured_by;
create table security_p0_backup_20261026.relations as
select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl,c.relowner
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p');
create table security_p0_backup_20261026.columns as
select n.nspname,c.relname,a.attname,a.attacl,format_type(a.atttypid,a.atttypmod) as data_type
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped;
create table security_p0_backup_20261026.policies as
select * from pg_policies where schemaname='public';
-- 両ID形式の検証へ置換する前のアカウント用FKを記録する。
create table security_p0_backup_20261026.stats_identity_constraints as
select c.conname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attname='profile_id'
where c.conrelid='public.player_stats'::regclass and c.contype='f' and a.attnum=any(c.conkey);
create table security_p0_backup_20261026.functions as
select n.nspname,p.oid::regprocedure::text as signature,p.proacl,p.proowner,
  pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','profile_link_private') and p.prokind in ('f','p');
create table security_p0_backup_20261026.triggers as
select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal;
-- 行内容の照合用ハッシュ。公開テーブルの行をバックアップschemaへコピーしない。
create table security_p0_backup_20261026.row_fingerprints(
  table_name text primary key,row_count bigint,content_hash text
);
do $$ declare r record; total bigint; fingerprint text; begin
  for r in select relname from security_p0_backup_20261026.relations order by relname loop
    execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.relname)
      into total,fingerprint;
    insert into security_p0_backup_20261026.row_fingerprints values(r.relname,total,fingerprint);
  end loop;
end $$;
revoke all on all tables in schema security_p0_backup_20261026 from public,anon,authenticated;
select * from security_p0_backup_20261026.manifest;
select * from security_p0_backup_20261026.row_fingerprints order by table_name;
commit;
