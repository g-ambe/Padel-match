-- Event-level shared video links for friendly matches.
-- Click metadata intentionally excludes IP address, auth/session data, email, and share tokens.
create extension if not exists pgcrypto;

create table if not exists event_video_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  title text not null default '全試合動画',
  video_url text,
  memo text,
  display_order int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_video_links_event_order_idx
  on event_video_links (event_id, display_order, created_at);

create table if not exists event_video_link_clicks (
  id uuid primary key default gen_random_uuid(),
  event_video_link_id uuid not null references event_video_links(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  source text not null default 'share',
  user_agent text,
  referrer text,
  constraint event_video_link_clicks_source_check check (source in ('share'))
);

create index if not exists event_video_link_clicks_link_source_idx
  on event_video_link_clicks (event_video_link_id, source, clicked_at desc);

create index if not exists event_video_link_clicks_event_source_idx
  on event_video_link_clicks (event_id, source, clicked_at desc);

alter table event_video_links enable row level security;
alter table event_video_link_clicks enable row level security;

grant select, insert, update, delete on table event_video_links to authenticated;
grant select on table event_video_links to anon;

drop policy if exists "event_video_links_shared_select" on event_video_links;
create policy "event_video_links_shared_select"
  on event_video_links for select to anon
  using (
    video_url is not null
    and btrim(video_url) <> ''
    and exists (
      select 1 from events e
      where e.id = event_video_links.event_id
        and e.status = 'closed'
        and e.share_enabled = true
        and e.share_token is not null
        and coalesce(e.is_deleted, false) = false
    )
  );

drop policy if exists "event_video_links_authenticated_select" on event_video_links;
create policy "event_video_links_authenticated_select"
  on event_video_links for select to authenticated
  using (
    exists (select 1 from events e where e.id = event_video_links.event_id and coalesce(e.is_deleted, false) = false)
  );

drop policy if exists "event_video_links_manage" on event_video_links;
create policy "event_video_links_manage"
  on event_video_links for all to authenticated
  using (
    exists (
      select 1 from events e
      where e.id = event_video_links.event_id
        and coalesce(e.is_deleted, false) = false
        and (
          exists (select 1 from app_admins aa where aa.profile_id = auth.uid() and aa.is_active = true)
          or (e.club_id is null and e.created_by_auth_user_id = auth.uid())
          or exists (select 1 from club_members cm join player_profiles pp on pp.id = cm.player_profile_id where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and pp.linked_auth_user_id = auth.uid())
          or exists (select 1 from club_members cm where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and cm.profile_id = auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from events e
      where e.id = event_video_links.event_id
        and coalesce(e.is_deleted, false) = false
        and (
          exists (select 1 from app_admins aa where aa.profile_id = auth.uid() and aa.is_active = true)
          or (e.club_id is null and e.created_by_auth_user_id = auth.uid())
          or exists (select 1 from club_members cm join player_profiles pp on pp.id = cm.player_profile_id where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and pp.linked_auth_user_id = auth.uid())
          or exists (select 1 from club_members cm where cm.club_id = e.club_id and cm.role in ('main_admin','sub_admin') and cm.is_active = true and cm.profile_id = auth.uid())
        )
    )
  );

revoke all on table event_video_link_clicks from anon, authenticated;
grant insert on table event_video_link_clicks to anon, authenticated;
grant select on table event_video_link_clicks to authenticated;

drop policy if exists "event_video_link_clicks_no_direct_select" on event_video_link_clicks;
create policy "event_video_link_clicks_no_direct_select"
  on event_video_link_clicks for select to authenticated
  using (false);

drop policy if exists "event_video_link_clicks_no_direct_insert" on event_video_link_clicks;
create policy "event_video_link_clicks_no_direct_insert"
  on event_video_link_clicks for insert to anon, authenticated
  with check (false);

create or replace function record_event_video_link_click(
  video_link_id uuid,
  user_agent text default null,
  referrer text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_link record;
begin
  select evl.id as event_video_link_id, evl.event_id
  into target_link
  from event_video_links evl
  join events e on e.id = evl.event_id
  where evl.id = video_link_id
    and evl.video_url is not null
    and btrim(evl.video_url) <> ''
    and e.status = 'closed'
    and e.share_enabled = true
    and e.share_token is not null
    and coalesce(e.is_deleted, false) = false
  limit 1;

  if not found then
    return;
  end if;

  insert into event_video_link_clicks (event_video_link_id, event_id, source, user_agent, referrer)
  values (target_link.event_video_link_id, target_link.event_id, 'share', nullif(left(user_agent, 500), ''), nullif(left(referrer, 500), ''));
end;
$$;

create or replace function get_event_video_link_click_counts(p_event_id uuid)
returns table (event_video_link_id uuid, click_count bigint)
language sql
security definer
set search_path = public
as $$
  select evlc.event_video_link_id, count(*)::bigint as click_count
  from event_video_link_clicks evlc
  join events e on e.id = evlc.event_id
  where evlc.event_id = p_event_id
    and evlc.source = 'share'
    and coalesce(e.is_deleted, false) = false
    and (
      exists (select 1 from app_admins aa where aa.profile_id = auth.uid() and aa.is_active = true)
      or (e.club_id is null and e.created_by_auth_user_id = auth.uid())
      or exists (
        select 1 from club_members cm join player_profiles pp on pp.id = cm.player_profile_id
        where cm.club_id = e.club_id and cm.role = 'main_admin' and cm.is_active = true and pp.linked_auth_user_id = auth.uid()
      )
      or exists (
        select 1 from club_members cm
        where cm.club_id = e.club_id and cm.role = 'main_admin' and cm.is_active = true and cm.profile_id = auth.uid()
      )
    )
  group by evlc.event_video_link_id;
$$;

grant execute on function record_event_video_link_click(uuid, text, text) to anon, authenticated;
grant execute on function get_event_video_link_click_counts(uuid) to authenticated;
