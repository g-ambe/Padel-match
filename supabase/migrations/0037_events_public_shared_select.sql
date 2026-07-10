-- Allow anonymous users to open closed friendly match share links.
-- This policy intentionally does not reference events from inside an events policy,
-- and it does not depend on club_members, to avoid RLS recursion.

grant select on table events to anon;

drop policy if exists "events_public_shared_select" on events;
create policy "events_public_shared_select"
  on events for select to anon
  using (
    status = 'closed'
    and share_enabled = true
    and share_token is not null
    and coalesce(is_deleted, false) = false
  );
