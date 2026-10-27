-- PR-A/P0。手動適用専用。本番への自動適用は行わない。
-- 既存データを更新せず、権限と新しい書き込みの整合性だけを変更する。
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- 0039の本人承認・所属権限の保護がない環境には適用しない。
do $$ begin
  if to_regprocedure('profile_link_private.club_role(uuid,uuid)') is null
    or to_regprocedure('public.can_edit_player_profile_member(uuid,text)') is null
    or not exists (select 1 from pg_trigger where tgrelid = 'public.clubs'::regclass and tgname = 'profile_link_club_owner' and tgenabled <> 'D')
    or not exists (select 1 from pg_trigger where tgrelid = 'public.player_profiles'::regclass and tgname = 'profile_link_identity' and tgenabled <> 'D') then
    raise exception '0039の本人承認・所属権限保護を確認できません。適用を中止します';
  end if;
  if exists (select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then
    raise exception 'APIロールがRLSを迂回できるため適用を中止します';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_members' and policyname = 'club_members_update'
      and qual like '%can_edit_player_profile_member%' and with_check like '%can_edit_player_profile_member%')
    or has_column_privilege('authenticated','public.club_members','club_id','UPDATE')
    or has_column_privilege('authenticated','public.club_members','profile_id','UPDATE')
    or has_column_privilege('authenticated','public.club_members','player_profile_id','UPDATE')
    or has_column_privilege('authenticated','public.player_profiles','linked_auth_user_id','UPDATE')
    or has_table_privilege('authenticated','public.app_admins','INSERT,UPDATE,DELETE') then
    raise exception '0039の所属・連携・管理者権限の保護に差分があります。適用を中止します';
  end if;
end $$;

-- profile_idには旧アカウントIDと選手IDの両形式がある。
-- アカウント専用FKは新規の選手IDを拒否するため、所属検証と削除triggerで保護する。
-- 行の移管・再集計は行わない。未知のFK構成なら適用を中止する。
do $$ declare constraint_row record; begin
  for constraint_row in
    select c.* from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attname='profile_id'
    where c.conrelid='public.player_stats'::regclass and c.contype='f' and a.attnum=any(c.conkey)
  loop
    if constraint_row.confrelid <> 'public.profiles'::regclass
      or array_length(constraint_row.conkey,1) <> 1
      or constraint_row.confdeltype <> 'c' or constraint_row.confupdtype <> 'a' then
      raise exception '戦績の選手ID外部キーが想定と異なります。個別確認が必要です';
    end if;
    execute format('alter table public.player_stats drop constraint %I',constraint_row.conname);
  end loop;
end $$;

create schema if not exists security_private;
revoke all on schema security_private from public, anon, authenticated;
grant usage on schema security_private to authenticated;
revoke create on schema public from public, anon, authenticated;

-- 呼出者IDを引数として受け取らず、DB内の所属を参照する。
-- 非公開関数に限定したSECURITY DEFINERでRLSの循環参照を避ける。
-- 既存の管理者判定を維持し、メール特例の撤去は権限移管後の別PRとする。
create or replace function security_private.actor_super() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and coalesce(profile_link_private.club_role(null, auth.uid()) = 'super_user', false);
$$;

