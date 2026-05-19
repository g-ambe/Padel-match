create table if not exists join_requests (
  id uuid primary key default uuid_generate_v4(),
  club_id uuid not null references clubs(id) on delete cascade,
  target_club_member_id uuid references club_members(id) on delete set null,
  requester_auth_user_id uuid not null,
  requester_player_profile_id uuid references player_profiles(id) on delete set null,
  message text,
  status text not null default 'pending',
  reviewed_by_auth_user_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint join_requests_status_check check (status in ('pending','approved','rejected'))
);

create unique index if not exists join_requests_unique_pending_requester_per_club
  on join_requests (club_id, requester_auth_user_id)
  where status = 'pending';

create index if not exists join_requests_club_status_idx on join_requests(club_id, status, created_at desc);

alter table if exists join_requests enable row level security;

drop policy if exists join_requests_dev_all on join_requests;
create policy join_requests_dev_all
on join_requests
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update on join_requests to anon, authenticated;
