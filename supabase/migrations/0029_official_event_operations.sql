-- Official event operations: logical delete and delete/update policies.
alter table if exists official_events add column if not exists is_deleted boolean not null default false;
alter table if exists official_events add column if not exists deleted_at timestamptz;

create index if not exists official_events_visible_club_idx on official_events (club_id, created_at desc) where is_deleted = false;

drop policy if exists "official_events_update_operations" on official_events;
drop policy if exists "official_matches_delete" on official_matches;

create policy "official_events_update_operations"
  on official_events for update to authenticated
  using (
    exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
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
  with check (
    exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
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
  );

create policy "official_matches_delete"
  on official_matches for delete to authenticated
  using (
    exists (
      select 1 from official_events oe
      where oe.id = official_matches.official_event_id
        and oe.status = 'active'
        and coalesce(oe.is_deleted, false) = false
        and (
          exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
          or exists (
            select 1 from club_members cm
            join player_profiles pp on pp.id = cm.player_profile_id
            where cm.club_id = oe.club_id and pp.linked_auth_user_id = auth.uid()
              and cm.is_active = true and cm.role in ('main_admin','sub_admin')
          )
          or exists (
            select 1 from club_members cm
            where cm.club_id = oe.club_id and cm.profile_id = auth.uid()
              and cm.is_active = true and cm.role in ('main_admin','sub_admin')
          )
        )
    )
  );
