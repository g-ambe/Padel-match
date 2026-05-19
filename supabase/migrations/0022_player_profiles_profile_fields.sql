alter table if exists player_profiles
  add column if not exists bio text,
  add column if not exists play_level text,
  add column if not exists dominant_hand text,
  add column if not exists preferred_position text,
  add column if not exists activity_area text;
