-- 手動適用専用。事前調査・バックアップ後にSQL Editorで実行する。
-- 既存選手の統合・削除・代表IDの選び直しは行わない。重複連携があれば全体を中止する。
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
lock table public.player_profiles in share row exclusive mode;
do $$
declare conflicts jsonb;
begin
  select jsonb_agg(to_jsonb(d)) into conflicts from (
    select linked_auth_user_id, array_agg(id order by id) as player_profile_ids
    from public.player_profiles where linked_auth_user_id is not null and is_active
    group by linked_auth_user_id having count(*) > 1
  ) d;
  if conflicts is not null then
    raise exception '有効な連携プロフィールが複数あります。本人の選択を確認するまで移行を中止します' using detail = conflicts::text;
  end if;
end $$;

create unique index player_profiles_one_active_account on public.player_profiles(linked_auth_user_id)
  where linked_auth_user_id is not null and is_active;
alter table public.player_profiles add column created_by_auth_user_id uuid;

create schema profile_link_private;
revoke all on schema profile_link_private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;

create table public.player_profile_link_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  source_club_member_id uuid not null references public.club_members(id),
  source_player_profile_id uuid not null references public.player_profiles(id),
  target_auth_user_id uuid not null references auth.users(id),
  expected_target_player_profile_id uuid references public.player_profiles(id),
  requested_by_auth_user_id uuid not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  reviewed_by_auth_user_id uuid,
  reviewed_at timestamptz
);
create unique index player_profile_link_requests_one_pending_source on public.player_profile_link_requests(source_player_profile_id) where status = 'pending';
create index player_profile_link_requests_inbox on public.player_profile_link_requests(target_auth_user_id, created_at desc);

alter table public.join_requests drop constraint join_requests_status_check;
alter table public.join_requests add constraint join_requests_status_check check (status in ('pending','approved','rejected','cancelled','expired'));
alter table public.join_requests
  add column consent_source_player_profile_id uuid references public.player_profiles(id),
  add column consent_snapshot jsonb,
  add column consent_at timestamptz,
  add column expires_at timestamptz,
  add column requester_display_name_snapshot text;

create table public.player_profile_merges (
  id uuid primary key default gen_random_uuid(),
  link_request_id uuid unique references public.player_profile_link_requests(id),
  join_request_id uuid unique references public.join_requests(id),
  source_player_profile_id uuid not null references public.player_profiles(id),
  target_player_profile_id uuid not null references public.player_profiles(id),
  target_auth_user_id uuid not null,
  club_id uuid not null references public.clubs(id),
  requested_by_auth_user_id uuid not null,
  approved_by_auth_user_id uuid not null,
  merged_at timestamptz not null default now(),
  changed_counts jsonb not null default '{}',
  restored_at timestamptz,
  restored_by text,
  check (source_player_profile_id <> target_player_profile_id),
  check ((link_request_id is null) <> (join_request_id is null))
);
create unique index player_profile_merges_active_source on public.player_profile_merges(source_player_profile_id) where restored_at is null;
create table profile_link_private.merge_changes (
  merge_id uuid not null references public.player_profile_merges(id),
  source_schema text not null,
  source_table text not null,
  row_id uuid not null,
  before_row jsonb not null,
  after_row jsonb not null,
  primary key (merge_id, source_schema, source_table, row_id)
);
create table profile_link_private.account_lookups (
  auth_user_id uuid primary key,
  window_started_at timestamptz not null,
  lookup_count integer not null
);
alter table public.notifications add column related_profile_link_request_id uuid references public.player_profile_link_requests(id);

-- 内部関数は外部から実行できない専用スキーマに置く。
create function profile_link_private.serialize_operations() returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('padel:profile-linking', 0));
$$;

