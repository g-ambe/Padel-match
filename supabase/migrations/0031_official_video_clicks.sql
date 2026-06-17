-- Official shared video click tracking.
-- Stores only non-identifying click metadata; IP addresses and auth/session data are intentionally not stored.
create extension if not exists pgcrypto;

create table if not exists official_video_clicks (
  id uuid primary key default gen_random_uuid(),
  official_event_id uuid not null references official_events(id) on delete cascade,
  official_opponent_id uuid references official_opponents(id) on delete cascade,
  official_match_id uuid not null references official_matches(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  source text not null default 'share',
  user_agent text,
  referrer text,
  constraint official_video_clicks_source_check check (source in ('share'))
);

create index if not exists official_video_clicks_match_source_idx
  on official_video_clicks (official_match_id, source, clicked_at desc);

alter table official_video_clicks enable row level security;

revoke all on table official_video_clicks from anon, authenticated;
grant insert on table official_video_clicks to anon, authenticated;
grant select on table official_video_clicks to authenticated;

drop policy if exists "official_video_clicks_no_direct_select" on official_video_clicks;
create policy "official_video_clicks_no_direct_select"
  on official_video_clicks for select to authenticated
  using (false);

drop policy if exists "official_video_clicks_no_direct_insert" on official_video_clicks;
create policy "official_video_clicks_no_direct_insert"
  on official_video_clicks for insert to anon, authenticated
  with check (false);

create or replace function record_official_video_click(
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
    om.id as official_match_id,
    om.official_event_id,
    om.official_opponent_id
  into target_match
  from official_matches om
  join official_events oe on oe.id = om.official_event_id
  where om.id = match_id
    and om.youtube_url is not null
    and om.youtube_url <> ''
    and oe.status = 'closed'
    and oe.share_enabled = true
    and oe.share_token is not null
    and coalesce(oe.is_deleted, false) = false
  limit 1;

  if not found then
    return;
  end if;

  insert into official_video_clicks (
    official_event_id,
    official_opponent_id,
    official_match_id,
    source,
    user_agent,
    referrer
  ) values (
    target_match.official_event_id,
    target_match.official_opponent_id,
    target_match.official_match_id,
    'share',
    nullif(left(user_agent, 500), ''),
    nullif(left(referrer, 500), '')
  );
end;
$$;

create or replace function get_official_video_click_counts(p_event_id uuid)
returns table (official_match_id uuid, click_count bigint)
language sql
security definer
set search_path = public
as $$
  select ovc.official_match_id, count(*)::bigint as click_count
  from official_video_clicks ovc
  join official_events oe on oe.id = ovc.official_event_id
  where ovc.official_event_id = p_event_id
    and ovc.source = 'share'
    and (
      exists (
        select 1
        from app_admins aa
        where aa.profile_id = auth.uid()
          and aa.is_active = true
      )
      or exists (
        select 1
        from club_members cm
        join player_profiles pp on pp.id = cm.player_profile_id
        where cm.club_id = oe.club_id
          and cm.role = 'main_admin'
          and cm.is_active = true
          and pp.linked_auth_user_id = auth.uid()
      )
      or exists (
        select 1
        from club_members cm
        where cm.club_id = oe.club_id
          and cm.role = 'main_admin'
          and cm.is_active = true
          and cm.profile_id = auth.uid()
      )
    )
  group by ovc.official_match_id;
$$;

grant execute on function record_official_video_click(uuid, text, text) to anon, authenticated;
grant execute on function get_official_video_click_counts(uuid) to authenticated;
