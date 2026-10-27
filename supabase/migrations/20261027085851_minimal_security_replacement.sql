-- PR-A/P0。手動適用専用。本番への自動適用は行わない。
-- 既存データを更新せず、権限と新しい書き込みの整合性だけを変更する。
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- 0039の本人承認・所属権限の保護がない環境には適用しない。
do $$ begin
  if to_regprocedure('public.get_shared_event(text)') is not null or to_regclass('security_p0_history.operations') is not null then
    raise exception 'PR #159のSQL適用済み環境とは混在できません。差分適用計画を確認してください'; end if;
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
  select auth.uid() is not null and (coalesce(security_private.event_role(p_event) is not null,false) or exists(
    select 1 from public.events e join public.event_participants ep on ep.event_id=e.id
    left join public.player_profiles pp on pp.id=ep.player_profile_id
    where e.id=p_event and e.status='closed' and not e.is_deleted and (ep.profile_id=auth.uid() or pp.linked_auth_user_id=auth.uid())));
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
  if tg_table_name = 'event_participants' then
    if tg_op = 'INSERT' or new.player_profile_id is distinct from old.player_profile_id or new.profile_id is distinct from old.profile_id then
      select club_id into event_club from public.events where id = new.event_id for share;
      if new.participant_type = 'guest' and (new.player_profile_id is not null or new.profile_id is not null) then
        raise exception 'ゲストにはアカウント・選手の内部IDを指定できません' using errcode = '23514';
      end if;
      if new.participant_type = 'member' and event_club is not null and not exists (
        select 1 from public.club_members cm
        where cm.club_id = event_club and cm.is_active
          and ((new.player_profile_id is not null and cm.player_profile_id = new.player_profile_id)
            or (cm.player_profile_id is null and cm.profile_id=(select linked_auth_user_id from public.player_profiles where id=new.player_profile_id))
            or (new.player_profile_id is null and (cm.profile_id = new.profile_id or cm.player_profile_id=(select id from public.player_profiles where linked_auth_user_id=new.profile_id and is_active))))
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
  end if;
  return new;
end $$;

drop trigger if exists security_minimal_event on public.events;
create trigger security_minimal_event before insert or update on public.events for each row execute function security_private.guard_event();
do $$ declare t text; args text; begin
  foreach t in array array['event_participants','match_results','event_team_sides'] loop
    args := case t
      when 'event_participants' then '''id'',''event_id'',''created_at'''
      when 'match_results' then '''id'',''match_id'',''created_at'''
      when 'event_team_sides' then '''id'',''event_id'',''side'',''created_at'''
      else '''id'',''event_id'',''created_at''' end;
    execute format('drop trigger if exists security_minimal_parentage on public.%I',t);
    execute format('create trigger security_minimal_parentage before insert or update on public.%I for each row execute function security_private.guard_parentage(%s)',t,args);
  end loop;
end $$;

-- 本番に緊急適用済みの匿名テーブル書き込み禁止を再現する。
-- 列単位のGRANTとPUBLICからの継承も撤回する。
do $$ declare t record; cols text; begin
  for t in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') loop
    execute format('revoke insert,update,delete,truncate,references,trigger on table public.%I from public,anon', t.relname);
    execute format('revoke truncate on table public.%I from authenticated',t.relname);
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

create policy security_minimal_clubs_select on public.clubs for select to authenticated using (
  security_private.actor_super()
  or security_private.club_role(id) = 'main_admin'
  or exists(select 1 from public.club_members cm left join public.player_profiles pp on pp.id=cm.player_profile_id where cm.club_id=clubs.id and (cm.profile_id=auth.uid() or pp.linked_auth_user_id=auth.uid()))
  or (not is_deleted and is_active and (
    visibility = 'public' or owner_id = (select auth.uid()) or security_private.club_role(id) is not null
  ))
);
create policy security_minimal_clubs_insert on public.clubs for insert to authenticated with check (
  owner_id = (select auth.uid()) and is_active and not is_deleted
);
create policy security_minimal_clubs_update on public.clubs for update to authenticated
  using (security_private.club_role(id) in ('super_user','main_admin'))
  with check (security_private.club_role(id) in ('super_user','main_admin'));

create policy security_minimal_events_select on public.events for select to authenticated using (security_private.can_read_event(id));
create policy security_minimal_events_insert on public.events for insert to authenticated with check (
  created_by_auth_user_id = (select auth.uid()) and (club_id is null or security_private.club_role(club_id) is not null)
);
create policy security_minimal_events_update on public.events for update to authenticated
  using (security_private.can_operate_event(id,false)) with check (security_private.can_operate_event(id,false));

create policy security_minimal_participants_select on public.event_participants for select to authenticated using (security_private.can_read_event(event_id));
create policy security_minimal_participants_insert on public.event_participants for insert to authenticated with check (security_private.can_operate_event(event_id));
create policy security_minimal_participants_update on public.event_participants for update to authenticated
  using (security_private.can_operate_event(event_id)) with check (security_private.can_operate_event(event_id));
create policy security_minimal_participants_delete on public.event_participants for delete to authenticated using (security_private.can_operate_event(event_id));

create policy security_minimal_rounds_select on public.rounds for select to authenticated using (security_private.can_read_event(event_id));

create policy security_minimal_matches_select on public.matches for select to authenticated using (security_private.can_read_event(event_id));
-- 終了後の動画編集は維持し、末尾の列GRANTで他列を拒否する。
create policy security_minimal_matches_update on public.matches for update to authenticated
  using (security_private.can_operate_event(event_id,false)) with check (security_private.can_operate_event(event_id,false));

create policy security_minimal_players_select on public.match_players for select to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and security_private.can_read_event(m.event_id))
);

