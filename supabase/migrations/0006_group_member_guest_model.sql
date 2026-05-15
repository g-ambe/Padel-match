-- Minimal data-model reinforcement for:
-- - multiple groups (clubs)
-- - regular group members
-- - event-scoped temporary guests
-- - group-scoped cumulative stats

-- 1) Events must belong to one group
-- (for existing environments, run this after fixing any NULL club_id rows)
alter table if exists events
  alter column club_id set not null;

-- 2) Regular members are scoped to a group
create unique index if not exists club_members_unique_group_member
  on club_members (club_id, profile_id);

-- 3) Event participants: distinguish regular members vs temporary guests
alter table if exists event_participants
  add column if not exists participant_type text not null default 'guest'
  check (participant_type in ('member', 'guest'));

-- Backfill type from existing rows
update event_participants
set participant_type = case
  when profile_id is not null then 'member'
  else 'guest'
end
where participant_type is null
   or participant_type not in ('member', 'guest');

-- Enforce separation:
-- member => profile_id required
-- guest  => guest_name required
alter table if exists event_participants
  drop constraint if exists event_participants_member_or_guest_check;
alter table if exists event_participants
  add constraint event_participants_member_or_guest_check
  check (
    (participant_type = 'member' and profile_id is not null)
    or
    (participant_type = 'guest' and guest_name is not null)
  );

-- 4) Group-scoped cumulative stats must not merge across groups
create unique index if not exists player_stats_unique_group_profile
  on player_stats (club_id, profile_id);
