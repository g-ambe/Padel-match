-- Phase 4/5: official event share links and public read policies.
alter table if exists official_events add column if not exists share_enabled boolean not null default false;
alter table if exists official_events add column if not exists share_token text;
alter table if exists official_events add column if not exists share_token_updated_at timestamptz;

create unique index if not exists official_events_share_token_unique_idx on official_events(share_token) where share_token is not null;

drop policy if exists "official_events_update_share" on official_events;
drop policy if exists "official_events_public_shared_select" on official_events;
drop policy if exists "official_opponents_public_shared_select" on official_opponents;
drop policy if exists "official_matches_public_shared_select" on official_matches;

create policy "official_events_update_share"
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

create policy "official_events_public_shared_select"
  on official_events for select to anon
  using (share_enabled = true and share_token is not null and status = 'closed');

create policy "official_opponents_public_shared_select"
  on official_opponents for select to anon
  using (
    exists (
      select 1 from official_events oe
      where oe.id = official_opponents.official_event_id
        and oe.share_enabled = true
        and oe.share_token is not null
        and oe.status = 'closed'
    )
  );

create policy "official_matches_public_shared_select"
  on official_matches for select to anon
  using (
    exists (
      select 1 from official_events oe
      where oe.id = official_matches.official_event_id
        and oe.share_enabled = true
        and oe.share_token is not null
        and oe.status = 'closed'
    )
  );

drop policy if exists "player_profiles_official_shared_select" on player_profiles;
create policy "player_profiles_official_shared_select"
  on player_profiles for select to anon
  using (
    exists (
      select 1 from official_matches om
      join official_events oe on oe.id = om.official_event_id
      where (om.our_player1_profile_id = player_profiles.id or om.our_player2_profile_id = player_profiles.id)
        and oe.share_enabled = true
        and oe.share_token is not null
        and oe.status = 'closed'
    )
  );

-- Keep official event membership checks aligned with the current schema: club_members.status is not used.
drop policy if exists "official_events_select" on official_events;
drop policy if exists "official_events_insert" on official_events;

create policy "official_events_select"
  on official_events for select to authenticated
  using (
    exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
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

create policy "official_events_insert"
  on official_events for insert to authenticated
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
