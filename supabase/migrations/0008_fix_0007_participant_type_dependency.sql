-- Fix for non-clean environments where 0007/0008 order differs.
-- Make this migration idempotent and safe.

-- 1) Ensure player_profiles exists before adding references
create table if not exists player_profiles (
  id uuid primary key default uuid_generate_v4(),
  display_name text not null,
  linked_auth_user_id uuid,
  created_at timestamptz not null default now()
);

-- 2) Ensure event_participants.player_profile_id exists before any reference
alter table if exists event_participants
  add column if not exists player_profile_id uuid references player_profiles(id);

-- 3) Ensure participant_type exists
alter table if exists event_participants
  add column if not exists participant_type text not null default 'guest';

-- 4) Safe backfill preserving existing profile_id-based rows
update event_participants
set participant_type = case
  when coalesce(player_profile_id, profile_id) is not null then 'member'
  else 'guest'
end
where participant_type is null
   or participant_type not in ('member', 'guest');

-- 5) Add constraints only after required columns exist
alter table if exists event_participants
  drop constraint if exists event_participants_participant_type_check;
alter table if exists event_participants
  add constraint event_participants_participant_type_check
  check (participant_type in ('member', 'guest'));

alter table if exists event_participants
  drop constraint if exists event_participants_member_or_guest_check;
alter table if exists event_participants
  add constraint event_participants_member_or_guest_check
  check (
    (participant_type = 'member' and (player_profile_id is not null or profile_id is not null))
    or
    (participant_type = 'guest' and guest_name is not null)
  );
