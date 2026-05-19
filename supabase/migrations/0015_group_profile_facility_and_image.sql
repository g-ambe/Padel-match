create table if not exists padel_facilities (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  prefecture text,
  address text,
  source_url text,
  created_at timestamptz not null default now(),
  unique(name)
);

alter table if exists clubs add column if not exists main_facility_id uuid references padel_facilities(id);
alter table if exists clubs add column if not exists image_url text;