create function profile_link_private.club_role(p_club uuid, p_actor uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_actor is null then null
    when exists (select 1 from public.app_admins where profile_id = p_actor and is_active)
      or exists (select 1 from auth.users where id = p_actor and email = 'testuser01@example.com' and email_confirmed_at is not null)
      then 'super_user'
    else (select cm.role from public.club_members cm left join public.player_profiles pp on pp.id = cm.player_profile_id
      where cm.club_id = p_club and cm.is_active and cm.status = 'active'
        and (cm.profile_id = p_actor or (pp.linked_auth_user_id = p_actor and pp.is_active))
      order by case cm.role when 'main_admin' then 0 when 'sub_admin' then 1 else 2 end limit 1)
  end;
$$;
create function public.can_manage_player_profile_club(p_club_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(profile_link_private.club_role(p_club_id, auth.uid()) in ('super_user','main_admin','sub_admin'), false);
$$;
create function public.can_edit_player_profile_member(p_club_id uuid, p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(profile_link_private.club_role(p_club_id, auth.uid()) in ('super_user','main_admin')
    or (profile_link_private.club_role(p_club_id, auth.uid()) = 'sub_admin' and p_role <> 'main_admin'), false);
$$;

create function profile_link_private.canonical(p_user uuid, p_expected uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ids uuid[];
begin
  select array_agg(id order by id) into ids from public.player_profiles where linked_auth_user_id = p_user and is_active;
  if coalesce(array_length(ids, 1), 0) > 1 then raise exception '正規プロフィールを一意に特定できません。本人の選択と既存データを確認してください'; end if;
  if p_expected is not null and p_expected is distinct from ids[1] then raise exception '申請時または選択済みの正規プロフィールとの連携が変わっています'; end if;
  return ids[1];
end $$;

create function public.ensure_my_player_profile(p_display_name text, p_expected_profile_id uuid default null) returns public.player_profiles
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); pid uuid; result public.player_profiles;
begin
  if uid is null then raise exception 'ログインしてください'; end if;
  perform profile_link_private.serialize_operations();
  pid := profile_link_private.canonical(uid, p_expected_profile_id);
  if pid is not null then select * into result from public.player_profiles where id = pid; return result; end if;
  if nullif(btrim(p_display_name), '') is null then raise exception '表示名を入力してください'; end if;
  if exists (select 1 from public.player_profiles where id = uid) then raise exception '既存の選手IDと競合しています。既存データは上書きしていません'; end if;
  insert into public.player_profiles(id, linked_auth_user_id, display_name, is_active, created_by_auth_user_id)
    values (uid, uid, btrim(p_display_name), true, uid) returning * into result;
  return result;
end $$;

create function public.add_provisional_club_member(p_club_id uuid, p_display_name text, p_operation_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare existing public.player_profiles; member_id uuid;
begin
  if auth.uid() is null or not public.can_manage_player_profile_club(p_club_id) then raise exception 'メンバーを追加する権限がありません'; end if;
  if nullif(btrim(p_display_name), '') is null or p_operation_id is null then raise exception 'メンバー名と操作IDを確認してください'; end if;
  perform profile_link_private.serialize_operations();
  select * into existing from public.player_profiles where id = p_operation_id;
  if found then
    select id into member_id from public.club_members where club_id = p_club_id and player_profile_id = p_operation_id;
    if existing.created_by_auth_user_id = auth.uid() and existing.display_name = btrim(p_display_name)
      and existing.linked_auth_user_id is null and existing.is_active and member_id is not null then return member_id; end if;
    raise exception '再試行する選手と所属を確認できません。別の選手へは連携しません';
  end if;
  insert into public.player_profiles(id, display_name, linked_auth_user_id, is_active, created_by_auth_user_id)
    values (p_operation_id, btrim(p_display_name), null, true, auth.uid());
  insert into public.club_members(club_id, player_profile_id, role, is_active, status)
    values (p_club_id, p_operation_id, 'member', true, 'active') returning id into member_id;
  return member_id;
end $$;

-- メールの部分一致・一覧取得を許可せず、管理者が本人から受け取った完全一致メールで確認する。
create function public.find_profile_link_account(p_club_id uuid, p_email text)
returns table(auth_user_id uuid, display_name text, identifier text)
language plpgsql security definer set search_path = '' as $$
declare attempts integer;
begin
  if auth.uid() is null or not public.can_manage_player_profile_club(p_club_id) then raise exception 'アカウントを確認する権限がありません'; end if;
  if length(btrim(p_email)) < 5 or position('@' in p_email) < 2 then raise exception '本人から確認したメールアドレスを完全一致で入力してください'; end if;
  insert into profile_link_private.account_lookups values (auth.uid(), clock_timestamp(), 1)
  on conflict on constraint account_lookups_pkey do update set
    lookup_count = case when profile_link_private.account_lookups.window_started_at < clock_timestamp() - interval '10 minutes' then 1 else profile_link_private.account_lookups.lookup_count + 1 end,
    window_started_at = case when profile_link_private.account_lookups.window_started_at < clock_timestamp() - interval '10 minutes' then clock_timestamp() else profile_link_private.account_lookups.window_started_at end
  returning lookup_count into attempts;
  if attempts > 20 then raise exception '確認回数の上限です。時間をおいて再度お試しください'; end if;
  return query select u.id, p.display_name, 'アカウント ' || left(u.id::text, 8)
    from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null limit 1;
end $$;

create function profile_link_private.expire_requests() returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.player_profile_link_requests set status = 'expired', reviewed_at = now() where status = 'pending' and expires_at <= now();
  update public.join_requests set status = 'expired', reviewed_at = now() where status = 'pending' and coalesce(expires_at, created_at + interval '7 days') <= now();
end $$;

-- 同意時点の内容を記録し、本人が確認した後の履歴追加・編集も検出する。
create function profile_link_private.source_snapshot(p_source uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.player_profiles p where id = p_source),
    'memberships', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.club_members t where player_profile_id = p_source), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.event_participants t where player_profile_id = p_source), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.join_requests t where requester_player_profile_id = p_source), '[]'::jsonb),
    'team_matches', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.event_team_matches t where p_source in (team_a_player1_profile_id, team_a_player2_profile_id, team_b_player1_profile_id, team_b_player2_profile_id)), '[]'::jsonb),
    'official_matches', coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.official_matches t where p_source in (our_player1_profile_id, our_player2_profile_id)), '[]'::jsonb),
    'match_players', coalesce((select jsonb_agg(to_jsonb(mp) order by mp.id) from public.match_players mp join public.event_participants ep on ep.id = mp.participant_id where ep.player_profile_id = p_source), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.matches m where exists (select 1 from public.match_players mp join public.event_participants ep on ep.id = mp.participant_id where mp.match_id = m.id and ep.player_profile_id = p_source)), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(to_jsonb(mr) order by mr.id) from public.match_results mr where exists (select 1 from public.match_players mp join public.event_participants ep on ep.id = mp.participant_id where mp.match_id = mr.match_id and ep.player_profile_id = p_source)), '[]'::jsonb)
  );
