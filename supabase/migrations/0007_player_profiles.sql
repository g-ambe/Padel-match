-- Separate real player profiles from login auth users
create table if not exists player_profiles (
  id uuid primary key default uuid_generate_v4(),
  display_name text not null,
  linked_auth_user_id uuid,
  created_at timestamptz not null default now()
);

-- group members reference player_profiles
alter table if exists club_members
  add column if not exists player_profile_id uuid references player_profiles(id) on delete cascade;

create unique index if not exists club_members_unique_group_player_profile
  on club_members (club_id, player_profile_id)
  where player_profile_id is not null;

-- event participants can reference player_profiles for regular members
alter table if exists event_participants
  add column if not exists player_profile_id uuid references player_profiles(id);

-- Keep member/guest separation with new profile key
alter table if exists event_participants
  drop constraint if exists event_participants_member_or_guest_check;
alter table if exists event_participants
  add constraint event_participants_member_or_guest_check
  check (
    (participant_type = 'member' and (player_profile_id is not null or profile_id is not null))
    or
    (participant_type = 'guest' and guest_name is not null)
  );

-- Migrate existing app profiles into player_profiles (for backward compatibility)
insert into player_profiles (id, display_name, linked_auth_user_id)
select p.id, p.display_name, p.id
from profiles p
on conflict (id) do update set
  display_name = excluded.display_name,
  linked_auth_user_id = coalesce(player_profiles.linked_auth_user_id, excluded.linked_auth_user_id);

-- Map existing group memberships to player_profile_id
update club_members cm
set player_profile_id = cm.profile_id
where cm.player_profile_id is null
  and cm.profile_id is not null;

-- Ensure Wytel部活 exists
insert into clubs (name)
select 'Wytel部活'
where not exists (select 1 from clubs where name = 'Wytel部活');

-- Create regular member player profiles for Wytel部活
with names(name) as (
  values ('青木'), ('今野'), ('神田'), ('蓮見'), ('赤木'), ('安倍'), ('瀧田'), ('神原')
)
insert into player_profiles (display_name)
select n.name
from names n
where not exists (
  select 1 from player_profiles pp where pp.display_name = n.name
);

-- Link regular members to Wytel部活 as group members
insert into club_members (club_id, player_profile_id, role)
select c.id, pp.id, 'member'
from clubs c
join player_profiles pp on pp.display_name in ('青木','今野','神田','蓮見','赤木','安倍','瀧田','神原')
where c.name = 'Wytel部活'
  and not exists (
    select 1 from club_members cm
    where cm.club_id = c.id and cm.player_profile_id = pp.id
  );