create or replace function security_private.club_role(p_club uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null
    when security_private.actor_super() then 'super_user'
    when exists (select 1 from public.clubs c where c.id = p_club and c.is_active and not c.is_deleted)
      then profile_link_private.club_role(p_club, auth.uid())
    else null end;
$$;

create or replace function security_private.event_role(p_event uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null
    when security_private.actor_super() then 'super_user'
    when e.is_deleted or (e.club_id is not null and not exists (
      select 1 from public.clubs c where c.id = e.club_id and c.is_active and not c.is_deleted
    )) then null
    when (e.club_id is null or e.event_mode = 'team') and e.created_by_auth_user_id = auth.uid() then 'creator'
    when security_private.club_role(e.club_id) is not null then security_private.club_role(e.club_id)
    when e.event_mode = 'team' then (
      select security_private.club_role(s.club_id) from public.event_team_sides s
      where s.event_id = e.id and security_private.club_role(s.club_id) is not null
      order by case security_private.club_role(s.club_id) when 'main_admin' then 0 when 'sub_admin' then 1 else 2 end
      limit 1
    ) else null end
  from public.events e where e.id = p_event;
$$;

create or replace function security_private.can_read_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(security_private.event_role(p_event) is not null, false);
$$;

-- 通常・手動イベントは有効メンバーの運営操作を維持する。
-- チーム戦は従来どおり作成者または管理者だけが運営する。
create or replace function security_private.can_operate_event(p_event uuid, p_active boolean default true) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(not e.is_deleted
    and (not p_active or e.status = 'active')
    and case when e.event_mode = 'team'
      then security_private.event_role(e.id) in ('super_user','creator','main_admin','sub_admin')
      else security_private.event_role(e.id) is not null end, false)
  from public.events e where e.id = p_event;
$$;

create or replace function security_private.can_manage_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(security_private.event_role(p_event) in ('super_user','creator','main_admin','sub_admin'), false);
$$;

create or replace function security_private.can_delete_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(security_private.actor_super() or (e.status = 'closed' and (
    security_private.event_role(e.id) in ('creator','main_admin')
    or (e.event_mode = 'team' and security_private.event_role(e.id) = 'sub_admin')
  )), false) from public.events e where e.id = p_event;
$$;

create or replace function security_private.valid_stats_profile(p_club uuid, p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and security_private.club_role(p_club) is not null
    and p_club is not null and p_profile is not null and exists (
    select 1 from public.club_members cm left join public.player_profiles pp on pp.id = cm.player_profile_id
    where cm.club_id = p_club and cm.is_active
      and (cm.player_profile_id is null or pp.is_active)
      and (cm.profile_id = p_profile or cm.player_profile_id = p_profile or pp.linked_auth_user_id = p_profile)
  );
$$;

-- グループ変更には変更元・変更先それぞれの管理権限が必要。
-- 既存サイドを非公開関数から確認し、UPDATEポリシーの循環参照を避ける。
create or replace function security_private.can_update_team_side(p_side uuid, p_event uuid, p_club uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and security_private.can_operate_event(p_event) and exists (
    select 1 from public.event_team_sides previous_side
    where previous_side.id=p_side and previous_side.event_id=p_event
      and (previous_side.club_id is not distinct from p_club or (
        (previous_side.club_id is null or security_private.club_role(previous_side.club_id) in ('super_user','main_admin','sub_admin'))
        and (p_club is null or security_private.club_role(p_club) in ('super_user','main_admin','sub_admin'))
      ))
  );
$$;

-- 旧FKのアカウント削除時の連動削除を維持し、選手ID形式も同様に保護する。
-- APIには公開しない。親行を削除できる既存の信頼済み処理からだけ実行される。
create or replace function security_private.delete_stats_for_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.player_stats where profile_id=old.id;
  return old;
end $$;
drop trigger if exists security_p0_stats_identity_delete on public.profiles;
create trigger security_p0_stats_identity_delete after delete on public.profiles
  for each row execute function security_private.delete_stats_for_identity();
drop trigger if exists security_p0_stats_identity_delete on public.player_profiles;
create trigger security_p0_stats_identity_delete after delete on public.player_profiles
  for each row execute function security_private.delete_stats_for_identity();

-- 行の移動や作成者の変更を拒否し、イベントの列ごとの操作権限を守る。
create or replace function security_private.guard_event() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- 本人承認済みの0039など、既存の権限付き処理による参照修正は妨げない。
  if current_user not in ('anon','authenticated') then return new; end if;
  if tg_op = 'INSERT' then
    if new.created_by_auth_user_id is distinct from auth.uid() or new.status <> 'active' or new.is_deleted or new.share_enabled or new.share_token is not null then
      raise exception '作成者・イベント初期状態を確認してください' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id or new.club_id is distinct from old.club_id
    or new.created_by_auth_user_id is distinct from old.created_by_auth_user_id
    or new.created_at is distinct from old.created_at then
    raise exception 'イベントの所属・作成者・識別情報は変更できません' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status','closed_at','stats_mode','updated_at']) is distinct from
     (to_jsonb(old) - array['status','closed_at','stats_mode','updated_at'])
    and not security_private.can_manage_event(old.id) then
    raise exception 'イベント設定を変更する権限がありません' using errcode = '42501';
  end if;
  if (new.is_deleted is distinct from old.is_deleted or new.deleted_at is distinct from old.deleted_at)
    and not security_private.can_delete_event(old.id) then
    raise exception '終了済みイベントを削除する権限がありません' using errcode = '42501';
  end if;
  if new.share_enabled and (new.status <> 'closed' or new.is_deleted or nullif(btrim(new.share_token), '') is null)
    and (new.share_enabled is distinct from old.share_enabled or new.share_token is distinct from old.share_token) then
    raise exception '共有は終了済みの有効なイベントで設定してください' using errcode = '42501';
  end if;
  return new;
end $$;

-- 既存の不整合行は改変しない。新しい参照と親の変更だけを検査する。
create or replace function security_private.guard_parentage() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare k text; parent_event uuid; participant_event uuid; event_club uuid; event_state text;
begin
  if current_user not in ('anon','authenticated') then return new; end if;
  if tg_op = 'UPDATE' then
    foreach k in array tg_argv loop
      if (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) then
        raise exception '所属するイベント・試合・識別情報は変更できません' using errcode = '42501';
      end if;
    end loop;
  end if;
  if tg_table_name = 'matches' then
    select status into event_state from public.events where id = new.event_id;
    if tg_op = 'UPDATE' and event_state = 'closed' then
      if (to_jsonb(new) - 'youtube_url') is distinct from (to_jsonb(old) - 'youtube_url') then
        raise exception '終了済み試合では動画リンクだけを変更できます' using errcode = '42501';
      end if;
      return new;
    end if;
    if tg_op = 'INSERT' or new.round_id is distinct from old.round_id then
      select event_id into parent_event from public.rounds where id = new.round_id for share;
      if parent_event is null or parent_event is distinct from new.event_id then
        raise exception 'Roundと試合のイベントが一致しません' using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'match_players' then
    if tg_op = 'INSERT' or new.participant_id is distinct from old.participant_id then
      select event_id into parent_event from public.matches where id = new.match_id for share;
      select event_id into participant_event from public.event_participants where id = new.participant_id for share;
      if parent_event is null or participant_event is distinct from parent_event then
        raise exception '試合と選手のイベントが一致しません' using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'event_participants' then
    if tg_op = 'INSERT' or new.player_profile_id is distinct from old.player_profile_id or new.profile_id is distinct from old.profile_id then
      select club_id into event_club from public.events where id = new.event_id for share;
      if new.participant_type = 'guest' and (new.player_profile_id is not null or new.profile_id is not null) then
        raise exception 'ゲストにはアカウント・選手の内部IDを指定できません' using errcode = '23514';
      end if;
      if new.participant_type = 'member' and event_club is not null and not exists (
        select 1 from public.club_members cm
        where cm.club_id = event_club and cm.is_active
          and ((new.player_profile_id is not null and cm.player_profile_id = new.player_profile_id)
            or (cm.player_profile_id is null and cm.profile_id = new.player_profile_id)
            or (new.player_profile_id is null and cm.profile_id = new.profile_id))
      ) then
        raise exception '参加者は対象グループの有効なメンバーである必要があります' using errcode = '23514';
      end if;
      if new.player_profile_id is not null and new.profile_id is not null and not exists (
        select 1 from public.player_profiles pp where pp.id = new.player_profile_id and pp.linked_auth_user_id = new.profile_id
      ) then
        raise exception '選手プロフィールとアカウントが一致しません' using errcode = '23514';
      end if;
      if new.participant_type = 'member' and event_club is null
        and not (new.player_profile_id is null and new.profile_id = auth.uid()) and not exists (
        select 1 from public.player_profiles pp where pp.id = new.player_profile_id and pp.is_active and pp.linked_auth_user_id = auth.uid()
      ) then
        raise exception '個人イベントの選手は本人プロフィールで登録してください' using errcode = '23514';
      end if;
    end if;
  elsif tg_table_name = 'player_stats' then
    if not security_private.valid_stats_profile(new.club_id, new.profile_id) then
      raise exception '集計対象のグループと選手が一致しません' using errcode = '23514';
    end if;
  elsif tg_table_name = 'event_team_sides' and tg_op = 'UPDATE' then
    if not security_private.can_update_team_side(old.id, new.event_id, new.club_id) then
      raise exception '所属変更には変更元と変更先のグループ管理権限が必要です' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists security_p0_event on public.events;
create trigger security_p0_event before insert or update on public.events for each row execute function security_private.guard_event();
do $$ declare t text; args text; begin
  foreach t in array array['clubs','event_participants','rounds','matches','match_players','match_results','player_stats','event_team_sides'] loop
    args := case t
      when 'clubs' then '''id'',''owner_id'',''created_at'''
      when 'event_participants' then '''id'',''event_id'',''created_at'''
      when 'rounds' then '''id'',''event_id'',''created_at'''
      when 'matches' then '''id'',''event_id'',''round_id'',''created_at'''
      when 'match_players' then '''id'',''match_id'',''created_at'''
      when 'match_results' then '''id'',''match_id'',''created_at'''
      when 'player_stats' then '''id'',''club_id'',''profile_id'',''created_at'''
      when 'event_team_sides' then '''id'',''event_id'',''side'',''created_at'''
      else '''id'',''event_id'',''created_at''' end;
    execute format('drop trigger if exists security_p0_parentage on public.%I',t);
    execute format('create trigger security_p0_parentage before insert or update on public.%I for each row execute function security_private.guard_parentage(%s)',t,args);
  end loop;
end $$;

-- 本番に緊急適用済みの匿名テーブル書き込み禁止を再現する。
-- 列単位のGRANTとPUBLICからの継承も撤回する。
do $$ declare t record; cols text; begin
  for t in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') loop
    execute format('revoke insert,update,delete,truncate,references,trigger on table public.%I from public,anon', t.relname);
    select string_agg(quote_ident(attname), ',') into cols from pg_attribute where attrelid = t.oid and attnum > 0 and not attisdropped;
    execute format('revoke insert(%s),update(%s),references(%s) on public.%I from public,anon',cols,cols,cols,t.relname);
  end loop;
end $$;
drop policy if exists official_events_access on public.official_events;
drop policy if exists official_matches_access on public.official_matches;
drop policy if exists official_opponents_access on public.official_opponents;

-- 旧許可ポリシーがORで残ることを避け、対象表を各操作の明示ポリシーに置き換える。
-- team_sidesは偽所属のINSERTがイベント権限に直結するためP0の依存対策に含める。
do $$ declare p record; t text; cols text; begin
  for p in select tablename,policyname from pg_policies where schemaname = 'public'
    and tablename in ('clubs','events','event_participants','rounds','matches','match_players','match_results','player_stats','event_team_sides') loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
  foreach t in array array['clubs','events','event_participants','rounds','matches','match_players','match_results','player_stats','event_team_sides'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    select string_agg(quote_ident(attname), ',') into cols from pg_attribute where attrelid = format('public.%I',t)::regclass and attnum > 0 and not attisdropped;
    execute format('revoke select(%s),insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated',cols,cols,cols,cols,t);
    execute format('grant select,insert,update,delete on table public.%I to authenticated',t);
  end loop;
end $$;

create policy security_p0_clubs_select on public.clubs for select to authenticated using (
  security_private.actor_super()
  or security_private.club_role(id) = 'main_admin'
  or (not is_deleted and is_active and (
    visibility = 'public' or owner_id = (select auth.uid()) or security_private.club_role(id) is not null
  ))
);
create policy security_p0_clubs_insert on public.clubs for insert to authenticated with check (
  owner_id = (select auth.uid()) and is_active and not is_deleted
);
create policy security_p0_clubs_update on public.clubs for update to authenticated
  using (security_private.club_role(id) in ('super_user','main_admin'))
  with check (security_private.club_role(id) in ('super_user','main_admin'));
create policy security_p0_clubs_delete on public.clubs for delete to authenticated
  using (security_private.club_role(id) in ('super_user','main_admin'));

create policy security_p0_events_select on public.events for select to authenticated using (security_private.can_read_event(id));
create policy security_p0_events_insert on public.events for insert to authenticated with check (
  created_by_auth_user_id = (select auth.uid()) and (club_id is null or security_private.club_role(club_id) is not null)
);
create policy security_p0_events_update on public.events for update to authenticated
  using (security_private.can_operate_event(id,false)) with check (security_private.can_operate_event(id,false));
create policy security_p0_events_delete on public.events for delete to authenticated using (security_private.can_delete_event(id));

create policy security_p0_participants_select on public.event_participants for select to authenticated using (security_private.can_read_event(event_id));
create policy security_p0_participants_insert on public.event_participants for insert to authenticated with check (security_private.can_operate_event(event_id));
create policy security_p0_participants_update on public.event_participants for update to authenticated
  using (security_private.can_operate_event(event_id)) with check (security_private.can_operate_event(event_id));
create policy security_p0_participants_delete on public.event_participants for delete to authenticated using (security_private.can_operate_event(event_id));

create policy security_p0_rounds_select on public.rounds for select to authenticated using (security_private.can_read_event(event_id));
create policy security_p0_rounds_insert on public.rounds for insert to authenticated with check (security_private.can_operate_event(event_id));
create policy security_p0_rounds_update on public.rounds for update to authenticated
  using (security_private.can_operate_event(event_id)) with check (security_private.can_operate_event(event_id));
create policy security_p0_rounds_delete on public.rounds for delete to authenticated using (security_private.can_operate_event(event_id));

create policy security_p0_matches_select on public.matches for select to authenticated using (security_private.can_read_event(event_id));
create policy security_p0_matches_insert on public.matches for insert to authenticated with check (security_private.can_operate_event(event_id));
-- 終了後の動画編集は維持し、guard_parentageで他列を拒否する。
create policy security_p0_matches_update on public.matches for update to authenticated
  using (security_private.can_operate_event(event_id,false)) with check (security_private.can_operate_event(event_id,false));
create policy security_p0_matches_delete on public.matches for delete to authenticated using (security_private.can_operate_event(event_id));

create policy security_p0_players_select on public.match_players for select to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and security_private.can_read_event(m.event_id))
);
create policy security_p0_players_insert on public.match_players for insert to authenticated with check (
  exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id))
);
create policy security_p0_players_update on public.match_players for update to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id)))
  with check (exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id)));
