alter table if exists clubs
  add column if not exists is_active boolean not null default true;

alter table if exists club_members
  add column if not exists role text not null default 'member';

alter table if exists club_members
  drop constraint if exists club_members_role_check;

alter table if exists club_members
  add constraint club_members_role_check check (role in ('main_admin','sub_admin','member'));

create table if not exists app_admins (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

create unique index if not exists app_admins_profile_unique on app_admins(profile_id);
