-- Allow creator-owned events without a selected group to be read by the creator only.
-- Keep membership checks based on club_members.is_active; club_members.status is not used.

alter table if exists events
  add column if not exists created_by_auth_user_id uuid;

alter table if exists official_events
  alter column club_id drop not null;

create index if not exists events_creator_null_club_idx
  on events (created_by_auth_user_id, created_at desc)
  where club_id is null and is_deleted = false;

create index if not exists official_events_creator_null_club_idx
  on official_events (created_by_auth_user_id, created_at desc)
  where club_id is null and is_deleted = false;

drop policy if exists "events_select" on events;
create policy "events_select"
  on events for select to authenticated
  using (
    exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
    or (club_id is null and created_by_auth_user_id = auth.uid())
    or exists (
      select 1 from club_members cm
      join player_profiles pp on pp.id = cm.player_profile_id
      where cm.club_id = events.club_id
        and pp.linked_auth_user_id = auth.uid()
        and cm.is_active = true
    )
    or exists (
      select 1 from club_members cm
      where cm.club_id = events.club_id
        and cm.profile_id = auth.uid()
        and cm.is_active = true
    )
  );

drop policy if exists "events_insert" on events;
create policy "events_insert"
  on events for insert to authenticated
  with check (
    created_by_auth_user_id = auth.uid()
    and (
      club_id is null
      or exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
      or exists (
        select 1 from club_members cm
        join player_profiles pp on pp.id = cm.player_profile_id
        where cm.club_id = events.club_id
          and pp.linked_auth_user_id = auth.uid()
          and cm.is_active = true
      )
      or exists (
        select 1 from club_members cm
        where cm.club_id = events.club_id
          and cm.profile_id = auth.uid()
          and cm.is_active = true
      )
    )
  );

drop policy if exists "official_events_select" on official_events;
create policy "official_events_select"
  on official_events for select to authenticated
  using (
    exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
    or (club_id is null and created_by_auth_user_id = auth.uid())
    or exists (
      select 1 from club_members cm
      join player_profiles pp on pp.id = cm.player_profile_id
      where cm.club_id = official_events.club_id
        and pp.linked_auth_user_id = auth.uid()
        and cm.is_active = true
    )
    or exists (
      select 1 from club_members cm
      where cm.club_id = official_events.club_id
        and cm.profile_id = auth.uid()
        and cm.is_active = true
    )
  );

drop policy if exists "official_events_insert" on official_events;
create policy "official_events_insert"
  on official_events for insert to authenticated
  with check (
    created_by_auth_user_id = auth.uid()
    and (
      club_id is null
      or exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
      or exists (
        select 1 from club_members cm
        join player_profiles pp on pp.id = cm.player_profile_id
        where cm.club_id = official_events.club_id
          and pp.linked_auth_user_id = auth.uid()
          and cm.is_active = true
          and cm.role in ('main_admin', 'sub_admin')
      )
      or exists (
        select 1 from club_members cm
        where cm.club_id = official_events.club_id
          and cm.profile_id = auth.uid()
          and cm.is_active = true
          and cm.role in ('main_admin', 'sub_admin')
      )
    )
  );