create policy security_p0_players_delete on public.match_players for delete to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id))
);

create policy security_p0_results_select on public.match_results for select to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and security_private.can_read_event(m.event_id))
);
create policy security_p0_results_insert on public.match_results for insert to authenticated with check (
  exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id))
);
create policy security_p0_results_update on public.match_results for update to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id)))
  with check (exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id)));
create policy security_p0_results_delete on public.match_results for delete to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id))
);

create policy security_p0_stats_select on public.player_stats for select to authenticated using (security_private.club_role(club_id) is not null);
create policy security_p0_stats_insert on public.player_stats for insert to authenticated with check (
  security_private.club_role(club_id) is not null and security_private.valid_stats_profile(club_id,profile_id)
);
create policy security_p0_stats_update on public.player_stats for update to authenticated
  using (security_private.valid_stats_profile(club_id,profile_id))
  with check (security_private.valid_stats_profile(club_id,profile_id));
create policy security_p0_stats_delete on public.player_stats for delete to authenticated using (security_private.club_role(club_id) is not null and club_id is not null);

create policy security_p0_team_sides_select on public.event_team_sides for select to authenticated using (security_private.can_read_event(event_id));
create policy security_p0_team_sides_insert on public.event_team_sides for insert to authenticated with check (
  security_private.can_operate_event(event_id) and exists (select 1 from public.events e where e.id = event_id and e.event_mode = 'team')
);
create policy security_p0_team_sides_update on public.event_team_sides for update to authenticated
  using (security_private.can_operate_event(event_id))
  with check (security_private.can_update_team_side(id,event_id,club_id));
-- 画面はサイドの更新を使う。削除→再登録による所属変更の迂回を許可しない。
-- イベント削除に伴うFKの連動削除は維持する。
create policy security_p0_team_sides_delete on public.event_team_sides for delete to authenticated using (false);

revoke all on all functions in schema security_private from public,anon,authenticated;
grant execute on function security_private.actor_super(), security_private.club_role(uuid), security_private.event_role(uuid),
  security_private.can_read_event(uuid), security_private.can_operate_event(uuid,boolean), security_private.can_manage_event(uuid),
  security_private.can_delete_event(uuid), security_private.valid_stats_profile(uuid,uuid),
  security_private.can_update_team_side(uuid,uuid,uuid) to authenticated;

-- 有効な共有トークンを提示した場合だけ、画面に必要な表示情報を返す。
-- 非公開スキーマの関数だけがRLSを越えて読み取り、公開RPCは呼出者権限で委譲する。
-- 匿名共有は認証IDでなくトークンを認可条件とし、内部の連携IDやトークン自体は返さない。
create or replace function security_private.get_shared_event_data(p_token text)
returns jsonb
language sql
stable
strict
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'event', pg_catalog.jsonb_build_object('name', e.name, 'created_at', e.created_at, 'event_mode', e.event_mode),
    'participants', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', ep.id,
        'display_name', coalesce(pp.display_name, p.display_name, ep.guest_name, 'ゲスト')
      ) order by ep.created_at, ep.id)
      from public.event_participants ep
      left join public.player_profiles pp on pp.id = ep.player_profile_id
      left join public.profiles p on p.id = ep.profile_id
      where ep.event_id = e.id
    ), '[]'::jsonb),
    'matches', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', m.id, 'court_number', m.court_number, 'completed', m.completed,
        'youtube_url', m.youtube_url, 'round_number', coalesce(r.round_number, 0),
        'match_players', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('participant_id', mp.participant_id, 'team', mp.team) order by mp.id)
          from public.match_players mp
          join public.event_participants ep on ep.id = mp.participant_id and ep.event_id = e.id
          where mp.match_id = m.id
        ), '[]'::jsonb),
        'result', (
          select pg_catalog.jsonb_build_object('score_a', mr.score_a, 'score_b', mr.score_b, 'winner_team', mr.winner_team)
          from public.match_results mr where mr.match_id = m.id order by mr.created_at, mr.id limit 1
        )
      ) order by m.created_at desc, m.id)
      from public.matches m
      left join public.rounds r on r.id = m.round_id and r.event_id = e.id
      where m.event_id = e.id
        and (m.round_id is null or r.id is not null)
    ), '[]'::jsonb),
    'team_sides', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('side', ets.side, 'team_name', ets.team_name) order by ets.side)
      from public.event_team_sides ets where ets.event_id = e.id and e.event_mode = 'team'
    ), '[]'::jsonb),
    'team_matches', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', etm.id,
        'team_a_player1_guest_name', coalesce(pa1.display_name, etm.team_a_player1_guest_name, '選手'),
        'team_a_player2_guest_name', coalesce(pa2.display_name, etm.team_a_player2_guest_name, '選手'),
        'team_b_player1_guest_name', coalesce(pb1.display_name, etm.team_b_player1_guest_name, '選手'),
        'team_b_player2_guest_name', coalesce(pb2.display_name, etm.team_b_player2_guest_name, '選手'),
        'team_a_score', etm.team_a_score, 'team_b_score', etm.team_b_score,
        'result', etm.result, 'score_detail', etm.score_detail, 'youtube_url', etm.youtube_url
      ) order by etm.match_order, etm.created_at, etm.id)
      from public.event_team_matches etm
      left join public.player_profiles pa1 on pa1.id = etm.team_a_player1_profile_id
      left join public.player_profiles pa2 on pa2.id = etm.team_a_player2_profile_id
      left join public.player_profiles pb1 on pb1.id = etm.team_b_player1_profile_id
      left join public.player_profiles pb2 on pb2.id = etm.team_b_player2_profile_id
      where etm.event_id = e.id and e.event_mode = 'team'
    ), '[]'::jsonb),
    'videos', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', evl.id, 'title', evl.title, 'video_url', pg_catalog.btrim(evl.video_url),
        'memo', evl.memo, 'display_order', evl.display_order
      ) order by evl.display_order, evl.created_at, evl.id)
      from public.event_video_links evl
      where evl.event_id = e.id and evl.video_url is not null and pg_catalog.btrim(evl.video_url) <> ''
    ), '[]'::jsonb)
  )
  from public.events e
  where pg_catalog.length(p_token) between 1 and 512
    and e.share_token = p_token
    and e.share_enabled = true
    and e.status = 'closed'
    and coalesce(e.is_deleted, false) = false
    and (e.club_id is null or exists (
      select 1 from public.clubs c
      where c.id = e.club_id and c.is_active = true and coalesce(c.is_deleted, false) = false
    ));
$$;

revoke all on function security_private.get_shared_event_data(text) from public, anon, authenticated;
grant usage on schema security_private to anon, authenticated;
grant execute on function security_private.get_shared_event_data(text) to anon, authenticated;

create or replace function public.get_shared_event(p_token text)
returns jsonb
language sql
stable
strict
security invoker
set search_path = ''
as $$
  select security_private.get_shared_event_data(p_token);
$$;

revoke all on function public.get_shared_event(text) from public, anon, authenticated;
grant execute on function public.get_shared_event(text) to anon, authenticated;

-- P0互換性対策。適用時の業務行補正は行わず、本人承認と画面操作だけを原子的に実行する。
create schema if not exists security_p0_history;
revoke all on schema security_p0_history from public,anon,authenticated;
create table if not exists security_p0_history.operations (
  request_id uuid primary key, actor uuid not null, event_id uuid not null,
  kind text not null, payload jsonb not null, result jsonb not null,
  before_state jsonb not null, after_state jsonb not null,
  created_at timestamptz not null default now(), restored_at timestamptz
);
revoke all on all tables in schema security_p0_history from public,anon,authenticated;

