alter table if exists events
  add column if not exists status text not null default 'active' check (status in ('active', 'closed'));

alter table if exists events
  add column if not exists closed_at timestamptz;
