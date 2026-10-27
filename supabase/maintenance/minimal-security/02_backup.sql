-- 適用直前に書き込みを止め、管理者が手動実行する。業務データは読むだけ。
-- 同名schemaがあれば中止する。再適用時も最初のバックアップを上書きしない。
-- 業務データの復元には別途SupabaseのDBバックアップ/PITRを確保する。
begin isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local row_security = off;
create schema security_minimal_backup;
revoke all on schema security_minimal_backup from public,anon,authenticated;
create table security_minimal_backup.manifest as
select now() as captured_at,current_database() as database_name,current_user as captured_by;
create table security_minimal_backup.relations as
select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl,c.relowner
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') and c.relname in ('clubs','events','event_participants','rounds','matches','match_players','match_results','player_stats','event_team_sides','event_team_matches','official_events','official_opponents','official_matches','player_profiles','profiles','club_members','join_requests');
create table security_minimal_backup.columns as
select n.nspname,c.relname,a.attname,a.attacl,format_type(a.atttypid,a.atttypmod) as data_type
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped;
create table security_minimal_backup.policies as
select * from pg_policies where schemaname='public';
create table security_minimal_backup.functions as
select n.nspname,p.oid::regprocedure::text as signature,p.proacl,p.proowner,
  pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','profile_link_private') and p.prokind='f' and p.proname in ('club_role','preview','notify_admins','merge_profiles','add_provisional_club_member','preview_profile_join','request_player_profile_link','review_player_profile_link','submit_profile_join_request','review_profile_join_request','get_player_profile_link_request','find_profile_link_account');
create table security_minimal_backup.triggers as
select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal;
-- 行内容の照合用ハッシュ。公開テーブルの行をバックアップschemaへコピーしない。
create table security_minimal_backup.row_fingerprints(
  table_name text primary key,row_count bigint,content_hash text
);
do $$ declare r record; total bigint; fingerprint text; begin
  for r in select relname from security_minimal_backup.relations order by relname loop
    execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.relname)
      into total,fingerprint;
    insert into security_minimal_backup.row_fingerprints values(r.relname,total,fingerprint);
  end loop;
end $$;
revoke all on all tables in schema security_minimal_backup from public,anon,authenticated;
select * from security_minimal_backup.manifest;
select * from security_minimal_backup.row_fingerprints order by table_name;
commit;
