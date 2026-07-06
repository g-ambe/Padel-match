-- Friendly team matches are stored as events with event_mode = 'team'.
alter table if exists events
  drop constraint if exists events_event_mode_check;

alter table if exists events
  add constraint events_event_mode_check check (event_mode in ('auto', 'manual', 'team'));

alter table if exists events
  add column if not exists description text,
  add column if not exists memo text,
  add column if not exists updated_at timestamptz;


create table if not exists event_team_sides (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  side text not null check (side in ('team_a', 'team_b')),
  club_id uuid references clubs(id) on delete set null,
  team_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, side)
);


-- Investigation SQL for manual diagnosis (run separately if needed):
-- select schemaname, tablename, policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'events'
-- order by policyname;

-- Non-recursive helpers for friendly team event policies. These functions do not select from events.
create or replace function public.can_view_friendly_team_event_by_sides(
  p_event_id uuid,
  p_created_by_auth_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_user()
    or p_created_by_auth_user_id = auth.uid()
    or exists (
      select 1
      from public.event_team_sides ets
      join public.club_members cm on cm.club_id = ets.club_id
      join public.player_profiles pp on pp.id = cm.player_profile_id
      where ets.event_id = p_event_id
        and cm.is_active = true
        and pp.linked_auth_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.event_team_sides ets
      join public.club_members cm on cm.club_id = ets.club_id
      where ets.event_id = p_event_id
        and cm.is_active = true
        and cm.profile_id = auth.uid()
    );
$$;

create or replace function public.can_manage_friendly_team_event_by_sides(
  p_event_id uuid,
  p_created_by_auth_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_user()
    or p_created_by_auth_user_id = auth.uid()
    or exists (
      select 1
      from public.event_team_sides ets
      join public.club_members cm on cm.club_id = ets.club_id
      join public.player_profiles pp on pp.id = cm.player_profile_id
      where ets.event_id = p_event_id
        and cm.is_active = true
        and cm.role in ('main_admin', 'sub_admin')
        and pp.linked_auth_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.event_team_sides ets
      join public.club_members cm on cm.club_id = ets.club_id
      where ets.event_id = p_event_id
        and cm.is_active = true
        and cm.role in ('main_admin', 'sub_admin')
        and cm.profile_id = auth.uid()
    );
$$;

grant execute on function public.can_view_friendly_team_event_by_sides(uuid, uuid) to authenticated;
grant execute on function public.can_manage_friendly_team_event_by_sides(uuid, uuid) to authenticated;

-- Friendly team event policies intentionally avoid selecting from events to prevent 42P17 recursion.
drop policy if exists "events_select_friendly_team_match_viewers" on events;
create policy "events_select_friendly_team_match_viewers"
  on events for select to authenticated
  using (
    event_mode = 'team'
    and coalesce(is_deleted, false) = false
    and public.can_view_friendly_team_event_by_sides(id, created_by_auth_user_id)
  );

drop policy if exists "events_update_friendly_team_match_managers" on events;
create policy "events_update_friendly_team_match_managers"
  on events for update to authenticated
  using (
    event_mode = 'team'
    and coalesce(is_deleted, false) = false
    and public.can_manage_friendly_team_event_by_sides(id, created_by_auth_user_id)
  )
  with check (
    event_mode = 'team'
    and coalesce(is_deleted, false) = false
    and stats_mode in ('official', 'record_only', 'undecided')
    and status in ('active', 'closed')
    and public.can_manage_friendly_team_event_by_sides(id, created_by_auth_user_id)
  );

drop policy if exists "events_delete_friendly_team_match_managers" on events;
create policy "events_delete_friendly_team_match_managers"
  on events for delete to authenticated
  using (
    event_mode = 'team'
    and public.can_manage_friendly_team_event_by_sides(id, created_by_auth_user_id)
  );

-- Operational verification SQL (replace the id with a friendly team event id):
-- select id, status, stats_mode, event_mode from public.events where id = '<event-id>'::uuid;

create table if not exists event_team_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  match_order int not null default 1,
  team_a_player1_profile_id uuid references player_profiles(id) on delete set null,
  team_a_player1_guest_name text,
  team_a_player2_profile_id uuid references player_profiles(id) on delete set null,
  team_a_player2_guest_name text,
  team_b_player1_profile_id uuid references player_profiles(id) on delete set null,
  team_b_player1_guest_name text,
  team_b_player2_profile_id uuid references player_profiles(id) on delete set null,
  team_b_player2_guest_name text,
  team_a_score int check (team_a_score is null or team_a_score >= 0),
  team_b_score int check (team_b_score is null or team_b_score >= 0),
  result text not null default 'undecided' check (result in ('win', 'lose', 'draw', 'undecided')),
  score_detail text,
  memo text,
  youtube_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_team_sides_event_idx on event_team_sides(event_id);
create index if not exists event_team_matches_event_order_idx on event_team_matches(event_id, match_order, created_at);

alter table event_team_sides enable row level security;
alter table event_team_matches enable row level security;

grant select, insert, update, delete on table event_team_sides to authenticated;
grant select on table event_team_sides to anon;
grant select, insert, update, delete on table event_team_matches to authenticated;
grant select on table event_team_matches to anon;

drop policy if exists "event_team_sides_select" on event_team_sides;
create policy "event_team_sides_select" on event_team_sides for select to anon, authenticated using (
  exists (select 1 from events e where e.id = event_team_sides.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and (auth.role() = 'authenticated' or (e.status = 'closed' and e.share_enabled = true and e.share_token is not null)))
);

drop policy if exists "event_team_matches_select" on event_team_matches;
create policy "event_team_matches_select" on event_team_matches for select to anon, authenticated using (
  exists (select 1 from events e where e.id = event_team_matches.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and (auth.role() = 'authenticated' or (e.status = 'closed' and e.share_enabled = true and e.share_token is not null)))
);

drop policy if exists "event_team_sides_manage" on event_team_sides;
create policy "event_team_sides_manage" on event_team_sides for all to authenticated using (
  exists (select 1 from events e where e.id = event_team_sides.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and e.status <> 'closed' and (
    exists (select 1 from app_admins aa where aa.profile_id = auth.uid() and aa.is_active = true)
    or e.created_by_auth_user_id = auth.uid()
    or exists (select 1 from club_members cm join player_profiles pp on pp.id = cm.player_profile_id where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and pp.linked_auth_user_id = auth.uid())
    or exists (select 1 from club_members cm where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and cm.profile_id = auth.uid())
  ))
) with check (true);

drop policy if exists "event_team_matches_manage" on event_team_matches;
create policy "event_team_matches_manage" on event_team_matches for all to authenticated using (
  exists (select 1 from events e where e.id = event_team_matches.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and e.status <> 'closed' and (
    exists (select 1 from app_admins aa where aa.profile_id = auth.uid() and aa.is_active = true)
    or e.created_by_auth_user_id = auth.uid()
    or exists (select 1 from club_members cm join player_profiles pp on pp.id = cm.player_profile_id where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and pp.linked_auth_user_id = auth.uid())
    or exists (select 1 from club_members cm where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and cm.profile_id = auth.uid())
  ))
) with check (true);

create table if not exists event_team_guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  side text not null check (side in ('team_a', 'team_b')),
  guest_name text not null check (btrim(guest_name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, side, guest_name)
);

create index if not exists event_team_guests_event_side_idx on event_team_guests(event_id, side, created_at);

alter table event_team_guests enable row level security;

grant select, insert, update, delete on table event_team_guests to authenticated;
grant select on table event_team_guests to anon;

drop policy if exists "event_team_guests_select" on event_team_guests;
create policy "event_team_guests_select" on event_team_guests for select to anon, authenticated using (
  exists (select 1 from events e where e.id = event_team_guests.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and (auth.role() = 'authenticated' or (e.status = 'closed' and e.share_enabled = true and e.share_token is not null)))
);

drop policy if exists "event_team_guests_manage" on event_team_guests;
create policy "event_team_guests_manage" on event_team_guests for all to authenticated using (
  exists (select 1 from events e where e.id = event_team_guests.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and e.status <> 'closed' and (
    exists (select 1 from app_admins aa where aa.profile_id = auth.uid() and aa.is_active = true)
    or e.created_by_auth_user_id = auth.uid()
    or exists (select 1 from event_team_sides ets join club_members cm on cm.club_id = ets.club_id join player_profiles pp on pp.id = cm.player_profile_id where ets.event_id = e.id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and pp.linked_auth_user_id = auth.uid())
    or exists (select 1 from event_team_sides ets join club_members cm on cm.club_id = ets.club_id where ets.event_id = e.id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and cm.profile_id = auth.uid())
  ))
) with check (
  exists (select 1 from events e where e.id = event_team_guests.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and e.status <> 'closed' and (
    exists (select 1 from app_admins aa where aa.profile_id = auth.uid() and aa.is_active = true)
    or e.created_by_auth_user_id = auth.uid()
    or exists (select 1 from event_team_sides ets join club_members cm on cm.club_id = ets.club_id join player_profiles pp on pp.id = cm.player_profile_id where ets.event_id = e.id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and pp.linked_auth_user_id = auth.uid())
    or exists (select 1 from event_team_sides ets join club_members cm on cm.club_id = ets.club_id where ets.event_id = e.id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and cm.profile_id = auth.uid())
  ))
);