create policy security_minimal_results_select on public.match_results for select to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and security_private.can_read_event(m.event_id))
);
create policy security_minimal_results_insert on public.match_results for insert to authenticated with check (
  exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id))
);
create policy security_minimal_results_update on public.match_results for update to authenticated
  using (exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id)))
  with check (exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id)));
create policy security_minimal_results_delete on public.match_results for delete to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and security_private.can_operate_event(m.event_id))
);

create policy security_minimal_stats_select on public.player_stats for select to authenticated using (security_private.club_role(club_id) is not null);
create policy security_minimal_team_sides_select on public.event_team_sides for select to authenticated using (security_private.can_read_event(event_id));
create policy security_minimal_team_sides_insert on public.event_team_sides for insert to authenticated with check (
  security_private.can_operate_event(event_id) and exists (select 1 from public.events e where e.id = event_id and e.event_mode = 'team')
  and (club_id is null or security_private.club_role(club_id) in ('super_user','main_admin','sub_admin'))
);
create policy security_minimal_team_sides_update on public.event_team_sides for update to authenticated
  using (security_private.can_operate_event(event_id))
  with check (security_private.can_update_team_side(id,event_id,club_id));
-- 画面はサイドの更新を使う。削除→再登録による所属変更の迂回を許可しない。
-- イベント削除に伴うFKの連動削除は維持する。
create policy security_minimal_team_sides_delete on public.event_team_sides for delete to authenticated using (false);

