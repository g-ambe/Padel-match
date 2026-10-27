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

commit;
