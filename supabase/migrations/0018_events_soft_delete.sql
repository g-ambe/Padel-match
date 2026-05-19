alter table if exists events add column if not exists is_deleted boolean not null default false;
alter table if exists events add column if not exists deleted_at timestamptz;
