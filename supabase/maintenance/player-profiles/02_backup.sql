-- 完全に読み取れる管理者権限で手動実行。バックアップ名の衝突時は中止し、上書きしない。
-- 以降のSQLも同じスキーマ名を参照する。別名にする場合は全ファイルを合わせて変更する。
begin transaction isolation level repeatable read;
set local row_security = off;
create schema player_profile_backup_20261022;
revoke all on schema player_profile_backup_20261022 from public, anon, authenticated;

create table player_profile_backup_20261022.manifest (
  source_schema text not null, source_table text not null, backup_table text not null,
  row_count bigint not null, captured_at timestamptz not null default transaction_timestamp(),
  primary key (source_schema, source_table)
);
create table player_profile_backup_20261022.repair_changes (
  source_schema text not null, source_table text not null, row_id uuid not null,
  before_row jsonb not null, after_row jsonb not null,
  applied_at timestamptz not null default transaction_timestamp(), restored_at timestamptz,
  primary key (source_schema, source_table, row_id)
);

do $$
declare r record; snapshot_name text; total bigint;
begin
  for r in
    select distinct n.nspname as schema_name, c.relname as table_name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.oid in (
      select conrelid from pg_constraint where contype = 'f' and confrelid = 'public.player_profiles'::regclass
      union select unnest(array[
        'public.player_profiles'::regclass, 'public.profiles'::regclass,
        'public.club_members'::regclass, 'public.event_participants'::regclass,
        'public.event_team_matches'::regclass, 'public.official_matches'::regclass,
        'public.join_requests'::regclass, 'public.player_stats'::regclass,
        'public.clubs'::regclass, 'public.events'::regclass,
        'public.matches'::regclass, 'public.match_players'::regclass, 'public.match_results'::regclass,
        'public.app_admins'::regclass
      ])
    ) order by 1, 2
  loop
    snapshot_name := r.schema_name || '__' || r.table_name;
    execute format('create table player_profile_backup_20261022.%I as table %I.%I', snapshot_name, r.schema_name, r.table_name);
    execute format('select count(*) from player_profile_backup_20261022.%I', snapshot_name) into total;
    insert into player_profile_backup_20261022.manifest values (r.schema_name, r.table_name, snapshot_name, total, transaction_timestamp());
  end loop;
end $$;

create table player_profile_backup_20261022.foreign_keys as
select c.oid, c.conname, c.conrelid::regclass::text as source_table,
  pg_get_constraintdef(c.oid) as definition from pg_constraint c
where c.contype = 'f' and c.confrelid in ('public.player_profiles'::regclass, 'public.profiles'::regclass);
create table player_profile_backup_20261022.columns_snapshot as
select * from information_schema.columns where table_schema = 'public';
create table player_profile_backup_20261022.policies_snapshot as
select * from pg_policies where schemaname = 'public';
revoke all on all tables in schema player_profile_backup_20261022 from public, anon, authenticated;
select * from player_profile_backup_20261022.manifest order by source_schema, source_table;
commit;
