alter table if exists clubs
  add column if not exists visibility text not null default 'private';

alter table if exists clubs
  drop constraint if exists clubs_visibility_check;

alter table if exists clubs
  add constraint clubs_visibility_check check (visibility in ('private','public'));
