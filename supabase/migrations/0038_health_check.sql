-- GitHub Actionsからanon keyで軽量なSELECTを行うための専用テーブル。
-- Supabase SQL Editorで手動実行する。既存の業務テーブルには依存しない。
create table if not exists public.health_check (
  id smallint primary key,
  created_at timestamptz not null default now(),
  constraint health_check_single_row check (id = 1)
);

insert into public.health_check (id)
values (1)
on conflict (id) do nothing;

alter table public.health_check enable row level security;

revoke all on table public.health_check from anon, authenticated;
grant select (id) on table public.health_check to anon;

drop policy if exists "anon_can_read_health_check" on public.health_check;
create policy "anon_can_read_health_check"
on public.health_check
for select
to anon
using (id = 1);

