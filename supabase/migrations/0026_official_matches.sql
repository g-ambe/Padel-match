-- Official external league/team-match records. Kept separate from random events and rankings.
create table if not exists official_events (
  id uuid primary key default gen_random_uuid(), club_id uuid not null references clubs(id), title text not null,
  event_date date, description text, memo text, status text not null default 'active' check (status in ('active','closed')),
  created_by_auth_user_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists official_opponents (
  id uuid primary key default gen_random_uuid(), official_event_id uuid not null references official_events(id) on delete cascade,
  opponent_team_name text not null, memo text, created_at timestamptz not null default now()
);
create table if not exists official_matches (
  id uuid primary key default gen_random_uuid(), official_event_id uuid not null references official_events(id) on delete cascade,
  official_opponent_id uuid not null references official_opponents(id) on delete cascade, match_order int not null,
  our_player1_profile_id uuid references player_profiles(id), our_player2_profile_id uuid references player_profiles(id),
  our_player1_guest_name text, our_player2_guest_name text, opponent_player1_name text, opponent_player2_name text,
  our_score int, opponent_score int, result text not null default 'undecided' check (result in ('win','lose','draw','undecided')),
  score_detail text, memo text, youtube_url text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists official_events_club_idx on official_events(club_id, created_at desc);
create index if not exists official_opponents_event_idx on official_opponents(official_event_id);
create unique index if not exists official_matches_order_idx on official_matches(official_opponent_id, match_order);
alter table official_events enable row level security; alter table official_opponents enable row level security; alter table official_matches enable row level security;
create policy "official_events_access" on official_events for all to authenticated using (true) with check (true);
create policy "official_opponents_access" on official_opponents for all to authenticated using (true) with check (true);
create policy "official_matches_access" on official_matches for all to authenticated using (true) with check (true);
