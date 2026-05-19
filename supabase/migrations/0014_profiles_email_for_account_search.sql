alter table if exists profiles
  add column if not exists email text;

create index if not exists profiles_email_idx on profiles (email);
