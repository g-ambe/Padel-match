alter table if exists clubs
  add column if not exists description text;

alter table if exists player_profiles
  add column if not exists is_active boolean not null default true;

alter table if exists club_members
  add column if not exists is_active boolean not null default true;
