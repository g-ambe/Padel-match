-- Phase 1: official event metadata only. Existing event tables and data are unchanged.
create table if not exists official_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id),
  title text not null,
  event_date date,
  description text,
  memo text,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by_auth_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists official_events_club_idx on official_events (club_id, created_at desc);

alter table official_events enable row level security;

create policy "official_events_select"
  on official_events for select to authenticated
  using (
    exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
    or exists (
      select 1 from club_members cm
      join player_profiles pp on pp.id = cm.player_profile_id
      where cm.club_id = official_events.club_id
        and pp.linked_auth_user_id = auth.uid()
        and cm.is_active = true and cm.status = 'active'
    )
    or exists (
      select 1 from club_members cm
      where cm.club_id = official_events.club_id
        and cm.profile_id = auth.uid()
        and cm.is_active = true and cm.status = 'active'
    )
  );

create policy "official_events_insert"
  on official_events for insert to authenticated
  with check (
    exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
    or exists (
      select 1 from club_members cm
      join player_profiles pp on pp.id = cm.player_profile_id
      where cm.club_id = official_events.club_id
        and pp.linked_auth_user_id = auth.uid()
        and cm.is_active = true and cm.status = 'active'
        and cm.role in ('main_admin', 'sub_admin')
    )
    or exists (
      select 1 from club_members cm
      where cm.club_id = official_events.club_id
        and cm.profile_id = auth.uid()
        and cm.is_active = true and cm.status = 'active'
        and cm.role in ('main_admin', 'sub_admin')
    )
  );
