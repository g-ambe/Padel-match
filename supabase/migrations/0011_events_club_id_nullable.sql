-- Allow single-event creation without selecting a group
alter table if exists events
  alter column club_id drop not null;
