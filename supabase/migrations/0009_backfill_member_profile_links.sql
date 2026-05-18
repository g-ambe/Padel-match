-- Idempotent backfill to stabilize regular-member name resolution
-- Safe for non-clean existing databases.

-- Ensure player_profiles exists
create table if not exists player_profiles (
  id uuid primary key default uuid_generate_v4(),
  display_name text not null,
  linked_auth_user_id uuid,
  created_at timestamptz not null default now()
);

-- Ensure reference columns exist
alter table if exists club_members
  add column if not exists player_profile_id uuid references player_profiles(id) on delete cascade;

alter table if exists event_participants
  add column if not exists player_profile_id uuid references player_profiles(id);

-- Ensure participant_type exists for safe member filtering
alter table if exists event_participants
  add column if not exists participant_type text not null default 'guest';

update event_participants
set participant_type = case
  when coalesce(player_profile_id, profile_id) is not null then 'member'
  else 'guest'
end
where participant_type is null
   or participant_type not in ('member', 'guest');

-- Backfill player_profiles from legacy profiles (keeps existing profile_id-based data usable)
insert into player_profiles (id, display_name, linked_auth_user_id)
select p.id, p.display_name, p.id
from profiles p
on conflict (id) do update set
  display_name = excluded.display_name,
  linked_auth_user_id = coalesce(player_profiles.linked_auth_user_id, excluded.linked_auth_user_id);

-- Backfill club_members.player_profile_id from legacy profile_id where possible
update club_members cm
set player_profile_id = cm.profile_id
where cm.player_profile_id is null
  and cm.profile_id is not null;

-- Ensure Wytel部活 exists
insert into clubs (name)
select 'Wytel部活'
where not exists (select 1 from clubs where name = 'Wytel部活');

-- Ensure regular Wytel members exist in player_profiles
with names(name) as (
  values ('青木'), ('今野'), ('神田'), ('蓮見'), ('赤木'), ('安倍'), ('瀧田'), ('神原')
)
insert into player_profiles (display_name)
select n.name
from names n
where not exists (
  select 1 from player_profiles pp where pp.display_name = n.name
);

-- Ensure regular Wytel members are linked in club_members via player_profile_id
insert into club_members (club_id, player_profile_id, role)
select c.id, pp.id, 'member'
from clubs c
join player_profiles pp on pp.display_name in ('青木','今野','神田','蓮見','赤木','安倍','瀧田','神原')
where c.name = 'Wytel部活'
  and not exists (
    select 1 from club_members cm
    where cm.club_id = c.id and cm.player_profile_id = pp.id
  );

-- Backfill existing event member rows to keep player_profile_id populated
-- 1) from profile_id direct mapping
update event_participants ep
set player_profile_id = ep.profile_id
where ep.player_profile_id is null
  and ep.profile_id is not null;

-- 2) for member rows still null, map by guest_name to player_profiles.display_name in same club context
update event_participants ep
set player_profile_id = pp.id
from events e
join club_members cm on cm.club_id = e.club_id
join player_profiles pp on pp.id = cm.player_profile_id
where ep.event_id = e.id
  and ep.participant_type = 'member'
  and ep.player_profile_id is null
  and ep.guest_name is not null
  and pp.display_name = ep.guest_name;
