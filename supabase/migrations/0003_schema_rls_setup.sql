-- Development-friendly schema alignment and RLS setup

alter table if exists match_players
  add column if not exists created_at timestamptz not null default now();

alter table if exists player_stats
  add column if not exists created_at timestamptz not null default now();

-- Enable RLS for app tables
alter table if exists profiles enable row level security;
alter table if exists clubs enable row level security;
alter table if exists club_members enable row level security;
alter table if exists events enable row level security;
alter table if exists event_participants enable row level security;
alter table if exists rounds enable row level security;
alter table if exists matches enable row level security;
alter table if exists match_players enable row level security;
alter table if exists match_results enable row level security;
alter table if exists player_stats enable row level security;

-- Simple dev policies: allow authenticated and anon read/write
create policy "dev_all_profiles" on profiles for all to anon, authenticated using (true) with check (true);
create policy "dev_all_clubs" on clubs for all to anon, authenticated using (true) with check (true);
create policy "dev_all_club_members" on club_members for all to anon, authenticated using (true) with check (true);
create policy "dev_all_events" on events for all to anon, authenticated using (true) with check (true);
create policy "dev_all_event_participants" on event_participants for all to anon, authenticated using (true) with check (true);
create policy "dev_all_rounds" on rounds for all to anon, authenticated using (true) with check (true);
create policy "dev_all_matches" on matches for all to anon, authenticated using (true) with check (true);
create policy "dev_all_match_players" on match_players for all to anon, authenticated using (true) with check (true);
create policy "dev_all_match_results" on match_results for all to anon, authenticated using (true) with check (true);
create policy "dev_all_player_stats" on player_stats for all to anon, authenticated using (true) with check (true);
