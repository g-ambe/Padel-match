alter table if exists events
  add column if not exists event_mode text not null default 'auto';

alter table if exists events
  add column if not exists stats_mode text not null default 'official';

update events
set event_mode = 'auto'
where event_mode is null or event_mode not in ('auto', 'manual');

update events
set stats_mode = 'official'
where stats_mode is null or stats_mode not in ('official', 'record_only', 'undecided');

alter table if exists events
  drop constraint if exists events_event_mode_check;

alter table if exists events
  add constraint events_event_mode_check check (event_mode in ('auto', 'manual'));

alter table if exists events
  drop constraint if exists events_stats_mode_check;

alter table if exists events
  add constraint events_stats_mode_check check (stats_mode in ('official', 'record_only', 'undecided'));
