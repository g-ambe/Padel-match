-- Add missing RLS policy for player_profiles so member names are readable from client.

alter table if exists player_profiles enable row level security;

-- Development-friendly policy aligned with existing profiles policy.
drop policy if exists dev_all_player_profiles on player_profiles;
create policy dev_all_player_profiles
on player_profiles
for all
to anon, authenticated
using (true)
with check (true);

grant select on table player_profiles to anon, authenticated;
