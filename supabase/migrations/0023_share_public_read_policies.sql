-- 共有リンク閲覧用の匿名SELECT制御

drop policy if exists events_share_public_select on events;
create policy events_share_public_select
on events
for select
to anon
using (
  share_enabled = true
  and share_token is not null
  and status = 'closed'
  and coalesce(is_deleted, false) = false
);

drop policy if exists clubs_share_public_select on clubs;
create policy clubs_share_public_select
on clubs
for select
to anon
using (
  coalesce(is_active, false) = true
);

drop policy if exists event_participants_share_public_select on event_participants;
create policy event_participants_share_public_select
on event_participants
for select
to anon
using (
  exists (
    select 1 from events e
    where e.id = event_participants.event_id
      and e.share_enabled = true
      and e.share_token is not null
      and e.status = 'closed'
      and coalesce(e.is_deleted, false) = false
  )
);

drop policy if exists rounds_share_public_select on rounds;
create policy rounds_share_public_select
on rounds
for select
to anon
using (
  exists (
    select 1 from events e
    where e.id = rounds.event_id
      and e.share_enabled = true
      and e.share_token is not null
      and e.status = 'closed'
      and coalesce(e.is_deleted, false) = false
  )
);

drop policy if exists matches_share_public_select on matches;
create policy matches_share_public_select
on matches
for select
to anon
using (
  exists (
    select 1 from events e
    where e.id = matches.event_id
      and e.share_enabled = true
      and e.share_token is not null
      and e.status = 'closed'
      and coalesce(e.is_deleted, false) = false
  )
);

drop policy if exists match_players_share_public_select on match_players;
create policy match_players_share_public_select
on match_players
for select
to anon
using (
  exists (
    select 1
    from matches m
    join events e on e.id = m.event_id
    where m.id = match_players.match_id
      and e.share_enabled = true
      and e.share_token is not null
      and e.status = 'closed'
      and coalesce(e.is_deleted, false) = false
  )
);

drop policy if exists match_results_share_public_select on match_results;
create policy match_results_share_public_select
on match_results
for select
to anon
using (
  exists (
    select 1
    from matches m
    join events e on e.id = m.event_id
    where m.id = match_results.match_id
      and e.share_enabled = true
      and e.share_token is not null
      and e.status = 'closed'
      and coalesce(e.is_deleted, false) = false
  )
);