-- 公開表示と、アカウント・非公開所属の参照を分離する。
create or replace function security_private.can_read_player(p_player uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (security_private.actor_super() or exists(
    select 1 from public.player_profiles p where p.id=p_player and (p.linked_auth_user_id=auth.uid() or exists(
      select 1 from public.club_members cm where (cm.player_profile_id=p.id or (cm.player_profile_id is null and cm.profile_id=p.linked_auth_user_id)) and security_private.club_role(cm.club_id) is not null) or exists(select 1 from public.event_participants ep where ep.player_profile_id=p.id and security_private.can_read_event(ep.event_id)))));
$$;
drop policy player_profiles_read on public.player_profiles;
create policy player_profiles_read on public.player_profiles for select to authenticated using(security_private.can_read_player(id));
drop policy club_members_read on public.club_members;
create policy club_members_read on public.club_members for select to authenticated using(
  security_private.club_role(club_id) is not null or profile_id=auth.uid() or exists(
    select 1 from public.player_profiles pp where pp.id=player_profile_id and pp.linked_auth_user_id=auth.uid()));
drop policy profiles_read_names on public.profiles;
create policy profiles_read_names on public.profiles for select to authenticated using(id=auth.uid() or security_private.actor_super()
  or exists(select 1 from public.player_profiles pp where pp.linked_auth_user_id=profiles.id and security_private.can_read_player(pp.id))
  or exists(select 1 from public.club_members cm where cm.profile_id=profiles.id and security_private.club_role(cm.club_id) is not null));
revoke select on public.player_profiles,public.club_members from anon;
revoke select(id,display_name,avatar_url,created_at) on public.profiles from anon;
revoke select(email) on public.profiles from public,anon,authenticated;
do $$ declare t text; columns_sql text; begin
  foreach t in array array['player_profiles','club_members','join_requests'] loop
    select string_agg(quote_ident(attname),',') into columns_sql from pg_attribute where attrelid=format('public.%I',t)::regclass and attnum>0 and not attisdropped;
    execute format('revoke select(%s) on public.%I from public,anon,authenticated',columns_sql,t);
  end loop;
end $$;
-- 申請者自身にも、同意の内部スナップショットから別グループを漏らさない。
revoke select on public.join_requests from authenticated;
grant select(id,club_id,target_club_member_id,requester_auth_user_id,requester_player_profile_id,message,status,created_at,
  reviewed_by_auth_user_id,reviewed_at,consent_source_player_profile_id,consent_at,expires_at,requester_display_name_snapshot) on public.join_requests to authenticated;
-- 同一グループで必要なのは名簿情報。自己紹介・活動地域などは本人用RPCで取得する。
revoke select on public.player_profiles from authenticated;
grant select(id,display_name,linked_auth_user_id,is_active,created_at) on public.player_profiles to authenticated;
create or replace function security_private.my_players() returns setof public.player_profiles
language sql stable security definer set search_path='' as $$
  select * from public.player_profiles where auth.uid() is not null and linked_auth_user_id=auth.uid() and is_active order by id;
$$;
create or replace function public.get_my_player_profiles() returns setof public.player_profiles
language sql stable security invoker set search_path='' as $$select * from security_private.my_players()$$;
create or replace function security_private.save_my_player(p_id uuid,p_values jsonb,p_expected jsonb) returns public.player_profiles
language plpgsql security definer set search_path='' as $$
declare saved public.player_profiles; allowed text[]:=array['display_name','bio','play_level','dominant_hand','preferred_position','activity_area'];
begin
  select * into saved from public.player_profiles where id=p_id and linked_auth_user_id=auth.uid() and is_active for update;
  if not found or p_values is null or p_expected is null or jsonb_typeof(p_values)<>'object' or jsonb_typeof(p_expected)<>'object'
    or (p_values-allowed)<>'{}'::jsonb or (p_expected-allowed)<>'{}'::jsonb then raise exception '本人と更新項目を確認してください'; end if;
  if exists(select 1 from jsonb_each(p_values) field where not(p_expected ? field.key) or (to_jsonb(saved)->field.key) is distinct from (p_expected->field.key)) then
    raise exception 'プロフィールが変更されています。再読み込みしてください'; end if;
  update public.player_profiles set
    display_name=case when p_values?'display_name' then p_values->>'display_name' else display_name end,
    bio=case when p_values?'bio' then p_values->>'bio' else bio end,
    play_level=case when p_values?'play_level' then p_values->>'play_level' else play_level end,
    dominant_hand=case when p_values?'dominant_hand' then p_values->>'dominant_hand' else dominant_hand end,
    preferred_position=case when p_values?'preferred_position' then p_values->>'preferred_position' else preferred_position end,
    activity_area=case when p_values?'activity_area' then p_values->>'activity_area' else activity_area end
  where id=p_id returning * into saved;
  return saved;
end $$;
create or replace function public.save_my_player_profile(p_id uuid,p_values jsonb,p_expected jsonb) returns public.player_profiles
language sql security invoker set search_path='' as $$select security_private.save_my_player(p_id,p_values,p_expected)$$;
revoke update(display_name,bio,play_level,dominant_hand,preferred_position,activity_area) on public.player_profiles from authenticated;
-- 管理者の未連携選手の改名は既存RLSで許可する。
grant update(display_name) on public.player_profiles to authenticated;

-- 既存の公開相当の表示名・画像だけ。意図的に所有者権限で固定列を投影し、
-- 認証UID・自己紹介・活動地域・所属は返さない。将来の公開設定はこの境界で絞る。
create or replace view public.public_player_profiles with(security_barrier=true) as
  select pp.id,pp.display_name,p.avatar_url from public.player_profiles pp
    left join public.profiles p on p.id=pp.linked_auth_user_id
    where pp.is_active and pp.linked_auth_user_id is not null;
revoke all on public.public_player_profiles from public,anon,authenticated;
grant select on public.public_player_profiles to anon,authenticated;

-- 公開グループは概要を検索できる。所有者の認証UIDは返さない。
create policy security_public_clubs on public.clubs for select to anon using(is_active and not is_deleted and visibility='public');
revoke select on public.clubs from authenticated;
grant select(id,name,description,image_url,main_facility_id,visibility,is_active,is_deleted,deleted_at,created_at) on public.clubs to anon,authenticated;
revoke delete on public.clubs,public.events from authenticated;
revoke insert,update,delete on public.rounds,public.matches,public.match_players from authenticated;
-- 初回管理者の登録までを作成RPCで完結させ、片方だけの直接INSERTを許可しない。
revoke insert on public.clubs,public.club_members from authenticated;
drop policy security_minimal_clubs_insert on public.clubs;
drop policy if exists club_members_insert on public.club_members;
-- 旧累計は移管・再集計しない。現行画面の戦績は正本の試合結果から算出する。
revoke insert,update,delete on public.player_stats from authenticated;
revoke insert(id,club_id,profile_id,match_count,win_count,loss_count,win_rate,mvp_daily_count,mvp_total_count,updated_at,created_at),
  update(id,club_id,profile_id,match_count,win_count,loss_count,win_rate,mvp_daily_count,mvp_total_count,updated_at,created_at) on public.player_stats from authenticated;

create or replace function security_private.can_read_roster(p_club uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (security_private.club_role(p_club) is not null or exists(
    select 1 from public.event_team_sides s where s.club_id=p_club and security_private.event_role(s.event_id) is not null));
$$;
create or replace function security_private.club_players(p_club uuid) returns table(player_profile_id uuid,display_name text)
language sql stable security definer set search_path='' as $$
  select distinct pp.id,pp.display_name from public.club_members cm join public.player_profiles pp on pp.id=cm.player_profile_id or (cm.player_profile_id is null and pp.linked_auth_user_id=cm.profile_id)
  where cm.club_id=p_club and cm.is_active and pp.is_active and security_private.can_read_roster(p_club);
$$;
create or replace function public.get_club_players(p_club uuid) returns table(player_profile_id uuid,display_name text)
language sql stable security invoker set search_path='' as $$select * from security_private.club_players(p_club)$$;
create or replace function security_private.player_names(p_ids uuid[]) returns table(id uuid,display_name text)
language sql stable security definer set search_path='' as $$
  select p.id,p.display_name from public.player_profiles p where p.id=any(p_ids) and
    ((p.is_active and p.linked_auth_user_id is not null) or security_private.can_read_player(p.id)
      or exists(select 1 from public.club_members cm where cm.player_profile_id=p.id and security_private.can_read_roster(cm.club_id)));
$$;
create or replace function public.get_player_names(p_ids uuid[]) returns table(id uuid,display_name text)
language sql stable security invoker set search_path='' as $$select * from security_private.player_names(p_ids)$$;
create or replace function security_private.join_candidates(p_club uuid) returns table(id uuid,player_profile_id uuid,display_name text)
language sql stable security definer set search_path='' as $$
  select cm.id,p.id,p.display_name from public.club_members cm join public.player_profiles p on p.id=cm.player_profile_id
  join public.clubs c on c.id=cm.club_id where c.id=p_club and c.visibility='public' and c.is_active and not c.is_deleted
    and cm.is_active and p.is_active and p.linked_auth_user_id is null and auth.uid() is not null;
$$;
create or replace function public.get_public_join_candidates(p_club uuid) returns table(id uuid,player_profile_id uuid,display_name text)
language sql stable security invoker set search_path='' as $$select * from security_private.join_candidates(p_club)$$;

-- 0039の本人同意・監査・復旧は維持する。表示だけを対象グループに限定する。
create or replace function profile_link_private.scoped_preview(p_source uuid,p_user uuid,p_club uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select profile_link_private.preview(p_source,p_user) || jsonb_build_object(
    'source',jsonb_build_object('id',p_source,'display_name',(select display_name from public.player_profiles where id=p_source)),
    'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',cm.id,'club_name',c.name,'role',cm.role,'status',case when cm.is_active then 'active' else 'inactive' end,'is_active',cm.is_active,'created_at',cm.created_at))
      from public.club_members cm join public.clubs c on c.id=cm.club_id where cm.player_profile_id=p_source and cm.club_id=p_club),'[]'::jsonb),
    'participant_count',(select count(*) from public.event_participants ep join public.events e on e.id=ep.event_id where ep.player_profile_id=p_source and e.club_id=p_club),
    'match_count',(select count(distinct m.id) from public.match_players mp join public.matches m on m.id=mp.match_id join public.event_participants ep on ep.id=mp.participant_id join public.events e on e.id=m.event_id where ep.player_profile_id=p_source and e.club_id=p_club),
    'result_count',(select count(distinct r.id) from public.match_results r join public.match_players mp on mp.match_id=r.match_id join public.event_participants ep on ep.id=mp.participant_id join public.events e on e.id=ep.event_id where ep.player_profile_id=p_source and e.club_id=p_club),
    'team_match_count',(select count(*) from public.event_team_matches m where p_source in(m.team_a_player1_profile_id,m.team_a_player2_profile_id,m.team_b_player1_profile_id,m.team_b_player2_profile_id) and exists(select 1 from public.event_team_sides s where s.event_id=m.event_id and s.club_id=p_club)),
    'official_match_count',(select count(*) from public.official_matches m join public.official_events e on e.id=m.official_event_id where p_source in(m.our_player1_profile_id,m.our_player2_profile_id) and e.club_id=p_club));
