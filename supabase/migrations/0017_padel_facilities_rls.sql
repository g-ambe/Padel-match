alter table if exists padel_facilities enable row level security;

drop policy if exists dev_all_padel_facilities on padel_facilities;
create policy dev_all_padel_facilities
on padel_facilities
for select
to anon, authenticated
using (true);

grant select on table padel_facilities to anon, authenticated;
