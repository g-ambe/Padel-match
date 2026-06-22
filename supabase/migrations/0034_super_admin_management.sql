-- Super user management support. Super user detection does not depend on club_members.
create or replace function public.is_super_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'testuser01@example.com'
    or exists (
      select 1 from public.app_admins
      where profile_id = auth.uid()
        and is_active = true
    );
$$;

grant execute on function public.is_super_user() to authenticated;

alter table if exists clubs add column if not exists is_deleted boolean not null default false;
alter table if exists clubs add column if not exists deleted_at timestamptz;
create index if not exists clubs_not_deleted_idx on clubs (created_at desc) where is_deleted = false;

-- Existing app_admin based policies remain valid; these focused policies add the hard-coded super user email path.
drop policy if exists "clubs_super_user_select" on clubs;
create policy "clubs_super_user_select" on clubs for select to authenticated using (public.is_super_user());

drop policy if exists "clubs_super_user_update" on clubs;
create policy "clubs_super_user_update" on clubs for update to authenticated using (public.is_super_user()) with check (public.is_super_user());

drop policy if exists "events_super_user_select" on events;
create policy "events_super_user_select" on events for select to authenticated using (public.is_super_user());

drop policy if exists "events_super_user_update" on events;
create policy "events_super_user_update" on events for update to authenticated using (public.is_super_user()) with check (public.is_super_user());

drop policy if exists "official_events_super_user_select" on official_events;
create policy "official_events_super_user_select" on official_events for select to authenticated using (public.is_super_user());

drop policy if exists "official_events_super_user_update" on official_events;
create policy "official_events_super_user_update" on official_events for update to authenticated using (public.is_super_user()) with check (public.is_super_user());

-- Read-only related data for the management dashboard counts.
drop policy if exists "club_members_super_user_select" on club_members;
create policy "club_members_super_user_select" on club_members for select to authenticated using (public.is_super_user());

drop policy if exists "rounds_super_user_select" on rounds;
create policy "rounds_super_user_select" on rounds for select to authenticated using (public.is_super_user());

drop policy if exists "matches_super_user_select" on matches;
create policy "matches_super_user_select" on matches for select to authenticated using (public.is_super_user());

drop policy if exists "match_players_super_user_select" on match_players;
create policy "match_players_super_user_select" on match_players for select to authenticated using (public.is_super_user());

drop policy if exists "event_participants_super_user_select" on event_participants;
create policy "event_participants_super_user_select" on event_participants for select to authenticated using (public.is_super_user());

drop policy if exists "official_opponents_super_user_select" on official_opponents;
create policy "official_opponents_super_user_select" on official_opponents for select to authenticated using (public.is_super_user());

drop policy if exists "official_matches_super_user_select" on official_matches;
create policy "official_matches_super_user_select" on official_matches for select to authenticated using (public.is_super_user());

drop policy if exists "event_video_links_super_user_select" on event_video_links;
create policy "event_video_links_super_user_select" on event_video_links for select to authenticated using (public.is_super_user());

drop policy if exists "event_video_clicks_super_user_select" on event_video_clicks;
create policy "event_video_clicks_super_user_select" on event_video_clicks for select to authenticated using (public.is_super_user());

drop policy if exists "official_video_clicks_super_user_select" on official_video_clicks;
create policy "official_video_clicks_super_user_select" on official_video_clicks for select to authenticated using (public.is_super_user());

drop policy if exists "event_video_link_clicks_super_user_select" on event_video_link_clicks;
create policy "event_video_link_clicks_super_user_select" on event_video_link_clicks for select to authenticated using (public.is_super_user());
