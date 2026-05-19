create table if not exists notifications (
  id uuid primary key default uuid_generate_v4(),
  target_auth_user_id uuid not null,
  type text not null,
  title text not null,
  body text,
  related_club_id uuid references clubs(id) on delete set null,
  related_join_request_id uuid references join_requests(id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_target_created_idx
  on notifications(target_auth_user_id, created_at desc);

create index if not exists notifications_target_read_created_idx
  on notifications(target_auth_user_id, is_read, created_at desc);

alter table if exists notifications enable row level security;

drop policy if exists notifications_select_own on notifications;
create policy notifications_select_own
on notifications
for select
to authenticated
using (auth.uid() = target_auth_user_id);

drop policy if exists notifications_insert_own_or_admin on notifications;
create policy notifications_insert_own_or_admin
on notifications
for insert
to authenticated
with check (
  auth.uid() = target_auth_user_id
  or exists (
    select 1 from app_admins a
    where a.profile_id = auth.uid()
      and a.is_active = true
  )
);

drop policy if exists notifications_update_read_own on notifications;
create policy notifications_update_read_own
on notifications
for update
to authenticated
using (auth.uid() = target_auth_user_id)
with check (auth.uid() = target_auth_user_id);

grant select, insert, update on notifications to authenticated;
