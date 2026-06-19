-- Shared regular event video click tracking.
-- Stores only non-identifying click metadata; IP addresses, auth/session data, and share tokens are intentionally not stored.
create extension if not exists pgcrypto;

create table if not exists event_video_clicks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  round_id uuid references rounds(id) on delete set null,
  match_id uuid not null references matches(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  source text not null default 'share',
  user_agent text,
  referrer text,
  constraint event_video_clicks_source_check check (source in ('share'))
);

create index if not exists event_video_clicks_match_source_idx
  on event_video_clicks (match_id, source, clicked_at desc);

create index if not exists event_video_clicks_event_source_idx
  on event_video_clicks (event_id, source, clicked_at desc);

alter table event_video_clicks enable row level security;

revoke all on table event_video_clicks from anon, authenticated;
grant insert on table event_video_clicks to anon, authenticated;
grant select on table event_video_clicks to authenticated;

drop policy if exists "event_video_clicks_no_direct_select" on event_video_clicks;
create policy "event_video_clicks_no_direct_select"
  on event_video_clicks for select to authenticated
  using (false);

drop policy if exists "event_video_clicks_no_direct_insert" on event_video_clicks;
create policy "event_video_clicks_no_direct_insert"
  on event_video_clicks for insert to anon, authenticated
  with check (false);

create or replace function record_event_video_click(
  match_id uuid,
  user_agent text default null,
  referrer text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_match record;
begin
  select
    m.id as match_id,
    m.event_id,
    m.round_id
  into target_match
  from matches m
  join events e on e.id = m.event_id
  where m.id = match_id
    and m.youtube_url is not null
    and m.youtube_url <> ''
    and e.status = 'closed'
    and e.share_enabled = true
    and e.share_token is not null
    and coalesce(e.is_deleted, false) = false
  limit 1;

  if not found then
    return;
  end if;

  insert into event_video_clicks (
    event_id,
    round_id,
    match_id,
    source,
    user_agent,
    referrer
  ) values (
    target_match.event_id,
    target_match.round_id,
    target_match.match_id,
    'share',
    nullif(left(user_agent, 500), ''),
    nullif(left(referrer, 500), '')
  );
end;
$$;

create or replace function get_event_video_click_counts(p_event_id uuid)
returns table (match_id uuid, click_count bigint)
language sql
security definer
set search_path = public
as $$
  select evc.match_id, count(*)::bigint as click_count
  from event_video_clicks evc
  join events e on e.id = evc.event_id
  where evc.event_id = p_event_id
    and evc.source = 'share'
    and coalesce(e.is_deleted, false) = false
    and (
      exists (
        select 1
        from app_admins aa
        where aa.profile_id = auth.uid()
          and aa.is_active = true
      )
      or (
        e.club_id is null
        and e.created_by_auth_user_id = auth.uid()
      )
      or exists (
        select 1
        from club_members cm
        join player_profiles pp on pp.id = cm.player_profile_id
        where cm.club_id = e.club_id
          and cm.role = 'main_admin'
          and cm.is_active = true
          and pp.linked_auth_user_id = auth.uid()
      )
      or exists (
        select 1
        from club_members cm
        where cm.club_id = e.club_id
          and cm.role = 'main_admin'
          and cm.is_active = true
          and cm.profile_id = auth.uid()
      )
    )
  group by evc.match_id;
$$;

grant execute on function record_event_video_click(uuid, text, text) to anon, authenticated;
grant execute on function get_event_video_click_counts(uuid) to authenticated;
