-- Phase 2: official opponents and match cards. Existing event data is unchanged.
create table if not exists official_opponents (
  id uuid primary key default gen_random_uuid(),
  official_event_id uuid not null references official_events(id) on delete cascade,
  opponent_team_name text not null,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists official_matches (
  id uuid primary key default gen_random_uuid(),
  official_event_id uuid not null references official_events(id) on delete cascade,
  official_opponent_id uuid not null references official_opponents(id) on delete cascade,
  match_order int not null,
  our_player1_profile_id uuid,
  our_player2_profile_id uuid,
  our_player1_guest_name text,
  our_player2_guest_name text,
  opponent_player1_name text,
  opponent_player2_name text,
  our_score int,
  opponent_score int,
  result text not null default 'undecided' check (result in ('win','lose','draw','undecided')),
  score_detail text,
  memo text,
  youtube_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint official_matches_scores_non_negative check ((our_score is null or our_score >= 0) and (opponent_score is null or opponent_score >= 0)),
  constraint official_matches_order_positive check (match_order > 0)
);

create index if not exists official_opponents_event_idx on official_opponents (official_event_id, created_at);
create index if not exists official_matches_opponent_idx on official_matches (official_opponent_id, match_order);
create unique index if not exists official_matches_opponent_order_unique on official_matches (official_opponent_id, match_order);

alter table official_opponents enable row level security;
alter table official_matches enable row level security;

create policy "official_opponents_select"
  on official_opponents for select to authenticated
  using (
    exists (
      select 1 from official_events oe
      where oe.id = official_opponents.official_event_id
        and (
          exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
          or exists (
            select 1 from club_members cm
            join player_profiles pp on pp.id = cm.player_profile_id
            where cm.club_id = oe.club_id and pp.linked_auth_user_id = auth.uid()
              and cm.is_active = true and cm.status = 'active'
          )
          or exists (
            select 1 from club_members cm
            where cm.club_id = oe.club_id and cm.profile_id = auth.uid()
              and cm.is_active = true and cm.status = 'active'
          )
        )
    )
  );

create policy "official_opponents_insert"
  on official_opponents for insert to authenticated
  with check (
    exists (
      select 1 from official_events oe
      where oe.id = official_opponents.official_event_id and oe.status <> 'closed'
        and (
          exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
          or exists (
            select 1 from club_members cm
            join player_profiles pp on pp.id = cm.player_profile_id
            where cm.club_id = oe.club_id and pp.linked_auth_user_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
          or exists (
            select 1 from club_members cm
            where cm.club_id = oe.club_id and cm.profile_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
        )
    )
  );

create policy "official_opponents_update"
  on official_opponents for update to authenticated
  using (
    exists (
      select 1 from official_events oe
      where oe.id = official_opponents.official_event_id and oe.status <> 'closed'
        and (
          exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
          or exists (
            select 1 from club_members cm
            join player_profiles pp on pp.id = cm.player_profile_id
            where cm.club_id = oe.club_id and pp.linked_auth_user_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
          or exists (
            select 1 from club_members cm
            where cm.club_id = oe.club_id and cm.profile_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
        )
    )
  )
  with check (
    exists (
      select 1 from official_events oe
      where oe.id = official_opponents.official_event_id and oe.status <> 'closed'
        and (
          exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
          or exists (
            select 1 from club_members cm
            join player_profiles pp on pp.id = cm.player_profile_id
            where cm.club_id = oe.club_id and pp.linked_auth_user_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
          or exists (
            select 1 from club_members cm
            where cm.club_id = oe.club_id and cm.profile_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
        )
    )
  );

create policy "official_matches_select"
  on official_matches for select to authenticated
  using (
    exists (
      select 1 from official_events oe
      where oe.id = official_matches.official_event_id
        and (
          exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
          or exists (
            select 1 from club_members cm
            join player_profiles pp on pp.id = cm.player_profile_id
            where cm.club_id = oe.club_id and pp.linked_auth_user_id = auth.uid()
              and cm.is_active = true and cm.status = 'active'
          )
          or exists (
            select 1 from club_members cm
            where cm.club_id = oe.club_id and cm.profile_id = auth.uid()
              and cm.is_active = true and cm.status = 'active'
          )
        )
    )
  );

create policy "official_matches_insert"
  on official_matches for insert to authenticated
  with check (
    exists (
      select 1 from official_events oe
      join official_opponents oo on oo.official_event_id = oe.id
      where oe.id = official_matches.official_event_id
        and oo.id = official_matches.official_opponent_id
        and oe.status <> 'closed'
        and (
          exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
          or exists (
            select 1 from club_members cm
            join player_profiles pp on pp.id = cm.player_profile_id
            where cm.club_id = oe.club_id and pp.linked_auth_user_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
          or exists (
            select 1 from club_members cm
            where cm.club_id = oe.club_id and cm.profile_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
        )
    )
  );

create policy "official_matches_update"
  on official_matches for update to authenticated
  using (
    exists (
      select 1 from official_events oe
      where oe.id = official_matches.official_event_id and oe.status <> 'closed'
        and (
          exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
          or exists (
            select 1 from club_members cm
            join player_profiles pp on pp.id = cm.player_profile_id
            where cm.club_id = oe.club_id and pp.linked_auth_user_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
          or exists (
            select 1 from club_members cm
            where cm.club_id = oe.club_id and cm.profile_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
        )
    )
  )
  with check (
    exists (
      select 1 from official_events oe
      where oe.id = official_matches.official_event_id and oe.status <> 'closed'
        and (
          exists (select 1 from app_admins where profile_id = auth.uid() and is_active = true)
          or exists (
            select 1 from club_members cm
            join player_profiles pp on pp.id = cm.player_profile_id
            where cm.club_id = oe.club_id and pp.linked_auth_user_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
          or exists (
            select 1 from club_members cm
            where cm.club_id = oe.club_id and cm.profile_id = auth.uid()
              and cm.is_active = true and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
          )
        )
    )
  );
