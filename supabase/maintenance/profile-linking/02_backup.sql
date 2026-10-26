-- 0039適用前に編集を止めて手動実行する。既存バックアップを上書きしない。
-- 日時を変える場合は03_verify.sqlの参照も同じ名前へ変更する。
begin isolation level repeatable read;
set local row_security = off;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
create schema player_profile_link_backup_20261023;
revoke all on schema player_profile_link_backup_20261023 from public,anon,authenticated;
create table player_profile_link_backup_20261023.manifest(source_schema text,source_table text,backup_table text,row_count bigint,primary key(source_schema,source_table));
create table player_profile_link_backup_20261023.relations as
select n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p');
create table player_profile_link_backup_20261023.columns as
select n.nspname,c.relname,a.attname,a.attacl,format_type(a.atttypid,a.atttypmod) as data_type,a.attnotnull,a.attgenerated
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attnum>0 and not a.attisdropped;
create table player_profile_link_backup_20261023.policies as select * from pg_policies where schemaname='public';
create table player_profile_link_backup_20261023.indexes as select * from pg_indexes where schemaname='public';
create table player_profile_link_backup_20261023.constraints as
select c.conrelid::regclass::text as source_table,c.conname,pg_get_constraintdef(c.oid) as definition from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public';
create table player_profile_link_backup_20261023.functions as
select p.oid::regprocedure::text as signature,p.proacl,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p');
create table player_profile_link_backup_20261023.triggers as
select t.tgrelid::regclass::text as source_table,t.tgname,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal;
do $$ declare r record; total bigint; backup_name text; begin
  -- 関連機能のデータを同一時点で保存。実DBに追加されたFK参照表も含める。
  for r in
    select distinct n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and ((n.nspname='public' and c.relname in (
      'player_profiles','profiles','clubs','club_members','events','event_participants','rounds','matches','match_players','match_results','player_stats','join_requests','event_team_matches','event_team_sides','event_team_guests','official_events','official_opponents','official_matches','notifications','app_admins','player_profile_link_requests','player_profile_merges'
    )) or c.oid in (select conrelid from pg_constraint where contype='f' and confrelid='public.player_profiles'::regclass)) order by n.nspname,c.relname
  loop
    backup_name:='t_'||lpad((select count(*)+1 from player_profile_link_backup_20261023.manifest)::text,3,'0');
    execute format('create table player_profile_link_backup_20261023.%I as table %I.%I',backup_name,r.nspname,r.relname);
    execute format('select count(*) from player_profile_link_backup_20261023.%I',backup_name) into total;
    insert into player_profile_link_backup_20261023.manifest values(r.nspname,r.relname,backup_name,total);
  end loop;
end $$;
revoke all on all tables in schema player_profile_link_backup_20261023 from public,anon,authenticated;
select * from player_profile_link_backup_20261023.manifest order by source_schema,source_table;
commit;
