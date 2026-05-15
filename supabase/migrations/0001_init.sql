create extension if not exists "uuid-ossp";

create table profiles (
  id uuid primary key default uuid_generate_v4(),
  display_name text not null,
  avatar_url text,
  created_at timestamptz default now()
);

create table clubs (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_id uuid references profiles(id),
  created_at timestamptz default now()
);

create table club_members (
  id uuid primary key default uuid_generate_v4(),
  club_id uuid references clubs(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  role text default 'member',
  created_at timestamptz default now()
);

create table events (
  id uuid primary key default uuid_generate_v4(),
  club_id uuid references clubs(id) on delete cascade,
  name text not null,
  category text not null default 'club',
  court_count int not null,
  created_at timestamptz default now()
);

create table event_participants (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid references events(id) on delete cascade,
  profile_id uuid references profiles(id),
  guest_name text,
  status text not null check (status in ('active','resting','absent')),
  created_at timestamptz default now()
);

create table rounds (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid references events(id) on delete cascade,
  round_number int not null,
  created_at timestamptz default now()
);

create table matches (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid references events(id) on delete cascade,
  round_id uuid references rounds(id) on delete cascade,
  court_number int not null,
  youtube_url text,
  created_at timestamptz default now()
);

create table match_players (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references matches(id) on delete cascade,
  participant_id uuid references event_participants(id),
  team text not null check (team in ('A','B'))
);

create table match_results (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references matches(id) on delete cascade,
  score_a int not null,
  score_b int not null,
  winner_team text not null check (winner_team in ('A','B')),
  created_at timestamptz default now()
);

create table player_stats (
  id uuid primary key default uuid_generate_v4(),
  club_id uuid references clubs(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  match_count int not null default 0,
  win_count int not null default 0,
  win_rate numeric not null default 0,
  mvp_daily_count int not null default 0,
  mvp_total_count int not null default 0,
  updated_at timestamptz default now()
);
