-- 自動実行禁止。01の調査・02のバックアップと本人/管理者の承認後だけ使用する。
-- 既定はプラン未設定で中止。最後もROLLBACK。内容と結果を確認してから手動でCOMMITに変更する。
-- 異なるグループの別名選手を同一人物と決めつけない。プランに入れた元行もDELETEしない。
begin;
set local row_security = off;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table approved_profile_map (
  source_id uuid primary key,
  target_id uuid not null,
  check (source_id <> target_id)
) on commit drop;

-- 承認済みの「移行元ID → 履歴を保持する移行先ID」だけを追加する。
-- insert into approved_profile_map values ('承認済みの元UUID', '承認済みの先UUID');
-- 検証用プラン挿入位置

do $$
declare r record; changed boolean; field_name text; conflict_found boolean;
begin
  if not exists (select 1 from approved_profile_map) then raise exception '承認済みプランが未設定です。変更は行いません'; end if;
  if exists (select 1 from player_profile_backup_20261022.repair_changes) then raise exception 'このバックアップは修復に使用済みです。再利用しないでください'; end if;
  if exists (select 1 from approved_profile_map m join approved_profile_map other on other.source_id = m.target_id) then raise exception '循環・連鎖するプランは使用できません'; end if;

  -- バックアップした全関連表をロックし、比較後に別の更新が入ることを防ぐ。
  for r in select * from player_profile_backup_20261022.manifest order by source_schema, source_table loop
    execute format('lock table %I.%I in share row exclusive mode', r.source_schema, r.source_table);
    execute format(
      'select exists ((select to_jsonb(t) from %I.%I t except all select to_jsonb(b) from player_profile_backup_20261022.%I b)
       union all (select to_jsonb(b) from player_profile_backup_20261022.%I b except all select to_jsonb(t) from %I.%I t))',
      r.source_schema, r.source_table, r.backup_table, r.backup_table, r.source_schema, r.source_table
    ) into changed;
    if changed then raise exception 'バックアップ後に %.% が変更されています。最新バックアップと再調査が必要です', r.source_schema, r.source_table; end if;
  end loop;

  if exists (
    select 1 from approved_profile_map m
    left join public.player_profiles s on s.id = m.source_id
    left join public.player_profiles t on t.id = m.target_id
    where s.id is null or t.id is null or s.linked_auth_user_id is null
      or s.linked_auth_user_id is distinct from t.linked_auth_user_id or t.is_active is not true
  ) then raise exception '元・先の存在、同一アカウント、移行先の有効状態を確認してください'; end if;

  -- 未知のFKや複合FKは意味を確認するまで自動で付け替えない。
  if exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid join pg_namespace ns on ns.oid = rel.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.player_profiles'::regclass
      and (array_length(c.conkey, 1) <> 1 or ns.nspname <> 'public' or
        (rel.relname, a.attname) not in (
          ('club_members', 'player_profile_id'), ('event_participants', 'player_profile_id'),
          ('join_requests', 'requester_player_profile_id'),
          ('event_team_matches', 'team_a_player1_profile_id'), ('event_team_matches', 'team_a_player2_profile_id'),
          ('event_team_matches', 'team_b_player1_profile_id'), ('event_team_matches', 'team_b_player2_profile_id'),
          ('official_matches', 'our_player1_profile_id'), ('official_matches', 'our_player2_profile_id')
        ))
  ) then raise exception '未確認の外部キーがあります。01の調査結果を確認して修復SQLを拡張してください'; end if;

  -- 空欄だけを補完。異なる非空値・複数の異なる補完候補があれば人による判断を要求する。
  foreach field_name in array array['bio', 'play_level', 'dominant_hand', 'preferred_position', 'activity_area'] loop
    execute format(
      'select exists (
        select 1 from approved_profile_map m join public.player_profiles s on s.id = m.source_id
        join public.player_profiles t on t.id = m.target_id
        where nullif(btrim(s.%1$I), '''') is not null and nullif(btrim(t.%1$I), '''') is not null and s.%1$I <> t.%1$I
        union all
        select 1 from approved_profile_map m join public.player_profiles s on s.id = m.source_id
        where nullif(btrim(s.%1$I), '''') is not null group by m.target_id having count(distinct s.%1$I) > 1
      )', field_name
    ) into conflict_found;
    if conflict_found then raise exception 'プロフィール項目 % に内容の衝突があります。既存の値を上書きせず中止します', field_name; end if;
  end loop;

  -- UNIQUE制約に任せるだけでなく、参加者IDや役割を失う統合も事前に止める。
  if exists (
    select 1 from public.club_members cm left join approved_profile_map m on m.source_id = cm.player_profile_id
    where coalesce(m.target_id, cm.player_profile_id) in (select target_id from approved_profile_map)
    group by cm.club_id, coalesce(m.target_id, cm.player_profile_id) having count(*) > 1
  ) then raise exception '同じグループに複数の所属行があります。役割・在籍状態を確認するまで統合できません'; end if;
  if exists (
    select 1 from public.event_participants ep left join approved_profile_map m on m.source_id = ep.player_profile_id
    where coalesce(m.target_id, ep.player_profile_id) in (select target_id from approved_profile_map)
    group by ep.event_id, coalesce(m.target_id, ep.player_profile_id) having count(*) > 1
  ) then raise exception '同じイベントに複数の参加者行があります。試合の参加者IDを確認するまで統合できません'; end if;
  if exists (
    select 1 from public.event_team_matches tm
    cross join lateral unnest(array[tm.team_a_player1_profile_id, tm.team_a_player2_profile_id, tm.team_b_player1_profile_id, tm.team_b_player2_profile_id]) p(id)
    left join approved_profile_map m on m.source_id = p.id
    where coalesce(m.target_id, p.id) in (select target_id from approved_profile_map)
    group by tm.id, coalesce(m.target_id, p.id) having count(*) > 1
  ) then raise exception 'フレンドリーチーム戦で同じ選手が複数枠になります。対戦内容の確認が必要です'; end if;
  if exists (
    select 1 from public.official_matches om
    cross join lateral unnest(array[om.our_player1_profile_id, om.our_player2_profile_id]) p(id)
    left join approved_profile_map m on m.source_id = p.id
    where coalesce(m.target_id, p.id) in (select target_id from approved_profile_map)
    group by om.id, coalesce(m.target_id, p.id) having count(*) > 1
  ) then raise exception '公式戦で同じ選手が複数枠になります。対戦内容の確認が必要です'; end if;
end $$;

with incoming as (
  select m.target_id,
    max(s.bio) filter (where nullif(btrim(s.bio), '') is not null) as bio,
    max(s.play_level) filter (where nullif(btrim(s.play_level), '') is not null) as play_level,
    max(s.dominant_hand) filter (where nullif(btrim(s.dominant_hand), '') is not null) as dominant_hand,
    max(s.preferred_position) filter (where nullif(btrim(s.preferred_position), '') is not null) as preferred_position,
    max(s.activity_area) filter (where nullif(btrim(s.activity_area), '') is not null) as activity_area
  from approved_profile_map m join public.player_profiles s on s.id = m.source_id group by m.target_id
)
update public.player_profiles t set
  bio = case when nullif(btrim(t.bio), '') is null then i.bio else t.bio end,
  play_level = case when nullif(btrim(t.play_level), '') is null then i.play_level else t.play_level end,
  dominant_hand = case when nullif(btrim(t.dominant_hand), '') is null then i.dominant_hand else t.dominant_hand end,
  preferred_position = case when nullif(btrim(t.preferred_position), '') is null then i.preferred_position else t.preferred_position end,
  activity_area = case when nullif(btrim(t.activity_area), '') is null then i.activity_area else t.activity_area end
from incoming i where t.id = i.target_id;

-- 所属・参加者・試合・申請の行IDを維持して参照列だけを更新する。
-- official_matchesはFKがなくても対象に含める。profiles.id参照の旧profile_idは変更しない。
do $$
declare r record; remaining boolean;
begin
  for r in select * from (values
    ('club_members', 'player_profile_id'), ('event_participants', 'player_profile_id'),
    ('join_requests', 'requester_player_profile_id'),
    ('event_team_matches', 'team_a_player1_profile_id'), ('event_team_matches', 'team_a_player2_profile_id'),
    ('event_team_matches', 'team_b_player1_profile_id'), ('event_team_matches', 'team_b_player2_profile_id'),
    ('official_matches', 'our_player1_profile_id'), ('official_matches', 'our_player2_profile_id')
  ) as refs(table_name, column_name) loop
    execute format('update public.%I t set %I = m.target_id from approved_profile_map m where t.%I = m.source_id', r.table_name, r.column_name, r.column_name);
    execute format('select exists (select 1 from public.%I t join approved_profile_map m on t.%I = m.source_id)', r.table_name, r.column_name) into remaining;
    if remaining then raise exception '%.% に移行元への参照が残りました。ロールバックします', r.table_name, r.column_name; end if;
  end loop;
end $$;

-- 元行の設定値・表示名はそのまま保管。削除せず、承認した元選手のみ連携解除・無効化する。
update public.player_profiles p set linked_auth_user_id = null, is_active = false
from approved_profile_map m where p.id = m.source_id;

do $$
declare r record; total bigint;
begin
  for r in select * from player_profile_backup_20261022.manifest loop
    execute format('select count(*) from %I.%I', r.source_schema, r.source_table) into total;
    if total <> r.row_count then raise exception '%.% の件数が変化しました。ロールバックします', r.source_schema, r.source_table; end if;
    execute format(
      'insert into player_profile_backup_20261022.repair_changes (source_schema, source_table, row_id, before_row, after_row)
       select %L, %L, t.id, to_jsonb(b), to_jsonb(t) from %I.%I t join player_profile_backup_20261022.%I b using (id)
       where to_jsonb(b) is distinct from to_jsonb(t)',
      r.source_schema, r.source_table, r.source_schema, r.source_table, r.backup_table
    );
  end loop;
end $$;

select * from approved_profile_map;
select source_table, row_id, before_row, after_row from player_profile_backup_20261022.repair_changes order by source_table, row_id;
-- 確認用。移行元への参照が残っていないことを、04のSQLでも確認する。
select p.id, p.linked_auth_user_id, p.is_active, p.display_name, p.bio, p.play_level, p.dominant_hand, p.preferred_position, p.activity_area
from public.player_profiles p where p.id in (select source_id from approved_profile_map union select target_id from approved_profile_map);
rollback;