$$;
do $$ declare signature text; definition text; patched text; begin
  -- 確認トークンと非公開の同意スナップショットは元のまま。返却する情報だけ差し替える。
  foreach signature in array array['public.preview_profile_join(uuid,uuid)','public.get_player_profile_link_request(uuid)'] loop
    definition:=pg_get_functiondef(to_regprocedure(signature));
    patched:=replace(definition,'profile_link_private.preview(source, auth.uid())','profile_link_private.scoped_preview(source,auth.uid(),p_club_id)');
    patched:=replace(patched,'profile_link_private.preview(request.source_player_profile_id, request.target_auth_user_id)','profile_link_private.scoped_preview(request.source_player_profile_id,request.target_auth_user_id,request.club_id)');
    if patched=definition and position('scoped_preview' in definition)=0 then raise exception '0039のプレビュー定義を確認してください'; end if;
    if patched<>definition then execute patched; end if;
  end loop;
  definition:=pg_get_functiondef('public.find_profile_link_account(uuid,text)'::regprocedure);
  patched:=replace(definition,'''アカウント '' || left(u.id::text, 8)','''確認済みアカウント''');
  if position('確認済みアカウント' in patched)=0 then raise exception '0039の検索識別表示の定義を確認してください'; end if;
  execute patched;
  -- 旧累計をIDに合わせて移管しない。本人統合は正本の所属・参加・試合参照を引き継ぐ。
  definition:=pg_get_functiondef('profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  patched:=replace(definition,'or (p_source <> p_user and exists (select 1 from public.player_stats where profile_id = p_source))','/* 旧累計は既存ID・数値のまま保持する */');
  if position('旧累計は既存ID・数値のまま保持する' in patched)=0 then raise exception '0039の旧累計の統合条件を確認してください'; end if;
  execute patched;
end $$;

-- チーム戦の親検査。既存の表示・ゲスト・結果入力は親の認可を使う。
drop policy if exists event_team_matches_manage on public.event_team_matches;
create policy event_team_matches_manage on public.event_team_matches for all to authenticated
  using(security_private.can_operate_event(event_id)) with check(security_private.can_operate_event(event_id));
drop trigger if exists security_minimal_team_parent on public.event_team_matches;
create trigger security_minimal_team_parent before insert or update on public.event_team_matches for each row
  execute function security_private.guard_parentage('id','event_id','created_at');

-- 結果・完了状態を同じDBトランザクションで保存する。旧累計とは比較・同期しない。
do $$ begin
  if exists(select 1 from public.match_results where match_id is not null group by match_id having count(*)>1) then
    raise exception '重複した試合結果があります。件数・理由・対応案を確認するまで適用できません'; end if;
end $$;
create unique index if not exists security_minimal_one_result on public.match_results(match_id);
create or replace function security_private.normalize_result() returns trigger language plpgsql set search_path='' as $$
begin
  if new.score_a<0 or new.score_b<0 then raise exception 'スコアを確認してください'; end if;
  new.winner_team:=case when new.score_a=new.score_b then 'draw' when new.score_a>new.score_b then 'A' else 'B' end;
  return new;
end $$;
create or replace function security_private.complete_match() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.matches set completed=(tg_op<>'DELETE') where id=case when tg_op='DELETE' then old.match_id else new.match_id end;
  return null;
end $$;
drop trigger if exists security_minimal_normalize on public.match_results;
create trigger security_minimal_normalize before insert or update on public.match_results for each row execute function security_private.normalize_result();
drop trigger if exists security_minimal_complete on public.match_results;
create trigger security_minimal_complete after insert or update or delete on public.match_results for each row execute function security_private.complete_match();
create or replace function security_private.player_id(p_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select p.id from public.player_profiles p where p.linked_auth_user_id=p_id and p.is_active;
$$;
-- 複数行を保存する操作だけを小さなトランザクションにする。汎用監査は作らない。
create or replace function security_private.lock_event(p_event uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.events where id=p_event for update;
  if auth.uid() is null or not coalesce(security_private.can_operate_event(p_event),false) then raise exception '開催中の所属イベントだけ操作できます' using errcode='42501'; end if;
end $$;
create or replace function security_private.create_round(p_event uuid,p_expected int,p_matches jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rid uuid; mid uuid; card jsonb; pid uuid; who uuid; team text; seen uuid[]:='{}'; seen_players uuid[]:='{}'; courts int[]:='{}'; court int; result jsonb;
begin
  perform security_private.lock_event(p_event);
  if exists(select 1 from public.rounds where id=p_request and event_id=p_event) then return jsonb_build_object('round_id',p_request,'round_number',(select round_number from public.rounds where id=p_request)); end if;
  if (select event_mode from public.events where id=p_event) not in ('auto','manual') then raise exception '通常イベントのRoundだけ作成できます'; end if;
  if p_expected is null or p_expected<>coalesce((select max(round_number) from public.rounds where event_id=p_event),0) then raise exception '他のユーザーが先にRoundを更新しました。再読み込みしてください'; end if;
  if jsonb_typeof(p_matches) is distinct from 'array' or jsonb_array_length(p_matches) not between 1 and 256 then raise exception '試合の組み合わせを確認してください'; end if;
  insert into public.rounds(id,event_id,round_number) values(p_request,p_event,p_expected+1) returning id into rid;
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
            where cm.club_id=(select club_id from public.events where id=p_event) and cm.is_active and (cm.player_profile_id=coalesce(ep.player_profile_id,(select id from public.player_profiles where linked_auth_user_id=ep.profile_id and is_active)) or cm.profile_id=ep.profile_id or (cm.player_profile_id is null and cm.profile_id=(select linked_auth_user_id from public.player_profiles where id=ep.player_profile_id)))))) then
          raise exception '同じ選手の重複、別イベント、退会・休みの選手は登録できません';
        end if;
        perform 1 from public.event_participants where id=pid for share;
        select coalesce(player_profile_id,security_private.player_id(profile_id)) into who from public.event_participants where id=pid;
        if who is not null and who=any(seen_players) then raise exception '同一選手を別の参加IDで重複登録できません'; end if;
        if who is not null then seen_players:=array_append(seen_players,who); end if;
        seen:=array_append(seen,pid);
        insert into public.match_players(match_id,participant_id,team) values(mid,pid,team);
      end loop;
    end loop;
  end loop;
  result:=jsonb_build_object('round_id',rid,'round_number',p_expected+1);
  return result;
end $$;

create or replace function security_private.delete_match(p_event uuid,p_match uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rid uuid; number int; r record; result jsonb;
begin
  perform security_private.lock_event(p_event);
  if (select event_mode from public.events where id=p_event)<>'auto' then raise exception '通常モードの試合だけ削除できます'; end if;
  select round_id into rid from public.matches where id=p_match and event_id=p_event;
  if not found then return jsonb_build_object('deleted',true); end if;
  if rid is not null and not exists(select 1 from public.rounds where id=rid and event_id=p_event) then raise exception '試合とRoundの所属を確認してください'; end if;
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
  return result;
end $$;

create or replace function security_private.set_lineup(p_event uuid,p_match uuid,p_players jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pid uuid; who uuid; i int:=0; seen uuid[]:='{}'; seen_players uuid[]:='{}'; rid uuid; result jsonb;
begin
  perform security_private.lock_event(p_event);
  select round_id into rid from public.matches where id=p_match and event_id=p_event and not completed;
  if not found or exists(select 1 from public.match_results where match_id=p_match) then raise exception 'スコア入力済みの試合は組み合わせを変更できません'; end if;
  if jsonb_typeof(p_players) is distinct from 'array' or jsonb_array_length(p_players)<>4 then raise exception '4人の選手を選択してください'; end if;
  delete from public.match_players where match_id=p_match;
  for pid in select value::uuid from jsonb_array_elements_text(p_players) loop
    if pid is null or pid=any(seen) or not exists(select 1 from public.event_participants where id=pid and event_id=p_event and status='active')
      or exists(select 1 from public.match_players mp join public.matches m on m.id=mp.match_id where m.round_id=rid and m.id<>p_match and (mp.participant_id=pid or (select coalesce(player_profile_id,security_private.player_id(profile_id)) from public.event_participants where id=mp.participant_id)=(select coalesce(player_profile_id,security_private.player_id(profile_id)) from public.event_participants where id=pid))) then raise exception '選手の重複または参加状態を確認してください'; end if;
    select coalesce(player_profile_id,security_private.player_id(profile_id)) into who from public.event_participants where id=pid;
    if who is not null and who=any(seen_players) then raise exception '同一選手を別の参加IDで重複登録できません'; end if;
    if who is not null then seen_players:=array_append(seen_players,who); end if;
    seen:=array_append(seen,pid); i:=i+1;
    insert into public.match_players(match_id,participant_id,team) values(p_match,pid,case when i<=2 then 'A' else 'B' end);
  end loop;
  result:=jsonb_build_object('match_id',p_match);
  return result;
end $$;

create or replace function security_private.create_group(p_request uuid,p_name text,p_description text,p_visibility text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pp uuid; result jsonb;
begin
  if auth.uid() is null or p_request is null then raise exception 'ログインしてから作成してください' using errcode='42501'; end if;
  pp:=profile_link_private.canonical(auth.uid());
  if pp is null or nullif(btrim(p_name),'') is null or p_visibility not in ('public','private') or p_visibility is null then raise exception 'プロフィールとグループ情報を確認してください'; end if;
  if exists(select 1 from public.clubs where id=p_request) then
    if exists(select 1 from public.clubs c join public.club_members cm on cm.club_id=c.id where c.id=p_request and c.owner_id=auth.uid() and c.name=btrim(p_name) and cm.profile_id=auth.uid() and cm.role='main_admin') then return jsonb_build_object('club_id',p_request); end if;
    raise exception '作成IDを確認してください'; end if;
  insert into public.clubs(id,name,description,owner_id,is_active,visibility) values(p_request,btrim(p_name),nullif(btrim(p_description),''),auth.uid(),true,p_visibility);
  insert into public.club_members(club_id,profile_id,player_profile_id,role,is_active) values(p_request,auth.uid(),pp,'main_admin',true);
  result:=jsonb_build_object('club_id',p_request);
  return result;
end $$;

create or replace function security_private.create_team(p_request uuid,p_name text,p_description text,p_memo text,p_sides jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; cid uuid; primary_club uuid; result jsonb;
begin
  if auth.uid() is null or p_request is null then raise exception 'ログインしてから作成してください' using errcode='42501'; end if;
  if exists(select 1 from public.events where id=p_request) then
    if exists(select 1 from public.events e where e.id=p_request and e.created_by_auth_user_id=auth.uid() and e.name=btrim(p_name) and e.event_mode='team') and (select count(*) from public.event_team_sides where event_id=p_request)=2 then return jsonb_build_object('event_id',p_request); end if;
    raise exception '作成IDを確認してください'; end if;
  if nullif(btrim(p_name),'') is null or jsonb_typeof(p_sides) is distinct from 'array' or jsonb_array_length(p_sides)<>2
    or (select count(distinct value->>'side') from jsonb_array_elements(p_sides) where value->>'side' in('team_a','team_b'))<>2 then raise exception '両チームの情報を確認してください'; end if;
  for item in select value from jsonb_array_elements(p_sides) loop
    cid:=nullif(item->>'club_id','')::uuid;
    if cid is not null and not coalesce(security_private.club_role(cid) in ('super_user','main_admin','sub_admin'),false) then raise exception '相手グループは管理権限のあるグループを選択してください' using errcode='42501'; end if;
  end loop;
  primary_club:=coalesce(nullif(p_sides->0->>'club_id','')::uuid,nullif(p_sides->1->>'club_id','')::uuid);
  insert into public.events(id,name,category,court_count,club_id,event_mode,stats_mode,created_by_auth_user_id,description,memo)
    values(p_request,btrim(p_name),'club',1,primary_club,'team','undecided',auth.uid(),nullif(btrim(p_description),''),nullif(btrim(p_memo),''));
  for item in select value from jsonb_array_elements(p_sides) loop
    insert into public.event_team_sides(event_id,side,club_id,team_name) values(p_request,item->>'side',nullif(item->>'club_id','')::uuid,nullif(btrim(item->>'team_name'),''));
  end loop;
  result:=jsonb_build_object('event_id',p_request);
  return result;
end $$;

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
-- 通常・チーム・公式の共有を同じ呼出境界にする。トークン一覧の直接SELECTは許可しない。
create or replace function security_private.shared_event(p_token text,p_kind text) returns jsonb
language sql stable strict security definer set search_path='' as $$
select case when p_kind='event' then (
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
        'team_a_player1_profile_id',case when pa1.id is not null then md5(e.id::text||pa1.id::text) end,
        'team_a_player1_guest_name', coalesce(pa1.display_name, etm.team_a_player1_guest_name, '選手'),
        'team_a_player2_profile_id',case when pa2.id is not null then md5(e.id::text||pa2.id::text) end,
        'team_a_player2_guest_name', coalesce(pa2.display_name, etm.team_a_player2_guest_name, '選手'),
        'team_b_player1_profile_id',case when pb1.id is not null then md5(e.id::text||pb1.id::text) end,
        'team_b_player1_guest_name', coalesce(pb1.display_name, etm.team_b_player1_guest_name, '選手'),
        'team_b_player2_profile_id',case when pb2.id is not null then md5(e.id::text||pb2.id::text) end,
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
    ))
) when p_kind='official' then (
select jsonb_build_object(
  'event',jsonb_build_object('title',e.title,'event_date',e.event_date,'description',e.description,'memo',e.memo,'status',e.status,'clubs',jsonb_build_object('name',coalesce(c.name,'グループなし'))),
  'opponents',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'opponent_team_name',o.opponent_team_name,'memo',o.memo) order by o.created_at,o.id) from public.official_opponents o where o.official_event_id=e.id),'[]'::jsonb),
  'matches',coalesce((select jsonb_agg(jsonb_build_object(
    'id',m.id,'official_opponent_id',m.official_opponent_id,'match_order',m.match_order,'created_at',m.created_at,
    'our_player1_profile_id',case when p1.id is not null then md5(e.id::text||p1.id::text) end,
    'our_player2_profile_id',case when p2.id is not null then md5(e.id::text||p2.id::text) end,
    'our_player1_guest_name',coalesce(p1.display_name,m.our_player1_guest_name),
    'our_player2_guest_name',coalesce(p2.display_name,m.our_player2_guest_name),
    'opponent_player1_name',m.opponent_player1_name,'opponent_player2_name',m.opponent_player2_name,
    'our_score',m.our_score,'opponent_score',m.opponent_score,'result',m.result,'score_detail',m.score_detail,'memo',m.memo,'youtube_url',m.youtube_url
  ) order by m.match_order,m.created_at,m.id) from public.official_matches m
    left join public.player_profiles p1 on p1.id=m.our_player1_profile_id left join public.player_profiles p2 on p2.id=m.our_player2_profile_id
    where m.official_event_id=e.id),'[]'::jsonb)
) from public.official_events e left join public.clubs c on c.id=e.club_id
where length(p_token) between 1 and 512 and e.share_token=p_token and e.share_enabled and e.status='closed' and not e.is_deleted and (e.club_id is null or (c.is_active and not c.is_deleted))

) end;
$$;
create or replace function public.get_shared_event(p_token text,p_kind text default 'event') returns jsonb
language sql stable strict security invoker set search_path='' as $$select security_private.shared_event(p_token,p_kind)$$;
drop policy if exists official_events_public_shared_select on public.official_events;
drop policy if exists official_opponents_public_shared_select on public.official_opponents;
drop policy if exists official_matches_public_shared_select on public.official_matches;
revoke select on public.official_events,public.official_opponents,public.official_matches from anon;

revoke update on public.matches from authenticated;
grant update(youtube_url) on public.matches to authenticated;
-- 内部の定義と公開窓口だけに権限を与え、PUBLICの暗黙EXECUTEを残さない。
revoke all on all functions in schema security_private from public,anon,authenticated;
revoke all on function profile_link_private.scoped_preview(uuid,uuid,uuid) from public,anon,authenticated;
grant usage on schema security_private to anon,authenticated;
grant execute on function security_private.actor_super(),security_private.club_role(uuid),security_private.event_role(uuid),
 security_private.can_read_event(uuid),security_private.can_operate_event(uuid,boolean),security_private.can_manage_event(uuid),security_private.can_delete_event(uuid),
 security_private.can_update_team_side(uuid,uuid,uuid),security_private.can_read_player(uuid),security_private.can_read_roster(uuid),
 security_private.club_players(uuid),security_private.player_names(uuid[]),security_private.join_candidates(uuid),
 security_private.my_players(),security_private.save_my_player(uuid,jsonb,jsonb),
 security_private.create_round(uuid,int,jsonb,uuid),security_private.delete_match(uuid,uuid,uuid),security_private.set_lineup(uuid,uuid,jsonb,uuid),
 security_private.create_group(uuid,text,text,text),security_private.create_team(uuid,text,text,text,jsonb) to authenticated;
grant execute on function security_private.shared_event(text,text) to anon,authenticated;
revoke all on function public.get_shared_event(text,text),public.get_club_players(uuid),public.get_player_names(uuid[]),public.get_public_join_candidates(uuid),
 public.get_my_player_profiles(),public.save_my_player_profile(uuid,jsonb,jsonb),
 public.create_friendly_round(uuid,int,jsonb,uuid),public.delete_friendly_match(uuid,uuid,uuid),public.set_friendly_lineup(uuid,uuid,jsonb,uuid),
 public.create_friendly_group(uuid,text,text,text),public.create_friendly_team(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.get_shared_event(text,text) to anon,authenticated;
grant execute on function public.get_club_players(uuid),public.get_player_names(uuid[]),public.get_public_join_candidates(uuid),
 public.get_my_player_profiles(),public.save_my_player_profile(uuid,jsonb,jsonb),
 public.create_friendly_round(uuid,int,jsonb,uuid),public.delete_friendly_match(uuid,uuid,uuid),public.set_friendly_lineup(uuid,uuid,jsonb,uuid),
 public.create_friendly_group(uuid,text,text,text),public.create_friendly_team(uuid,text,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