$$;

create function profile_link_private.preview(p_source uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare target uuid; snapshot jsonb; source public.player_profiles;
begin
  target := profile_link_private.canonical(p_user);
  select * into source from public.player_profiles where id = p_source;
  if not found or not source.is_active or source.linked_auth_user_id is not null then raise exception '対象は有効な未連携の仮プロフィールである必要があります'; end if;
  snapshot := profile_link_private.source_snapshot(p_source);
  return jsonb_build_object(
    'source', to_jsonb(source), 'target_profile_id', target,
    'target_display_name', (select display_name from public.player_profiles where id = target),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('id', cm.id, 'club_name', c.name, 'role', cm.role, 'status', cm.status, 'is_active', cm.is_active, 'created_at', cm.created_at) order by cm.id) from public.club_members cm join public.clubs c on c.id = cm.club_id where cm.player_profile_id = p_source), '[]'::jsonb),
    'participant_count', jsonb_array_length(snapshot->'participants'),
    'match_count', jsonb_array_length(snapshot->'matches'),
    'result_count', jsonb_array_length(snapshot->'results'),
    'team_match_count', jsonb_array_length(snapshot->'team_matches'),
    'official_match_count', jsonb_array_length(snapshot->'official_matches'),
    'review_token', md5(snapshot::text || coalesce(target::text, ''))
  );
end $$;

create function public.preview_profile_join(p_club_id uuid, p_member_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare source uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.clubs where id = p_club_id and is_active and (visibility = 'public' or public.can_manage_player_profile_club(id))) then raise exception '加入対象のグループを確認できません'; end if;
  select player_profile_id into source from public.club_members where id = p_member_id and club_id = p_club_id and is_active and status = 'active';
  if source is null then raise exception '本人が選択した仮登録選手を確認できません'; end if;
  return profile_link_private.preview(source, auth.uid());
end $$;