-- 在籍判定は既存UIと同じis_activeへ統一する。所属行のstatus値は変更しない。
do $$
declare signature text; function_oid oid; definition text; patched text; p record; expression text; condition text;
begin
  foreach signature in array array[
    'profile_link_private.club_role(uuid,uuid)',
    'profile_link_private.preview(uuid,uuid)',
    'profile_link_private.notify_admins(uuid,text,uuid,uuid,uuid)',
    'public.add_provisional_club_member(uuid,text,uuid)',
    'public.preview_profile_join(uuid,uuid)',
    'public.request_player_profile_link(uuid,uuid,uuid)',
    'public.review_player_profile_link(uuid,text,text)',
    'public.submit_profile_join_request(uuid,uuid,text,text)',
    'public.review_profile_join_request(uuid,text)'
  ] loop
    function_oid:=to_regprocedure(signature);
    if function_oid is null then continue; end if;
    definition:=pg_get_functiondef(function_oid);
    patched:=replace(definition, ' and cm.status = ''active''', '');
    patched:=replace(patched, ' and is_active and status = ''active''', ' and is_active');
    patched:=replace(patched, '''status'', cm.status', '''status'', case when cm.is_active then ''active'' else ''inactive'' end');
    patched:=replace(patched, 'club_members(club_id, player_profile_id, role, is_active, status)', 'club_members(club_id, player_profile_id, role, is_active)');
    patched:=replace(patched, 'club_members(club_id,player_profile_id,role,is_active,status)', 'club_members(club_id,player_profile_id,role,is_active)');
    patched:=replace(patched, 'values (p_club_id, p_operation_id, ''member'', true, ''active'')', 'values (p_club_id, p_operation_id, ''member'', true)');
    patched:=replace(patched, 'values (request.club_id,target,''member'',true,''active'')', 'values (request.club_id,target,''member'',true)');
    if patched<>definition then execute patched; end if;
  end loop;

  -- 対象は既存の公式イベント閲覧・登録ポリシーだけ。権限条件・役職条件は維持する。
  for p in select * from pg_policies where schemaname='public' and tablename='official_events' and policyname in ('official_events_select','official_events_insert') loop
    expression:='';
    if p.qual is not null then
      condition:=regexp_replace(p.qual, ' AND \(cm\.status = ''active''::text\)', '', 'g');
      expression:=expression||' using ('||condition||')';
    end if;
    if p.with_check is not null then
      condition:=regexp_replace(p.with_check, ' AND \(cm\.status = ''active''::text\)', '', 'g');
      expression:=expression||' with check ('||condition||')';
    end if;
    execute format('alter policy %I on public.official_events %s',p.policyname,expression);
  end loop;
  if exists (select 1 from pg_policies where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) like '%cm.status%') then
    raise exception '想定外の所属status参照がポリシーに残っています。01の結果で個別確認してください';
  end if;
end $$;

create or replace function security_private.player_id(p_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select p.id from public.player_profiles p where p.id=p_id or (p.linked_auth_user_id=p_id and p.is_active)
  order by (p.id=p_id) desc limit 1;
$$;

create or replace function security_private.event_snapshot(p_event uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'events',coalesce((select jsonb_agg(to_jsonb(e)) from public.events e where id=p_event),'[]'::jsonb),
    'event_participants',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.event_participants t where event_id=p_event),'[]'::jsonb),
    'rounds',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.rounds t where event_id=p_event),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.matches t where event_id=p_event),'[]'::jsonb),
    'match_players',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.match_players t join public.matches m on m.id=t.match_id where m.event_id=p_event),'[]'::jsonb),
    'match_results',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.match_results t join public.matches m on m.id=t.match_id where m.event_id=p_event),'[]'::jsonb),
    'player_stats',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.player_stats t where club_id=(select club_id from public.events where id=p_event)),'[]'::jsonb),
    'event_team_sides',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.event_team_sides t where event_id=p_event),'[]'::jsonb)
  );
$$;

