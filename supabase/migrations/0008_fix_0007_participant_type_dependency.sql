-- Fix for environments where 0007 is executed before 0006
-- Ensures participant_type exists before 0007-style constraint logic.

alter table if exists event_participants
  add column if not exists participant_type text not null default 'guest';

update event_participants
set participant_type = case
  when coalesce(player_profile_id, profile_id) is not null then 'member'
  else 'guest'
end
where participant_type is null
   or participant_type not in ('member', 'guest');

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
