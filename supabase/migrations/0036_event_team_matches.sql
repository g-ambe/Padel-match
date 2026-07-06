-- Friendly team matches are stored as events with event_mode = 'team'.
alter table if exists events
  drop constraint if exists events_event_mode_check;

alter table if exists events
  add constraint events_event_mode_check check (event_mode in ('auto', 'manual', 'team'));

alter table if exists events
  add column if not exists description text,
  add column if not exists memo text;

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

create policy "event_team_sides_select" on event_team_sides for select to anon, authenticated using (
  exists (select 1 from events e where e.id = event_team_sides.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and (auth.role() = 'authenticated' or (e.status = 'closed' and e.share_enabled = true and e.share_token is not null)))
);

create policy "event_team_matches_select" on event_team_matches for select to anon, authenticated using (
  exists (select 1 from events e where e.id = event_team_matches.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and (auth.role() = 'authenticated' or (e.status = 'closed' and e.share_enabled = true and e.share_token is not null)))
);

create policy "event_team_sides_manage" on event_team_sides for all to authenticated using (
  exists (select 1 from events e where e.id = event_team_sides.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and e.status <> 'closed' and (
    exists (select 1 from app_admins aa where aa.profile_id = auth.uid() and aa.is_active = true)
    or e.created_by_auth_user_id = auth.uid()
    or exists (select 1 from club_members cm join player_profiles pp on pp.id = cm.player_profile_id where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and pp.linked_auth_user_id = auth.uid())
    or exists (select 1 from club_members cm where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and cm.profile_id = auth.uid())
  ))
) with check (true);

create policy "event_team_matches_manage" on event_team_matches for all to authenticated using (
  exists (select 1 from events e where e.id = event_team_matches.event_id and e.event_mode = 'team' and coalesce(e.is_deleted, false) = false and e.status <> 'closed' and (
    exists (select 1 from app_admins aa where aa.profile_id = auth.uid() and aa.is_active = true)
    or e.created_by_auth_user_id = auth.uid()
    or exists (select 1 from club_members cm join player_profiles pp on pp.id = cm.player_profile_id where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and pp.linked_auth_user_id = auth.uid())
    or exists (select 1 from club_members cm where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and cm.profile_id = auth.uid())
  ))
) with check (true);