create function profile_link_private.notify_admins(p_club uuid, p_title text, p_link uuid default null, p_join uuid default null, p_exclude_user uuid default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications(target_auth_user_id, type, title, related_club_id, related_profile_link_request_id, related_join_request_id)
  select distinct uid, 'profile_link_status', p_title, p_club, p_link, p_join from (
    select coalesce(pp.linked_auth_user_id, cm.profile_id) as uid from public.club_members cm left join public.player_profiles pp on pp.id = cm.player_profile_id
      where cm.club_id = p_club and cm.is_active and cm.status = 'active' and cm.role in ('main_admin','sub_admin')
    union select profile_id from public.app_admins where is_active
    union select id from auth.users where email = 'testuser01@example.com' and email_confirmed_at is not null
  ) users where uid is not null and uid is distinct from p_exclude_user;
$$;

create function public.request_player_profile_link(p_club_id uuid, p_member_id uuid, p_target_auth_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare member public.club_members; source public.player_profiles; target uuid; request_id uuid;
begin
  if auth.uid() is null or not public.can_manage_player_profile_club(p_club_id) then raise exception '連携申請を送信する権限がありません'; end if;
  perform profile_link_private.serialize_operations();
  perform profile_link_private.expire_requests();
  select * into member from public.club_members where id = p_member_id and club_id = p_club_id and is_active and status = 'active' for update;
  if not found or not public.can_edit_player_profile_member(p_club_id, member.role) then raise exception '対象メンバーを管理する権限がありません'; end if;
  select * into source from public.player_profiles where id = member.player_profile_id for update;
  if not found or not source.is_active or source.linked_auth_user_id is not null then raise exception '未連携の仮プロフィールを選択してください'; end if;
  if not exists (select 1 from auth.users u join public.profiles p on p.id = u.id where u.id = p_target_auth_user_id and u.email_confirmed_at is not null) then raise exception '登録済みアカウントを確認できません'; end if;
  target := profile_link_private.canonical(p_target_auth_user_id);
  if exists (select 1 from public.player_profile_link_requests where source_player_profile_id = source.id and status = 'pending')
    or exists (select 1 from public.join_requests where consent_source_player_profile_id = source.id and status = 'pending') then raise exception 'この仮プロフィールには承認待ちの申請があります'; end if;
  insert into public.player_profile_link_requests(club_id, source_club_member_id, source_player_profile_id, target_auth_user_id, expected_target_player_profile_id, requested_by_auth_user_id)
    values (p_club_id, member.id, source.id, p_target_auth_user_id, target, auth.uid()) returning id into request_id;
  insert into public.notifications(target_auth_user_id, type, title, body, related_club_id, related_profile_link_request_id)
    values (p_target_auth_user_id, 'profile_link_requested', '連携申請が届いています', '内容を確認し、承認または拒否してください', p_club_id, request_id);
  return request_id;
end $$;

create function public.get_player_profile_link_request(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare request public.player_profile_link_requests; result jsonb;
begin
  select * into request from public.player_profile_link_requests where id = p_request_id;
  if not found or auth.uid() is null or not (request.target_auth_user_id = auth.uid() or public.can_manage_player_profile_club(request.club_id)) then raise exception 'この連携申請を確認する権限がありません'; end if;
  result := to_jsonb(request) || jsonb_build_object('club_name', (select name from public.clubs where id = request.club_id),
    'status', case when request.status = 'pending' and request.expires_at <= now() then 'expired' else request.status end,
    'is_recipient', request.target_auth_user_id = auth.uid());
  if request.status = 'pending' and request.expires_at > now() then result := result || profile_link_private.preview(request.source_player_profile_id, request.target_auth_user_id); end if;
  return result;
end $$;

create function public.list_player_profile_link_requests(p_club_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) from (
    select lr.id, lr.club_id, lr.source_player_profile_id, lr.target_auth_user_id, lr.created_at, lr.expires_at,
      case when lr.status = 'pending' and lr.expires_at <= now() then 'expired' else lr.status end as status,
      c.name as club_name, pp.display_name as source_display_name
    from public.player_profile_link_requests lr join public.clubs c on c.id = lr.club_id join public.player_profiles pp on pp.id = lr.source_player_profile_id
    where auth.uid() is not null and ((p_club_id is null and lr.target_auth_user_id = auth.uid()) or (p_club_id = lr.club_id and public.can_manage_player_profile_club(lr.club_id)))
    order by lr.created_at desc limit 100
  ) r;
$$;

-- FKの意味が未確認なら統合しない。監査・同意の元IDは移行対象から明示的に除外する。
create function profile_link_private.check_reference_schema() returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.player_profiles'::regclass and
      (array_length(c.conkey, 1) <> 1 or n.nspname <> 'public' or (t.relname, a.attname) not in (
        ('club_members','player_profile_id'), ('event_participants','player_profile_id'), ('join_requests','requester_player_profile_id'),
        ('event_team_matches','team_a_player1_profile_id'), ('event_team_matches','team_a_player2_profile_id'),
        ('event_team_matches','team_b_player1_profile_id'), ('event_team_matches','team_b_player2_profile_id'),
        ('official_matches','our_player1_profile_id'), ('official_matches','our_player2_profile_id'),
        ('join_requests','consent_source_player_profile_id'),
        ('player_profile_link_requests','source_player_profile_id'), ('player_profile_link_requests','expected_target_player_profile_id'),
        ('player_profile_merges','source_player_profile_id'), ('player_profile_merges','target_player_profile_id')
      ))
  ) then raise exception '未確認の外部キーがあります。事前調査で意味を確認するまで統合できません'; end if;
end $$;

create function profile_link_private.lock_references() returns void language plpgsql security definer set search_path = '' as $$
declare table_name text;
begin
  -- 通常試合の選手枠・結果もロックし、競合検査から更新までの新しい参照を防ぐ。
  for table_name in select unnest(array['club_members','event_participants','event_team_matches','join_requests','match_players','match_results','matches','official_matches','player_profiles']) order by 1 loop
    execute format('lock table public.%I in share row exclusive mode', table_name);
  end loop;
end $$;

create function profile_link_private.merge_profiles(p_source uuid, p_target uuid, p_user uuid, p_club uuid, p_requested_by uuid, p_approved_by uuid, p_link uuid, p_join uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare source public.player_profiles; target public.player_profiles; merge_id uuid; ref record; count_changed integer; counts jsonb := '{}';
begin
  perform profile_link_private.check_reference_schema();
  perform profile_link_private.lock_references();
  select * into source from public.player_profiles where id = p_source for update;
  select * into target from public.player_profiles where id = p_target for update;
  if source.id is null or target.id is null or p_source = p_target or not source.is_active or source.linked_auth_user_id is not null
    or not target.is_active or target.linked_auth_user_id is distinct from p_user
    or profile_link_private.canonical(p_user, p_target) is distinct from p_target then raise exception '統合元の未連携状態と本人の正規プロフィールを確認してください'; end if;
  if exists (select 1 from public.player_profile_merges where source_player_profile_id = p_source and restored_at is null) then raise exception 'この仮プロフィールは統合済みです'; end if;
  if exists (select 1 from public.club_members where player_profile_id = p_source and profile_id is not null and profile_id <> p_user)
    or exists (select 1 from public.event_participants where player_profile_id = p_source and profile_id is not null and profile_id <> p_user)
    or exists (select 1 from public.join_requests where requester_player_profile_id = p_source and requester_auth_user_id <> p_user)
    or (p_source <> p_user and exists (select 1 from public.player_stats where profile_id = p_source)) then raise exception '旧profile_idのアカウント参照に不整合があります。権限・戦績を確認するまで統合できません'; end if;
  if exists (select 1 from public.club_members where player_profile_id in (p_source,p_target) or (player_profile_id is null and profile_id = p_user) group by club_id having count(*) > 1) then raise exception '同じグループに複数の所属行があります。役職・在籍状態は自動統合しません'; end if;
  if exists (select 1 from public.event_participants where player_profile_id in (p_source,p_target) or (player_profile_id is null and profile_id = p_user and participant_type = 'member') group by event_id having count(*) > 1) then raise exception '同じイベントに複数の参加記録があります。試合結果は変更しません'; end if;
  if exists (select 1 from public.match_players mp join public.event_participants ep on ep.id = mp.participant_id where ep.player_profile_id in (p_source,p_target) or (ep.player_profile_id is null and ep.profile_id = p_user and ep.participant_type = 'member') group by mp.match_id having count(*) > 1) then raise exception '同じ試合に統合元と統合先または同一選手の複数枠があります'; end if;
  if exists (select 1 from public.event_team_matches tm cross join lateral unnest(array[tm.team_a_player1_profile_id,tm.team_a_player2_profile_id,tm.team_b_player1_profile_id,tm.team_b_player2_profile_id]) p(id) where p.id in (p_source,p_target) group by tm.id having count(*) > 1) then raise exception 'フレンドリーチーム戦で同一選手が複数枠になります'; end if;
  if exists (select 1 from public.official_matches om cross join lateral unnest(array[om.our_player1_profile_id,om.our_player2_profile_id]) p(id) where p.id in (p_source,p_target) group by om.id having count(*) > 1) then raise exception '公式戦で同一選手が複数枠になります'; end if;

  insert into public.player_profile_merges(link_request_id, join_request_id, source_player_profile_id, target_player_profile_id, target_auth_user_id, club_id, requested_by_auth_user_id, approved_by_auth_user_id)
    values (p_link, p_join, p_source, p_target, p_user, p_club, p_requested_by, p_approved_by) returning id into merge_id;
  for ref in select * from (values
    ('club_members','player_profile_id'), ('event_participants','player_profile_id'), ('join_requests','requester_player_profile_id'),
    ('event_team_matches','team_a_player1_profile_id'), ('event_team_matches','team_a_player2_profile_id'),
    ('event_team_matches','team_b_player1_profile_id'), ('event_team_matches','team_b_player2_profile_id'),
    ('official_matches','our_player1_profile_id'), ('official_matches','our_player2_profile_id')
  ) refs(table_name,column_name) loop
    -- 同じ試合行の別列を更新した場合も、最初のbeforeと最後のafterを保存する。
    execute format('insert into profile_link_private.merge_changes(merge_id,source_schema,source_table,row_id,before_row,after_row)
      select $1,''public'',%L,id,to_jsonb(t),to_jsonb(t) from public.%I t where %I = $2 on conflict do nothing', ref.table_name, ref.table_name, ref.column_name) using merge_id,p_source;
    execute format('update public.%I set %I = $1 where %I = $2', ref.table_name, ref.column_name, ref.column_name) using p_target,p_source;
    get diagnostics count_changed = row_count;
    counts := counts || jsonb_build_object(ref.table_name || '.' || ref.column_name, count_changed);
    execute format('update profile_link_private.merge_changes c set after_row = to_jsonb(t) from public.%I t where c.merge_id = $1 and c.source_table = %L and c.row_id = t.id', ref.table_name, ref.table_name) using merge_id;
  end loop;
  update public.player_profiles set linked_auth_user_id = null, is_active = false where id = p_source;
  insert into profile_link_private.merge_changes select merge_id,'public','player_profiles',p_source,to_jsonb(source),to_jsonb(p) from public.player_profiles p where id = p_source;
  update public.player_profile_merges set changed_counts = counts || jsonb_build_object('player_profiles',1) where id = merge_id;
  return merge_id;
end $$;

create function public.review_player_profile_link(p_request_id uuid, p_decision text, p_review_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request public.player_profile_link_requests; target uuid; preview jsonb; merge_id uuid;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('approved','rejected','cancelled') then raise exception '操作を確認してください'; end if;
  perform profile_link_private.serialize_operations();
  select * into request from public.player_profile_link_requests where id = p_request_id for update;
  if not found then raise exception '連携申請が見つかりません'; end if;
  if (p_decision in ('approved','rejected') and auth.uid() <> request.target_auth_user_id)
    or (p_decision = 'cancelled' and not public.can_manage_player_profile_club(request.club_id)) then raise exception '申請先本人の承認、または管理者の取消が必要です'; end if;
  if request.status <> 'pending' then return jsonb_build_object('status',request.status); end if;
  if request.expires_at <= now() then
    update public.player_profile_link_requests set status = 'expired', reviewed_at = now() where id = request.id;
    return jsonb_build_object('status','expired');
  end if;
  if p_decision = 'approved' then
    if not coalesce(profile_link_private.club_role(request.club_id, request.requested_by_auth_user_id) in ('super_user','main_admin','sub_admin'), false) then raise exception '申請元の管理権限が変更されています'; end if;
    if not exists (select 1 from public.club_members where id = request.source_club_member_id and club_id = request.club_id and player_profile_id = request.source_player_profile_id and is_active and status = 'active') then raise exception '申請時の対象メンバーが変更されています'; end if;
    if profile_link_private.club_role(request.club_id,request.requested_by_auth_user_id) = 'sub_admin' and exists (select 1 from public.club_members where id=request.source_club_member_id and role='main_admin') then raise exception '申請元に対象メンバーを管理する権限がありません'; end if;
    perform profile_link_private.lock_references();
    target := profile_link_private.canonical(request.target_auth_user_id, request.expected_target_player_profile_id);
    if target is null then raise exception 'プロフィール画面で本人の正規プロフィールを作成してから承認してください'; end if;
    preview := profile_link_private.preview(request.source_player_profile_id, request.target_auth_user_id);
    if p_review_token is null or preview->>'review_token' <> p_review_token then raise exception '確認後に内容が変更されています。再読み込みして引き継ぐ内容を確認してください'; end if;
    merge_id := profile_link_private.merge_profiles(request.source_player_profile_id,target,request.target_auth_user_id,request.club_id,request.requested_by_auth_user_id,auth.uid(),request.id,null);
  end if;
  update public.player_profile_link_requests set status = p_decision, reviewed_by_auth_user_id = auth.uid(), reviewed_at = now() where id = request.id;
  insert into public.notifications(target_auth_user_id,type,title,related_club_id,related_profile_link_request_id)
    values (request.target_auth_user_id,'profile_link_status',case p_decision when 'approved' then '連携が完了しました' when 'rejected' then '連携を拒否しました' else '連携申請が取り消されました' end,request.club_id,request.id);
  perform profile_link_private.notify_admins(request.club_id,case p_decision when 'approved' then '連携が完了しました' when 'rejected' then '連携が拒否されました' else '連携申請を取り消しました' end,request.id,null,request.target_auth_user_id);
  return jsonb_build_object('status',p_decision,'merge_id',merge_id);
end $$;

create function public.submit_profile_join_request(p_club_id uuid, p_member_id uuid default null, p_message text default null, p_review_token text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target uuid; source uuid; preview jsonb; request_id uuid;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  perform profile_link_private.serialize_operations();
  perform profile_link_private.expire_requests();
  if not exists (select 1 from public.clubs where id = p_club_id and is_active and visibility = 'public') then raise exception '加入対象のグループを確認できません'; end if;
  target := profile_link_private.canonical(auth.uid());
  if target is null then raise exception 'プロフィール画面で正規プロフィールを作成してから申請してください'; end if;
  if exists (select 1 from public.club_members where club_id = p_club_id and is_active and (player_profile_id = target or profile_id = auth.uid())) then raise exception '既にこのグループのメンバーです'; end if;
  if p_member_id is not null then
    perform profile_link_private.lock_references();
    select player_profile_id into source from public.club_members where id = p_member_id and club_id = p_club_id and is_active and status = 'active';
    if source is null then raise exception '本人が選択した仮登録選手を確認できません'; end if;
    preview := profile_link_private.preview(source,auth.uid());
    if p_review_token is null or preview->>'review_token' <> p_review_token then raise exception '引き継ぐ内容を再確認して同意してください'; end if;
    if exists (select 1 from public.player_profile_link_requests where source_player_profile_id = source and status = 'pending')
      or exists (select 1 from public.join_requests where consent_source_player_profile_id = source and status = 'pending') then raise exception 'この仮プロフィールには承認待ちの申請があります'; end if;
  end if;
  insert into public.join_requests(club_id,target_club_member_id,requester_auth_user_id,requester_player_profile_id,message,status,consent_source_player_profile_id,consent_snapshot,consent_at,expires_at,requester_display_name_snapshot)
    values (p_club_id,p_member_id,auth.uid(),target,nullif(btrim(p_message),''),'pending',source,
      case when source is not null then profile_link_private.source_snapshot(source) end,
      case when source is not null then now() end,now()+interval '7 days',(select display_name from public.player_profiles where id = target)) returning id into request_id;
  perform profile_link_private.notify_admins(p_club_id,'加入申請が届いています',null,request_id);
  return request_id;
end $$;

create function public.review_profile_join_request(p_request_id uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request public.join_requests; target uuid; merge_id uuid;
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('approved','rejected','cancelled') then raise exception '操作を確認してください'; end if;
  perform profile_link_private.serialize_operations();
  select * into request from public.join_requests where id = p_request_id for update;
  if not found then raise exception '加入申請が見つかりません'; end if;
  if not public.can_manage_player_profile_club(request.club_id) and not (p_decision = 'cancelled' and request.requester_auth_user_id = auth.uid()) then raise exception '加入申請を審査する権限がありません'; end if;
  if request.status <> 'pending' then return jsonb_build_object('status',request.status); end if;
  if coalesce(request.expires_at,request.created_at+interval '7 days') <= now() then
    update public.join_requests set status = 'expired', reviewed_at = now() where id = request.id;
    return jsonb_build_object('status','expired');
  end if;
  if p_decision = 'approved' then
    perform profile_link_private.lock_references();
    target := profile_link_private.canonical(request.requester_auth_user_id,request.requester_player_profile_id);
    if target is null then raise exception '申請者の正規プロフィールを確認できません'; end if;
    if request.target_club_member_id is not null or request.consent_source_player_profile_id is not null then
      if request.consent_at is null or request.consent_snapshot is null or request.consent_source_player_profile_id is null then raise exception '本人の統合同意が記録されていません。内容を確認して再申請してください'; end if;
      if not exists (select 1 from public.club_members where id = request.target_club_member_id and club_id = request.club_id and player_profile_id = request.consent_source_player_profile_id and is_active and status = 'active') then raise exception '本人が指定した選手または所属が変更されています'; end if;
      if not public.can_edit_player_profile_member(request.club_id,(select role from public.club_members where id = request.target_club_member_id)) then raise exception '対象メンバーを管理する権限がありません'; end if;
      if request.consent_snapshot is distinct from profile_link_private.source_snapshot(request.consent_source_player_profile_id) then raise exception '本人の同意後に引き継ぐ情報が変更されています。再確認と再申請が必要です'; end if;
      merge_id := profile_link_private.merge_profiles(request.consent_source_player_profile_id,target,request.requester_auth_user_id,request.club_id,request.requester_auth_user_id,auth.uid(),null,request.id);
    else
      if exists (select 1 from public.club_members where club_id = request.club_id and (player_profile_id = target or profile_id = request.requester_auth_user_id)) then raise exception '同じグループに所属行があります。退会状態と役職を確認してください'; end if;
      insert into public.club_members(club_id,player_profile_id,role,is_active,status) values (request.club_id,target,'member',true,'active');
    end if;
  end if;
  update public.join_requests set status = p_decision, reviewed_by_auth_user_id = auth.uid(), reviewed_at = now() where id = request.id;
  insert into public.notifications(target_auth_user_id,type,title,related_club_id,related_join_request_id)
    values (request.requester_auth_user_id,'join_request_status',case p_decision when 'approved' then '加入申請が承認されました' when 'rejected' then '加入申請が拒否されました' else '加入申請を取り消しました' end,request.club_id,request.id);
  return jsonb_build_object('status',p_decision,'merge_id',merge_id);
end $$;

-- 通常ユーザーが直接連携・解除・無効化する経路を閉じ、プロフィール詳細だけを更新可能にする。
do $$ declare p record; begin
  for p in select * from pg_policies where schemaname = 'public' and tablename in ('player_profiles','profiles','club_members','join_requests','app_admins') loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
end $$;
alter table public.player_profiles enable row level security;
alter table public.profiles enable row level security;
alter table public.club_members enable row level security;
alter table public.join_requests enable row level security;
alter table public.app_admins enable row level security;
alter table public.player_profile_link_requests enable row level security;
alter table public.player_profile_merges enable row level security;

revoke all on public.player_profiles, public.profiles, public.club_members, public.join_requests, public.app_admins, public.player_profile_link_requests, public.player_profile_merges from public, anon, authenticated;
grant select on public.player_profiles, public.club_members to anon, authenticated;
grant select(id,display_name,avatar_url,created_at) on public.profiles to anon, authenticated;
revoke select(email) on public.profiles from public, anon, authenticated;
grant insert(id,display_name,avatar_url,email), update(display_name,avatar_url,email) on public.profiles to authenticated;
grant update(display_name,bio,play_level,dominant_hand,preferred_position,activity_area) on public.player_profiles to authenticated;
grant insert on public.club_members to authenticated;
grant update(role,is_active,status) on public.club_members to authenticated;
grant select on public.join_requests, public.app_admins, public.player_profile_link_requests, public.player_profile_merges to authenticated;

create policy player_profiles_read on public.player_profiles for select to anon, authenticated using (is_active or linked_auth_user_id = auth.uid() or public.is_super_user());
create policy player_profiles_edit_details on public.player_profiles for update to authenticated
  using (is_active and (linked_auth_user_id = auth.uid() or (linked_auth_user_id is null and exists (select 1 from public.club_members cm where cm.player_profile_id = player_profiles.id and public.can_edit_player_profile_member(cm.club_id,cm.role)))))
  with check (is_active and (linked_auth_user_id = auth.uid() or (linked_auth_user_id is null and exists (select 1 from public.club_members cm where cm.player_profile_id = player_profiles.id and public.can_edit_player_profile_member(cm.club_id,cm.role)))));
create policy profiles_read_names on public.profiles for select to anon, authenticated using (true);
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy club_members_read on public.club_members for select to anon, authenticated using (true);
create policy club_members_insert on public.club_members for insert to authenticated with check (
  (exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = auth.uid()) and profile_id = auth.uid() and role = 'main_admin' and exists (select 1 from public.player_profiles pp where pp.id = player_profile_id and pp.linked_auth_user_id = auth.uid() and pp.is_active))
  or (public.can_manage_player_profile_club(club_id) and profile_id is null and role = 'member' and exists (select 1 from public.player_profiles pp where pp.id = player_profile_id and pp.linked_auth_user_id is null and pp.is_active))
);
create policy club_members_update on public.club_members for update to authenticated
  using (public.can_edit_player_profile_member(club_id,role)) with check (public.can_edit_player_profile_member(club_id,role));
create policy join_requests_read on public.join_requests for select to authenticated using (requester_auth_user_id = auth.uid() or public.can_manage_player_profile_club(club_id));
create policy app_admins_read on public.app_admins for select to authenticated using (profile_id = auth.uid() or public.is_super_user());
create policy profile_link_requests_read on public.player_profile_link_requests for select to authenticated using (target_auth_user_id = auth.uid() or public.can_manage_player_profile_club(club_id));
create policy profile_merges_read on public.player_profile_merges for select to authenticated using (target_auth_user_id = auth.uid() or public.can_manage_player_profile_club(club_id));

revoke insert, update, delete on public.notifications from public, anon, authenticated;
grant update(is_read) on public.notifications to authenticated;

-- 過去に列単位の許可が追加されていても、連携・無効化・監査を直接更新できないようにする。
do $$ declare t text; columns text; begin
  foreach t in array array['player_profiles','profiles','club_members','join_requests','app_admins','player_profile_link_requests','player_profile_merges','notifications'] loop
    select string_agg(quote_ident(a.attname), ',') into columns from pg_attribute a where a.attrelid = format('public.%I',t)::regclass and a.attnum > 0 and not a.attisdropped;
    execute format('revoke insert(%1$s), update(%1$s), references(%1$s) on public.%2$I from public, anon, authenticated',columns,t);
  end loop;
end $$;
revoke select(email) on public.profiles from public, anon, authenticated;
grant insert(id,display_name,avatar_url,email), update(display_name,avatar_url,email) on public.profiles to authenticated;
grant update(display_name,bio,play_level,dominant_hand,preferred_position,activity_area) on public.player_profiles to authenticated;
grant update(role,is_active,status) on public.club_members to authenticated;
grant update(is_read) on public.notifications to authenticated;

create function profile_link_private.guard_identity() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') then raise exception 'アカウント連携・解除・無効化は本人承認の処理が必要です'; end if;
  return new;
end $$;
create trigger profile_link_identity before insert or update of id,linked_auth_user_id,is_active,created_by_auth_user_id on public.player_profiles for each row execute function profile_link_private.guard_identity();

-- 旧profile_idの偽装による管理権限の取得と、統合済みIDへの新しい参照を防ぐ。
create function profile_link_private.guard_reference() returns trigger language plpgsql security definer set search_path = '' as $$
declare column_name text; new_id uuid; old_id uuid; linked uuid; active boolean;
begin
  foreach column_name in array TG_ARGV loop
    new_id := (to_jsonb(new)->>column_name)::uuid;
    old_id := case when TG_OP = 'UPDATE' then (to_jsonb(old)->>column_name)::uuid end;
    if new_id is not null and (TG_OP = 'INSERT' or new_id is distinct from old_id) then
      select linked_auth_user_id,is_active into linked,active from public.player_profiles where id = new_id for share;
      if not found or not active then raise exception '無効化・統合済みの選手には新しい所属・参加・試合を追加できません'; end if;
      if current_setting('role') in ('anon','authenticated') and TG_TABLE_NAME in ('club_members','event_participants') and (to_jsonb(new)->>'profile_id') is not null
        and linked is distinct from (to_jsonb(new)->>'profile_id')::uuid then raise exception '旧profile_idと選手の連携アカウントが一致しません'; end if;
    end if;
  end loop;
  return new;
end $$;
create trigger profile_link_club_reference before insert or update of player_profile_id,profile_id on public.club_members for each row execute function profile_link_private.guard_reference('player_profile_id');
create trigger profile_link_participant_reference before insert or update of player_profile_id,profile_id on public.event_participants for each row execute function profile_link_private.guard_reference('player_profile_id');
create trigger profile_link_join_reference before insert or update of requester_player_profile_id on public.join_requests for each row execute function profile_link_private.guard_reference('requester_player_profile_id');
create trigger profile_link_team_reference before insert or update of team_a_player1_profile_id,team_a_player2_profile_id,team_b_player1_profile_id,team_b_player2_profile_id on public.event_team_matches for each row execute function profile_link_private.guard_reference('team_a_player1_profile_id','team_a_player2_profile_id','team_b_player1_profile_id','team_b_player2_profile_id');
create trigger profile_link_official_reference before insert or update of our_player1_profile_id,our_player2_profile_id on public.official_matches for each row execute function profile_link_private.guard_reference('our_player1_profile_id','our_player2_profile_id');

create function profile_link_private.guard_club_owner() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') and ((TG_OP = 'INSERT' and new.owner_id is distinct from auth.uid()) or (TG_OP = 'UPDATE' and new.owner_id is distinct from old.owner_id)) then raise exception 'グループ所有者を変更できません'; end if;
  return new;
end $$;
create trigger profile_link_club_owner before insert or update of owner_id on public.clubs for each row execute function profile_link_private.guard_club_owner();

-- 公開RPCだけを認証ユーザーへ許可する。内部関数や匿名ユーザーへの実行許可は残さない。
revoke all on all functions in schema profile_link_private from public, anon, authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('can_manage_player_profile_club','can_edit_player_profile_member','ensure_my_player_profile','add_provisional_club_member','find_profile_link_account','preview_profile_join','request_player_profile_link','get_player_profile_link_request','list_player_profile_link_requests','review_player_profile_link','submit_profile_join_request','review_profile_join_request') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
select profile_link_private.check_reference_schema();
commit;
