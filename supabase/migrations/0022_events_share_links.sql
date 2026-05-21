alter table if exists events add column if not exists share_enabled boolean not null default false;
alter table if exists events add column if not exists share_token text;
alter table if exists events add column if not exists share_token_updated_at timestamptz;

create unique index if not exists events_share_token_unique_idx on events(share_token) where share_token is not null;