-- 承認・操作で影響する選手だけを正本の試合から集計する。全件の自動補正はしない。
create or replace function security_private.refresh_stats(p_club uuid,p_players uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare who uuid; account_id uuid; stat_id uuid; totals record;
begin
  if p_club is null then return; end if;
  for who in select distinct x from unnest(p_players) x where x is not null loop
    select linked_auth_user_id into account_id from public.player_profiles where id=who;
    if (select count(*) from public.player_stats where club_id=p_club and profile_id in (who,account_id))>1 then
      raise exception '同じ選手の累計が複数形式で存在します。補正計画の承認が必要です';
    end if;
    select id into stat_id from public.player_stats where club_id=p_club and profile_id in (who,account_id) limit 1;
    select count(*)::int as played,count(*) filter(where won)::int as wins,count(*) filter(where lost)::int as losses into totals from (
      select distinct m.id,(mr.winner_team=mp.team) as won,(mr.winner_team<>'draw' and mr.winner_team<>mp.team) as lost
      from public.matches m join public.events e on e.id=m.event_id
      join public.match_results mr on mr.match_id=m.id join public.match_players mp on mp.match_id=m.id
      join public.event_participants ep on ep.id=mp.participant_id and ep.event_id=e.id
      where e.club_id=p_club and not e.is_deleted and e.stats_mode='official' and m.completed
        and security_private.player_id(coalesce(ep.player_profile_id,ep.profile_id))=who
    ) counted;
    if stat_id is null then
      if totals.played>0 then insert into public.player_stats(club_id,profile_id,match_count,win_count,loss_count,win_rate)
        values(p_club,who,totals.played,totals.wins,totals.losses,totals.wins::numeric/totals.played); end if;
    else
      update public.player_stats set match_count=totals.played,win_count=totals.wins,loss_count=totals.losses,
        win_rate=case when totals.played=0 then 0 else totals.wins::numeric/totals.played end,updated_at=now()
      where id=stat_id and (match_count,win_count,loss_count,win_rate) is distinct from
        (totals.played,totals.wins,totals.losses,case when totals.played=0 then 0 else totals.wins::numeric/totals.played end);
    end if;
  end loop;
end $$;

-- 既存累計に差分がある場合は勝手に再集計しない。補正件数と復旧計画の承認を待つ。
create or replace function security_private.assert_stats(p_club uuid,p_players uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare who uuid; account_id uuid; saved public.player_stats; expected record;
begin
  if p_club is null then return; end if;
  for who in select distinct x from unnest(p_players) x where x is not null loop
    select linked_auth_user_id into account_id from public.player_profiles where id=who;
    if (select count(*) from public.player_stats where club_id=p_club and profile_id in(who,account_id))>1 then raise exception '累計に複数のID形式があります。補正計画の承認が必要です'; end if;
    select * into saved from public.player_stats where club_id=p_club and profile_id in(who,account_id) limit 1;
    if not found then continue; end if;
    select count(*)::int played,count(*) filter(where won)::int wins,count(*) filter(where lost)::int losses into expected from (
      select distinct m.id,(mr.winner_team=mp.team) won,(mr.winner_team<>'draw' and mr.winner_team<>mp.team) lost
      from public.matches m join public.events e on e.id=m.event_id join public.match_results mr on mr.match_id=m.id
      join public.match_players mp on mp.match_id=m.id join public.event_participants ep on ep.id=mp.participant_id and ep.event_id=e.id
      where e.club_id=p_club and not e.is_deleted and e.stats_mode='official' and m.completed
        and security_private.player_id(coalesce(ep.player_profile_id,ep.profile_id))=who
    ) actual;
    if (saved.match_count,saved.win_count,saved.loss_count) is distinct from (expected.played,expected.wins,expected.losses) then
      raise exception '既存累計と試合履歴に差分があります。対象件数・補正理由・復旧計画の承認が必要です';
    end if;
  end loop;
end $$;
create or replace function security_private.before_result() returns trigger language plpgsql security definer set search_path='' as $$
declare mid uuid; cid uuid; eid uuid; players uuid[];
begin
  perform profile_link_private.serialize_operations();
  mid:=case when tg_op='DELETE' then old.match_id else new.match_id end;
  select event_id into eid from public.matches where id=mid;
  if current_setting('role',true) in ('anon','authenticated') and not coalesce(security_private.can_operate_event(eid),false) then raise exception '開催中の所属イベントだけ操作できます' using errcode='42501'; end if;
  if exists(select 1 from public.match_players mp join public.event_participants ep on ep.id=mp.participant_id
    where mp.match_id=mid and coalesce(ep.player_profile_id,ep.profile_id) is not null
    group by security_private.player_id(coalesce(ep.player_profile_id,ep.profile_id)) having count(*)>1) then
    raise exception '同じ試合に同一選手の重複があります。確認するまで保存できません';
  end if;
  if tg_op<>'DELETE' then
    if new.score_a<0 or new.score_b<0 or new.score_a>10000 or new.score_b>10000 then raise exception 'スコアを確認してください'; end if;
    new.winner_team:=case when new.score_a=new.score_b then 'draw' when new.score_a>new.score_b then 'A' else 'B' end;
  end if;
  select e.club_id into cid from public.matches m join public.events e on e.id=m.event_id where m.id=mid and e.stats_mode='official';
  select array_agg(distinct security_private.player_id(coalesce(ep.player_profile_id,ep.profile_id))) into players
    from public.match_players mp join public.event_participants ep on ep.id=mp.participant_id where mp.match_id=mid;
  perform security_private.assert_stats(cid,players);
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists security_p0_before_result on public.match_results;
create trigger security_p0_before_result before insert or update or delete on public.match_results for each row execute function security_private.before_result();
create or replace function security_private.before_event_stats() returns trigger language plpgsql security definer set search_path='' as $$
declare players uuid[];
begin
  if (old.stats_mode,old.is_deleted) is distinct from (new.stats_mode,new.is_deleted) then
    perform profile_link_private.serialize_operations();
    select array_agg(distinct security_private.player_id(coalesce(player_profile_id,profile_id))) into players from public.event_participants where event_id=old.id;
    perform security_private.assert_stats(old.club_id,players);
  end if;
  return new;
end $$;
drop trigger if exists security_p0_before_event_stats on public.events;
create trigger security_p0_before_event_stats before update on public.events for each row execute function security_private.before_event_stats();

-- 結果を直接呼び出す互換経路でも、結果・完了状態・累計を同じトランザクションで保存する。
create or replace function security_private.result_stats() returns trigger
language plpgsql security definer set search_path='' as $$
declare mid uuid; eid uuid; cid uuid; players uuid[];
begin
  perform profile_link_private.serialize_operations();
  mid:=case when tg_op='DELETE' then old.match_id else new.match_id end;
  select event_id into eid from public.matches where id=mid;
  if eid is null then return null; end if;
  select club_id into cid from public.events where id=eid;
  select array_agg(distinct security_private.player_id(coalesce(ep.player_profile_id,ep.profile_id))) into players
    from public.match_players mp join public.event_participants ep on ep.id=mp.participant_id where mp.match_id=mid;
  update public.matches set completed=exists(select 1 from public.match_results where match_id=mid) where id=mid;
  if (select stats_mode from public.events where id=eid)<>'official' then return null; end if;
  perform security_private.refresh_stats(cid,players);
  return null;
end $$;
do $$ begin
  if exists(select 1 from public.match_results group by match_id having count(*)>1) then
    raise exception '試合結果が重複しています。対象件数・復旧計画の承認が必要です';
  end if;
end $$;
create unique index if not exists security_p0_one_result_per_match on public.match_results(match_id);
drop trigger if exists security_p0_result_stats on public.match_results;
create trigger security_p0_result_stats after insert or update or delete on public.match_results for each row execute function security_private.result_stats();

create or replace function security_private.before_match_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- 親行と参加枠がまだ存在する間に結果を取り消し、累計も同時に戻す。
  delete from public.match_results where match_id=old.id;
  return old;
end $$;
drop trigger if exists security_p0_before_match_delete on public.matches;
create trigger security_p0_before_match_delete before delete on public.matches for each row execute function security_private.before_match_delete();
create or replace function security_private.guard_scored_lineup() returns trigger language plpgsql set search_path='' as $$
declare mid uuid;
begin
  mid:=case when tg_op='DELETE' then old.match_id else new.match_id end;
  if current_user in ('anon','authenticated') and exists(select 1 from public.matches where id=mid and completed) then
    raise exception 'スコア入力済みの試合の選手は変更できません';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists security_p0_scored_lineup on public.match_players;
create trigger security_p0_scored_lineup before insert or update or delete on public.match_players for each row execute function security_private.guard_scored_lineup();

create or replace function security_private.event_stats() returns trigger
language plpgsql security definer set search_path='' as $$
declare players uuid[];
begin
  if (old.stats_mode,old.is_deleted) is not distinct from (new.stats_mode,new.is_deleted) then return null; end if;
  perform profile_link_private.serialize_operations();
  select array_agg(distinct security_private.player_id(coalesce(player_profile_id,profile_id))) into players from public.event_participants where event_id=new.id;
  perform security_private.refresh_stats(new.club_id,players);
  return null;
end $$;
drop trigger if exists security_p0_event_stats on public.events;
create trigger security_p0_event_stats after update on public.events for each row execute function security_private.event_stats();

create or replace function security_private.guard_completed() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') and ((tg_op='INSERT' and new.completed) or (tg_op='UPDATE' and new.completed is distinct from old.completed)) then
    raise exception '試合の完了状態は結果の保存処理で更新してください';
  end if;
  return new;
end $$;
drop trigger if exists security_p0_completed on public.matches;
create trigger security_p0_completed before insert or update on public.matches for each row execute function security_private.guard_completed();

-- 直接の物理削除は画面に存在しない。論理削除を使い、関連履歴を残す。
create or replace function security_private.reject_parent_delete() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user in ('anon','authenticated') then raise exception 'グループ・イベントは論理削除してください' using errcode='42501'; end if;
  return old;
end $$;
drop trigger if exists security_p0_no_delete on public.clubs;
create trigger security_p0_no_delete before delete on public.clubs for each row execute function security_private.reject_parent_delete();
drop trigger if exists security_p0_no_delete on public.events;
create trigger security_p0_no_delete before delete on public.events for each row execute function security_private.reject_parent_delete();
drop policy security_p0_clubs_delete on public.clubs;
create policy security_p0_clubs_delete on public.clubs for delete to authenticated using(false);
drop policy security_p0_events_delete on public.events;
create policy security_p0_events_delete on public.events for delete to authenticated using(false);
revoke insert,update,delete on public.player_stats from authenticated;
revoke insert(id,club_id,profile_id,match_count,win_count,loss_count,win_rate,mvp_daily_count,mvp_total_count,updated_at,created_at),
  update(id,club_id,profile_id,match_count,win_count,loss_count,win_rate,mvp_daily_count,mvp_total_count,updated_at,created_at) on public.player_stats from authenticated;

-- 現行の相手グループ選択肢は管理グループだけ。APIにも同じ条件を適用する。
drop policy security_p0_team_sides_insert on public.event_team_sides;
create policy security_p0_team_sides_insert on public.event_team_sides for insert to authenticated with check (
  security_private.can_operate_event(event_id) and exists(select 1 from public.events where id=event_id and event_mode='team') and (club_id is null or security_private.club_role(club_id) in ('super_user','main_admin','sub_admin'))
);
drop policy if exists event_team_matches_manage on public.event_team_matches;
create policy event_team_matches_manage on public.event_team_matches for all to authenticated
  using(security_private.can_operate_event(event_id)) with check(security_private.can_operate_event(event_id));
drop trigger if exists security_p0_parentage on public.event_team_matches;
create trigger security_p0_parentage before insert or update on public.event_team_matches for each row
  execute function security_private.guard_parentage('id','event_id','created_at');

create or replace function security_private.lock_operation(p_event uuid,p_request uuid,p_kind text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous security_p0_history.operations;
begin
  if auth.uid() is null or p_request is null then raise exception 'ログインと操作IDを確認してください' using errcode='42501'; end if;
  perform profile_link_private.serialize_operations();
  perform 1 from public.events where id=p_event for update;
  if not coalesce(security_private.can_read_event(p_event),false) then raise exception 'イベントを操作する権限がありません' using errcode='42501'; end if;
  select * into previous from security_p0_history.operations where request_id=p_request;
  if found then
    if previous.actor<>auth.uid() or previous.event_id<>p_event or previous.kind<>p_kind or previous.payload<>p_payload or previous.restored_at is not null then
      raise exception '操作IDが別の要求に使用されています';
    end if;
    return previous.result;
  end if;
  if not coalesce(security_private.can_operate_event(p_event),false) then raise exception '開催中イベントだけ操作できます' using errcode='42501'; end if;
  return null;
end $$;

create or replace function security_private.save_result(p_event uuid,p_match uuid,p_a int,p_b int,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('match',p_match,'a',p_a,'b',p_b); previous jsonb; before_state jsonb; result jsonb;
begin
  previous:=security_private.lock_operation(p_event,p_request,'score',payload); if previous is not null then return previous; end if;
  if p_a is null or p_b is null or p_a<0 or p_b<0 or p_a>10000 or p_b>10000 then raise exception 'スコアを確認してください'; end if;
  if not exists(select 1 from public.matches where id=p_match and event_id=p_event) then raise exception '試合とイベントが一致しません'; end if;
  before_state:=security_private.event_snapshot(p_event);
  insert into public.match_results(match_id,score_a,score_b,winner_team) values(p_match,p_a,p_b,case when p_a=p_b then 'draw' when p_a>p_b then 'A' else 'B' end)
    on conflict(match_id) do update set score_a=excluded.score_a,score_b=excluded.score_b,winner_team=excluded.winner_team;
  result:=jsonb_build_object('match_id',p_match);
  insert into security_p0_history.operations values(p_request,auth.uid(),p_event,'score',payload,result,before_state,security_private.event_snapshot(p_event),now(),null);
  return result;
end $$;

create or replace function security_private.create_round(p_event uuid,p_expected int,p_matches jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('expected',p_expected,'matches',p_matches); previous jsonb; before_state jsonb; rid uuid; mid uuid; card jsonb; pid uuid; who uuid; team text; seen uuid[]:='{}'; seen_players uuid[]:='{}'; courts int[]:='{}'; court int; result jsonb;
begin
  previous:=security_private.lock_operation(p_event,p_request,'round',payload); if previous is not null then return previous; end if;
  if (select event_mode from public.events where id=p_event) not in ('auto','manual') then raise exception '通常イベントのRoundだけ作成できます'; end if;
  if p_expected is null or p_expected<>coalesce((select max(round_number) from public.rounds where event_id=p_event),0) then raise exception '他のユーザーが先にRoundを更新しました。再読み込みしてください'; end if;
  if jsonb_typeof(p_matches) is distinct from 'array' or jsonb_array_length(p_matches) not between 1 and 256 then raise exception '試合の組み合わせを確認してください'; end if;
  before_state:=security_private.event_snapshot(p_event);
  insert into public.rounds(event_id,round_number) values(p_event,p_expected+1) returning id into rid;
  for card in select value from jsonb_array_elements(p_matches) loop
    court:=(card->>'court')::int;
    if court is null or court<1 or court=any(courts) or jsonb_typeof(card->'teamA') is distinct from 'array' or jsonb_typeof(card->'teamB') is distinct from 'array'
      or jsonb_array_length(card->'teamA')<>2 or jsonb_array_length(card->'teamB')<>2 then raise exception 'コートと4人の選手を確認してください'; end if;
    courts:=array_append(courts,court);
    insert into public.matches(event_id,round_id,court_number) values(p_event,rid,court) returning id into mid;
    foreach team in array array['A','B'] loop
      for pid in select value::uuid from jsonb_array_elements_text(card->('team'||team)) loop
        if pid is null or pid=any(seen) or not exists(select 1 from public.event_participants ep where ep.id=pid and ep.event_id=p_event and ep.status='active'
          and (ep.participant_type='guest' or (select club_id from public.events where id=p_event) is null or exists(select 1 from public.club_members cm
            where cm.club_id=(select club_id from public.events where id=p_event) and cm.is_active and (cm.player_profile_id=ep.player_profile_id or cm.profile_id=ep.profile_id)))) then
          raise exception '同じ選手の重複、別イベント、退会・休みの選手は登録できません';
        end if;
        perform 1 from public.event_participants where id=pid for share;
        select security_private.player_id(coalesce(player_profile_id,profile_id)) into who from public.event_participants where id=pid;
        if who is not null and who=any(seen_players) then raise exception '同一選手を別の参加IDで重複登録できません'; end if;
        if who is not null then seen_players:=array_append(seen_players,who); end if;
        seen:=array_append(seen,pid);
        insert into public.match_players(match_id,participant_id,team) values(mid,pid,team);
      end loop;
    end loop;
  end loop;
  result:=jsonb_build_object('round_id',rid,'round_number',p_expected+1);
  insert into security_p0_history.operations values(p_request,auth.uid(),p_event,'round',payload,result,before_state,security_private.event_snapshot(p_event),now(),null);
  return result;
end $$;

create or replace function security_private.delete_match(p_event uuid,p_match uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('match',p_match); previous jsonb; before_state jsonb; rid uuid; number int; r record; result jsonb;
begin
  previous:=security_private.lock_operation(p_event,p_request,'delete',payload); if previous is not null then return previous; end if;
  if (select event_mode from public.events where id=p_event)<>'auto' then raise exception '通常モードの試合だけ削除できます'; end if;
  select round_id into rid from public.matches where id=p_match and event_id=p_event;
  if not found then raise exception '削除対象の試合を確認してください'; end if;
  before_state:=security_private.event_snapshot(p_event);
  select round_number into number from public.rounds where id=rid;
  delete from public.match_results where match_id=p_match;
  delete from public.match_players where match_id=p_match;
  delete from public.matches where id=p_match;
  if not exists(select 1 from public.matches where round_id=rid) then
    delete from public.rounds where id=rid;
    for r in select id,round_number from public.rounds where event_id=p_event and round_number>number order by round_number loop
      update public.rounds set round_number=r.round_number-1 where id=r.id;
    end loop;
  end if;
  result:=jsonb_build_object('deleted',true);
  insert into security_p0_history.operations values(p_request,auth.uid(),p_event,'delete',payload,result,before_state,security_private.event_snapshot(p_event),now(),null);
  return result;
end $$;

create or replace function security_private.set_lineup(p_event uuid,p_match uuid,p_players jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare payload jsonb:=jsonb_build_object('match',p_match,'players',p_players); previous jsonb; before_state jsonb; pid uuid; who uuid; i int:=0; seen uuid[]:='{}'; seen_players uuid[]:='{}'; rid uuid; result jsonb;
begin
  previous:=security_private.lock_operation(p_event,p_request,'lineup',payload); if previous is not null then return previous; end if;
  select round_id into rid from public.matches where id=p_match and event_id=p_event and not completed;
  if not found or exists(select 1 from public.match_results where match_id=p_match) then raise exception 'スコア入力済みの試合は組み合わせを変更できません'; end if;
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players)<>4 then raise exception '4人の選手を選択してください'; end if;
  before_state:=security_private.event_snapshot(p_event);
  delete from public.match_players where match_id=p_match;
  for pid in select value::uuid from jsonb_array_elements_text(p_players) loop
    if pid is null or pid=any(seen) or not exists(select 1 from public.event_participants where id=pid and event_id=p_event and status='active')
      or exists(select 1 from public.match_players mp join public.matches m on m.id=mp.match_id where m.round_id=rid and m.id<>p_match and mp.participant_id=pid) then raise exception '選手の重複または参加状態を確認してください'; end if;
    select security_private.player_id(coalesce(player_profile_id,profile_id)) into who from public.event_participants where id=pid;
    if who is not null and who=any(seen_players) then raise exception '同一選手を別の参加IDで重複登録できません'; end if;
    if who is not null then seen_players:=array_append(seen_players,who); end if;
    seen:=array_append(seen,pid); i:=i+1;
    insert into public.match_players(match_id,participant_id,team) values(p_match,pid,case when i<=2 then 'A' else 'B' end);
  end loop;
  result:=jsonb_build_object('match_id',p_match);
  insert into security_p0_history.operations values(p_request,auth.uid(),p_event,'lineup',payload,result,before_state,security_private.event_snapshot(p_event),now(),null);
  return result;
end $$;

create or replace function security_private.group_snapshot(p_club uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('clubs',coalesce((select jsonb_agg(to_jsonb(c)) from public.clubs c where id=p_club),'[]'::jsonb),
    'club_members',coalesce((select jsonb_agg(to_jsonb(c) order by id) from public.club_members c where club_id=p_club),'[]'::jsonb));
$$;
create or replace function security_private.create_group(p_request uuid,p_name text,p_description text,p_visibility text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous security_p0_history.operations; payload jsonb:=jsonb_build_object('name',p_name,'description',p_description,'visibility',p_visibility); pp uuid; before_state jsonb; result jsonb;
begin
  if auth.uid() is null or p_request is null then raise exception 'ログインしてから作成してください' using errcode='42501'; end if;
  perform profile_link_private.serialize_operations();
  select * into previous from security_p0_history.operations where request_id=p_request;
  if found then
    if previous.actor<>auth.uid() or previous.kind<>'group' or previous.payload<>payload or previous.restored_at is not null then raise exception '操作IDを確認してください'; end if;
    return previous.result;
  end if;
  pp:=profile_link_private.canonical(auth.uid());
  if pp is null or nullif(btrim(p_name),'') is null or p_visibility not in ('public','private') or p_visibility is null then raise exception 'プロフィールとグループ情報を確認してください'; end if;
  before_state:=security_private.group_snapshot(p_request);
  if exists(select 1 from public.clubs where id=p_request) then raise exception '作成IDが既に存在します'; end if;
  insert into public.clubs(id,name,description,owner_id,is_active,visibility) values(p_request,btrim(p_name),nullif(btrim(p_description),''),auth.uid(),true,p_visibility);
  insert into public.club_members(club_id,profile_id,player_profile_id,role,is_active) values(p_request,auth.uid(),pp,'main_admin',true);
  result:=jsonb_build_object('club_id',p_request);
  insert into security_p0_history.operations values(p_request,auth.uid(),p_request,'group',payload,result,before_state,security_private.group_snapshot(p_request),now(),null);
  return result;
end $$;
create or replace function security_private.create_team(p_request uuid,p_name text,p_description text,p_memo text,p_sides jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous security_p0_history.operations; payload jsonb:=jsonb_build_object('name',p_name,'description',p_description,'memo',p_memo,'sides',p_sides); item jsonb; cid uuid; primary_club uuid; before_state jsonb; result jsonb;
begin
  if auth.uid() is null or p_request is null then raise exception 'ログインしてから作成してください' using errcode='42501'; end if;
  perform profile_link_private.serialize_operations();
  select * into previous from security_p0_history.operations where request_id=p_request;
  if found then
    if previous.actor<>auth.uid() or previous.kind<>'team' or previous.payload<>payload or previous.restored_at is not null then raise exception '操作IDを確認してください'; end if;
    return previous.result;
  end if;
  if nullif(btrim(p_name),'') is null or jsonb_typeof(p_sides) is distinct from 'array' or jsonb_array_length(p_sides)<>2
    or (select count(distinct value->>'side') from jsonb_array_elements(p_sides) where value->>'side' in('team_a','team_b'))<>2 then raise exception '両チームの情報を確認してください'; end if;
  for item in select value from jsonb_array_elements(p_sides) loop
    cid:=nullif(item->>'club_id','')::uuid;
    if cid is not null and not coalesce(security_private.club_role(cid) in ('super_user','main_admin','sub_admin'),false) then raise exception '相手グループは管理権限のあるグループを選択してください' using errcode='42501'; end if;
  end loop;
  primary_club:=coalesce(nullif(p_sides->0->>'club_id','')::uuid,nullif(p_sides->1->>'club_id','')::uuid);
  before_state:=security_private.event_snapshot(p_request)||jsonb_build_object('player_stats',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.player_stats s where club_id=primary_club),'[]'::jsonb));
  insert into public.events(id,name,category,court_count,club_id,event_mode,stats_mode,created_by_auth_user_id,description,memo)
    values(p_request,btrim(p_name),'club',1,primary_club,'team','undecided',auth.uid(),nullif(btrim(p_description),''),nullif(btrim(p_memo),''));
  for item in select value from jsonb_array_elements(p_sides) loop
    insert into public.event_team_sides(event_id,side,club_id,team_name) values(p_request,item->>'side',nullif(item->>'club_id','')::uuid,nullif(btrim(item->>'team_name'),''));
  end loop;
  result:=jsonb_build_object('event_id',p_request);
  insert into security_p0_history.operations values(p_request,auth.uid(),p_request,'team',payload,result,before_state,security_private.event_snapshot(p_request),now(),null);
  return result;
end $$;

create or replace function public.save_friendly_result(p_event uuid,p_match uuid,p_a int,p_b int,p_request uuid) returns jsonb
language sql security invoker set search_path='' as $$ select security_private.save_result(p_event,p_match,p_a,p_b,p_request) $$;
create or replace function public.create_friendly_round(p_event uuid,p_expected int,p_matches jsonb,p_request uuid) returns jsonb
language sql security invoker set search_path='' as $$ select security_private.create_round(p_event,p_expected,p_matches,p_request) $$;
create or replace function public.delete_friendly_match(p_event uuid,p_match uuid,p_request uuid) returns jsonb
language sql security invoker set search_path='' as $$ select security_private.delete_match(p_event,p_match,p_request) $$;
create or replace function public.set_friendly_lineup(p_event uuid,p_match uuid,p_players jsonb,p_request uuid) returns jsonb
language sql security invoker set search_path='' as $$ select security_private.set_lineup(p_event,p_match,p_players,p_request) $$;
create or replace function public.create_friendly_group(p_request uuid,p_name text,p_description text,p_visibility text) returns jsonb
language sql security invoker set search_path='' as $$ select security_private.create_group(p_request,p_name,p_description,p_visibility) $$;
create or replace function public.create_friendly_team(p_request uuid,p_name text,p_description text,p_memo text,p_sides jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select security_private.create_team(p_request,p_name,p_description,p_memo,p_sides) $$;

create or replace function security_private.change_event(p_event uuid,p_action text,p_stats text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous security_p0_history.operations; e public.events; payload jsonb:=jsonb_build_object('action',p_action,'stats',p_stats); before_state jsonb; result jsonb;
begin
  if auth.uid() is null or p_request is null then raise exception 'ログインしてから操作してください' using errcode='42501'; end if;
  perform profile_link_private.serialize_operations();
  select * into previous from security_p0_history.operations where request_id=p_request;
  if found then
    if previous.actor<>auth.uid() or previous.event_id<>p_event or previous.kind<>'state' or previous.payload<>payload or previous.restored_at is not null then raise exception '操作IDを確認してください'; end if;
    return previous.result;
  end if;
  select * into e from public.events where id=p_event for update;
  if not found or not coalesce(security_private.can_operate_event(p_event,false),false) then raise exception 'イベントを操作する権限がありません' using errcode='42501'; end if;
  before_state:=security_private.event_snapshot(p_event);
  if p_action='close' and p_stats in ('official','record_only') then
    update public.events set status='closed',closed_at=now(),updated_at=now(),stats_mode=case when e.event_mode='auto' then 'official' else p_stats end where id=p_event;
  elsif p_action='reopen' then
    update public.events set status='active',closed_at=null,updated_at=now(),stats_mode=case when e.event_mode='auto' then 'official' else 'undecided' end where id=p_event;
  elsif p_action='delete' and coalesce(security_private.can_delete_event(p_event),false) then
    update public.events set is_deleted=true,deleted_at=now(),updated_at=now(),share_enabled=false,share_token=null where id=p_event;
  else raise exception 'イベント状態または削除権限を確認してください' using errcode='42501'; end if;
  result:=jsonb_build_object('event_id',p_event,'action',p_action);
  insert into security_p0_history.operations values(p_request,auth.uid(),p_event,'state',payload,result,before_state,security_private.event_snapshot(p_event),now(),null);
  return result;
end $$;
create or replace function public.change_friendly_event(p_event uuid,p_action text,p_stats text,p_request uuid) returns jsonb
language sql security invoker set search_path='' as $$ select security_private.change_event(p_event,p_action,p_stats,p_request) $$;

-- 統合で重なる累計行は監査したうえで合算。試合・参加枠の競合拒否は0039を維持する。
create or replace function security_private.merge_stats(p_merge uuid,p_source uuid,p_target uuid,p_user uuid) returns int
language plpgsql security definer set search_path='' as $$
declare source_stat public.player_stats; target_stat public.player_stats; changed int:=0;
begin
  for source_stat in select * from public.player_stats where profile_id=p_source order by id for update loop
    select * into target_stat from public.player_stats where id<>source_stat.id and club_id is not distinct from source_stat.club_id and profile_id in (p_target,p_user) order by (profile_id=p_target) desc limit 1 for update;
    if (select count(*) from public.player_stats where id<>source_stat.id and club_id is not distinct from source_stat.club_id and profile_id in(p_target,p_user))>1 then
      raise exception '統合先の累計に複数のID形式があります。対象件数・復旧計画の確認が必要です';
    end if;
    insert into profile_link_private.merge_changes values(p_merge,'public','player_stats',source_stat.id,to_jsonb(source_stat),'null'::jsonb);
    if target_stat.id is null then
      update public.player_stats set profile_id=p_target where id=source_stat.id;
      update profile_link_private.merge_changes set after_row=(select to_jsonb(t) from public.player_stats t where id=source_stat.id) where merge_id=p_merge and source_table='player_stats' and row_id=source_stat.id;
    else
      insert into profile_link_private.merge_changes values(p_merge,'public','player_stats',target_stat.id,to_jsonb(target_stat),'null'::jsonb) on conflict do nothing;
      update public.player_stats set match_count=match_count+source_stat.match_count,win_count=win_count+source_stat.win_count,loss_count=loss_count+source_stat.loss_count,
        win_rate=case when match_count+source_stat.match_count=0 then 0 else (win_count+source_stat.win_count)::numeric/(match_count+source_stat.match_count) end,
        mvp_daily_count=mvp_daily_count+source_stat.mvp_daily_count,mvp_total_count=mvp_total_count+source_stat.mvp_total_count where id=target_stat.id;
      delete from public.player_stats where id=source_stat.id;
      update profile_link_private.merge_changes set after_row=(select to_jsonb(t) from public.player_stats t where id=target_stat.id) where merge_id=p_merge and source_table='player_stats' and row_id=target_stat.id;
    end if;
    changed:=changed+1;
  end loop;
  return (select count(*)::int from profile_link_private.merge_changes where merge_id=p_merge and source_table='player_stats');
end $$;

-- 本人確認・失効・競合・監査の既存手順は置換せず、戦績とロックの範囲だけを拡張する。
create or replace function security_private.source_consent_matches(p_before jsonb,p_source uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare current_snapshot jsonb;
begin
  if auth.uid() is null then return false; end if;
  current_snapshot:=profile_link_private.source_snapshot(p_source);
  if p_before ? 'player_stats' then return p_before=current_snapshot; end if;
  -- 旧同意に戦績項目がなくても、新たな累計がなければ既存の承認を維持できる。
  return current_snapshot->'player_stats'='[]'::jsonb and p_before=current_snapshot-'player_stats';
end $$;
do $$ declare definition text; patched text; signature text; begin
  signature:='profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)';
  definition:=pg_get_functiondef(to_regprocedure(signature));
  if position('security_private.merge_stats' in definition)=0 then
    patched:=replace(definition,'or (p_source <> p_user and exists (select 1 from public.player_stats where profile_id = p_source))',
      'or (p_source <> p_user and exists (select 1 from public.profiles where id=p_source) and exists (select 1 from public.player_stats where profile_id = p_source))');
    if patched=definition then raise exception '0039の統合定義が想定と異なります'; end if;
    patched:=replace(patched,'update public.player_profiles set linked_auth_user_id = null, is_active = false where id = p_source;',
      'counts := counts || jsonb_build_object(''player_stats'',security_private.merge_stats(merge_id,p_source,p_target,p_user)); update public.player_profiles set linked_auth_user_id = null, is_active = false where id = p_source;');
    if position('security_private.merge_stats' in patched)=0 then raise exception '0039の戦績監査拡張を確認できません'; end if;
    execute patched;
  end if;
  definition:=pg_get_functiondef('profile_link_private.source_snapshot(uuid)'::regprocedure);
  if position('''player_stats''' in definition)=0 then
    patched:=replace(definition,'''profile'', (select', '''player_stats'',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.player_stats s where profile_id=p_source),''[]''::jsonb), ''profile'', (select');
    if patched=definition then raise exception '0039の確認用定義が想定と異なります'; end if;
    execute patched;
  end if;
  definition:=pg_get_functiondef('profile_link_private.preview(uuid,uuid)'::regprocedure);
  if position('stats_snapshot' in definition)=0 then
    patched:=replace(definition,'''review_token'', md5(snapshot::text || coalesce(target::text, ''''))',
      '''stats_count'', jsonb_array_length(snapshot->''player_stats''), ''review_token'', md5(snapshot::text || coalesce(target::text, '''') || coalesce((select jsonb_agg(to_jsonb(s) order by id)::text from public.player_stats s where profile_id in(target,p_user)),'''')) /* stats_snapshot */');
    if patched=definition then raise exception '0039の承認トークン定義が想定と異なります'; end if;
    execute patched;
  end if;
  definition:=pg_get_functiondef('profile_link_private.lock_references()'::regprocedure);
  if position('''player_stats''' in definition)=0 then execute replace(definition,'''player_profiles'']','''player_profiles'',''player_stats'']'); end if;
  definition:=pg_get_functiondef('public.review_profile_join_request(uuid,text)'::regprocedure);
  if position('security_private.source_consent_matches' in definition)=0 then
    patched:=replace(definition,'request.consent_snapshot is distinct from profile_link_private.source_snapshot(request.consent_source_player_profile_id)',
      'not security_private.source_consent_matches(request.consent_snapshot,request.consent_source_player_profile_id)');
    if patched=definition then raise exception '0039の加入同意の定義が想定と異なります'; end if;
    execute patched;
  end if;
end $$;

-- 復旧対象は監査した差分だけ。画面やData APIからの実行は許可しない。
create or replace function security_private.operation_changes(p_request uuid)
returns table(table_name text,row_id uuid,before_row jsonb,after_row jsonb)
language sql stable security definer set search_path='' as $$
  with previous as (
    select k.key as name,r.value as row from security_p0_history.operations o,
      lateral jsonb_each(o.before_state) k,lateral jsonb_array_elements(k.value) r where request_id=p_request
  ), following as (
    select k.key as name,r.value as row from security_p0_history.operations o,
      lateral jsonb_each(o.after_state) k,lateral jsonb_array_elements(k.value) r where request_id=p_request
  )
  select coalesce(p.name,f.name),coalesce(p.row->>'id',f.row->>'id')::uuid,coalesce(p.row,'null'::jsonb),coalesce(f.row,'null'::jsonb)
  from previous p full join following f on p.name=f.name and p.row->>'id'=f.row->>'id' where p.row is distinct from f.row;
$$;
create or replace function security_private.restore_operation(p_request uuid,p_expected_counts jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare op security_p0_history.operations; counts jsonb; item record; reference_row record; unexpected boolean; assignments text; t text; current_state jsonb;
begin
  if current_setting('role',true) in ('anon','authenticated') then raise exception '復旧は管理用接続で実施してください'; end if;
  perform profile_link_private.serialize_operations();
  select * into op from security_p0_history.operations where request_id=p_request for update;
  if not found or op.restored_at is not null then raise exception '有効な操作監査を1件指定してください'; end if;
  select coalesce(jsonb_object_agg(table_name,n),'{}'::jsonb) into counts from (
    select table_name,count(*) n from security_private.operation_changes(p_request) group by table_name
  ) c;
  if p_expected_counts is null or p_expected_counts<>counts then raise exception '復旧対象件数の事前確認と承認が必要です'; end if;
  current_state:=case when op.kind='group' then security_private.group_snapshot(op.event_id) else security_private.event_snapshot(op.event_id) end;
  if current_state is distinct from op.after_state then
    raise exception '操作後に記録が変更されています。新しい記録を上書きせず復旧を中止します';
  end if;
  -- 監査にない新しい参照をFKの連動削除で消さない。未知の参照構成でも停止する。
  for item in select * from security_private.operation_changes(p_request) where before_row='null'::jsonb loop
    for reference_row in select c.*,n.nspname,t.relname,a.attname from pg_constraint c
      join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      where c.contype='f' and c.confrelid=format('public.%I',item.table_name)::regclass loop
      if array_length(reference_row.conkey,1)<>1 then raise exception '複合参照があります。個別の復旧計画を確認してください'; end if;
      execute format('select exists(select 1 from %I.%I c where %I=$1 and not exists(select 1 from security_private.operation_changes($2) d where $4=''public'' and d.table_name=$3 and d.row_id=(to_jsonb(c)->>''id'')::uuid and d.before_row=''null''::jsonb))',reference_row.nspname,reference_row.relname,reference_row.attname)
        into unexpected using item.row_id,p_request,reference_row.relname,reference_row.nspname;
      if unexpected then raise exception '監査後に関連履歴が追加されています。連動削除せず中止します'; end if;
    end loop;
  end loop;
  alter table public.match_results disable trigger security_p0_result_stats;
  alter table public.match_results disable trigger security_p0_before_result;
  alter table public.matches disable trigger security_p0_before_match_delete;
  alter table public.events disable trigger security_p0_event_stats;
  alter table public.events disable trigger security_p0_before_event_stats;
  foreach t in array array['match_results','match_players','matches','rounds','player_stats','event_participants','event_team_sides','events','club_members','clubs'] loop
    for item in select * from security_private.operation_changes(p_request) where table_name=t and before_row='null'::jsonb loop
      execute format('delete from public.%I where id=$1',t) using item.row_id;
    end loop;
  end loop;
  foreach t in array array['clubs','club_members','events','event_participants','rounds','matches','match_players','match_results','player_stats','event_team_sides'] loop
    for item in select * from security_private.operation_changes(p_request) where table_name=t and before_row<>'null'::jsonb loop
      if item.after_row='null'::jsonb then
        execute format('insert into public.%1$I select * from jsonb_populate_record(null::public.%1$I,$1)',t) using item.before_row;
      else
        select string_agg(format('%1$I=b.%1$I',attname),',') into assignments from pg_attribute
          where attrelid=format('public.%I',t)::regclass and attnum>0 and not attisdropped and attname<>'id' and attgenerated='';
        execute format('update public.%1$I s set %2$s from jsonb_populate_record(null::public.%1$I,$1) b where s.id=$2',t,assignments) using item.before_row,item.row_id;
      end if;
    end loop;
  end loop;
  alter table public.match_results enable trigger security_p0_result_stats;
  alter table public.match_results enable trigger security_p0_before_result;
  alter table public.matches enable trigger security_p0_before_match_delete;
  alter table public.events enable trigger security_p0_event_stats;
  alter table public.events enable trigger security_p0_before_event_stats;
  current_state:=case when op.kind='group' then security_private.group_snapshot(op.event_id) else security_private.event_snapshot(op.event_id) end;
  if current_state is distinct from op.before_state then raise exception '復旧後の検証が一致しません'; end if;
  update security_p0_history.operations set restored_at=now() where request_id=p_request;
end $$;

-- 内部の数値更新・監査関数をAPIへ公開しない。
revoke all on all functions in schema security_private from public,anon,authenticated;
grant execute on function security_private.actor_super(),security_private.club_role(uuid),security_private.event_role(uuid),security_private.can_read_event(uuid),
  security_private.can_operate_event(uuid,boolean),security_private.can_manage_event(uuid),security_private.can_delete_event(uuid),security_private.valid_stats_profile(uuid,uuid),
  security_private.can_update_team_side(uuid,uuid,uuid) to authenticated;
grant execute on function security_private.get_shared_event_data(text) to anon,authenticated;
grant execute on function security_private.save_result(uuid,uuid,int,int,uuid),security_private.create_round(uuid,int,jsonb,uuid),
  security_private.delete_match(uuid,uuid,uuid),security_private.set_lineup(uuid,uuid,jsonb,uuid),
  security_private.create_group(uuid,text,text,text),security_private.create_team(uuid,text,text,text,jsonb),security_private.change_event(uuid,text,text,uuid) to authenticated;
revoke all on function public.save_friendly_result(uuid,uuid,int,int,uuid),public.create_friendly_round(uuid,int,jsonb,uuid),
  public.delete_friendly_match(uuid,uuid,uuid),public.set_friendly_lineup(uuid,uuid,jsonb,uuid),
  public.create_friendly_group(uuid,text,text,text),public.create_friendly_team(uuid,text,text,text,jsonb),public.change_friendly_event(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_friendly_result(uuid,uuid,int,int,uuid),public.create_friendly_round(uuid,int,jsonb,uuid),
  public.delete_friendly_match(uuid,uuid,uuid),public.set_friendly_lineup(uuid,uuid,jsonb,uuid),
  public.create_friendly_group(uuid,text,text,text),public.create_friendly_team(uuid,text,text,text,jsonb),public.change_friendly_event(uuid,text,text,uuid) to authenticated;

commit;
