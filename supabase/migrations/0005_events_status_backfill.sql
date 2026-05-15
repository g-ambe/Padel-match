-- Backfill migration for environments missing event close columns
alter table if exists events
  add column if not exists status text not null default 'active';

-- Ensure allowed values for status
alter table if exists events
  drop constraint if exists events_status_check;
alter table if exists events
  add constraint events_status_check check (status in ('active', 'closed'));

alter table if exists events
  add column if not exists closed_at timestamptz;
