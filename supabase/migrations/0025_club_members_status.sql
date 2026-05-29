-- Track group-member lifecycle explicitly so new event participant candidates
-- can require status = 'active' in addition to the existing is_active flag.
alter table if exists club_members
  add column if not exists status text default 'active';

update club_members
set status = case when is_active then 'active' else coalesce(status, 'inactive') end
where status is null;

alter table if exists club_members
  alter column status set default 'active',
  alter column status set not null;

create index if not exists club_members_active_candidates_idx
  on club_members (club_id, status, is_active, player_profile_id);
