-- 自動実行禁止。01の調査・02のバックアップと本人/管理者の承認後だけ使用する。
-- 本版は3アカウント53行の確認用プランを設定済み。末尾はROLLBACKのまま。保持先承認後にだけCOMMITを検討する。
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

-- 【今回の移行方針】3アカウント合計53行（ごーき51件、瀧田1件、上田1件）。
-- 瀧田・上田の保持先は暫定案。所属・戦績と本人/管理者承認を確認するまでCOMMITしない。
-- 安倍・テスト01は移行元・移行先のどちらにも含めず、連携解除・無効化しない。
-- 移行プラン開始
insert into approved_profile_map (source_id, target_id) values
  -- ごーき51件を指定の保持先に移す。
  ('050325e2-978f-407a-90ab-d020d6262467', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('05bf1c3a-a20a-4ce2-9623-484650725ede', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('0748b8f3-3985-404f-ac6b-68c8c6edff3f', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('078817a3-21b3-4146-bb19-8e955343ef6a', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('13d1ec3b-4609-4829-b3ad-92aec0913a7b', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('1f75daef-88bf-4e04-9c35-4043c3d95ef3', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('23f956f8-649f-4023-aec7-cb2cc2e44366', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('2badb486-105f-433f-9b01-6e15c785d78a', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('2d1cbe83-3df6-402e-8a9c-44040149ec3f', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('2fc65e9a-9493-455d-82fb-3d4f1315913c', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('31ac2add-1e18-4b6c-a88e-5eeca5f18cda', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('3ac08fc9-8c2a-4809-ae5a-0bc37dde48ad', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('3ca639bc-63ec-49de-b8eb-dd6fa61743f6', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('4e82b9bc-bfad-4df4-ac88-be6dd0daa70a', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('54103e89-5d69-4ffd-8551-21896b365252', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('5625b4ce-f730-47ff-87d4-3162a77c4a2a', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('5a134566-ca1c-4035-bce4-8380f9acf7f3', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('61bd31dc-6df4-4e61-9c6d-6dab754eaa69', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('627e440c-7755-4f35-8464-294e51c171f8', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('646921f8-e54d-4470-b945-d2dd90284d92', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('67bbf4d7-de3d-45b5-9c24-2fc1c6f10c5e', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('68a90ccc-5e28-4114-ab6b-a0fd982751e4', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('6da7c726-c759-4178-a1ea-7835aed50271', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('6e320ae9-a6ee-435f-80b4-52fb2e0f41ff', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('6f638451-0f1e-43a3-a09d-1d715227d511', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('764e01a7-1809-48b6-a98f-81f1ade8efa9', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('7ca92917-f3a9-42dc-a957-afed7a4d0ec8', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('7dd3cb2d-20c2-48fc-99b6-4fec2f8c3048', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('7f2a6e94-1c0a-45cc-973b-a6033b1062ef', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('88179406-1104-401e-83a2-02534800c14d', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('8e0f7b74-ea26-4572-95c8-daa7fc65d883', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('8f8bd764-dfc4-4f58-90b3-8118c4289b75', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('9116471e-5550-4315-9dfe-77f2b1057c0a', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('9496fe4e-7392-4190-953a-9f255852bc14', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('a077aaeb-64e0-42b4-8765-10256856289a', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('ad66e6b5-cc3e-4ea6-a75c-02b0776f0440', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('b04ff7f2-af46-4dfb-ab9e-867018b65d68', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('b44a6f96-ce12-4bb8-8641-ed2978d18a29', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('c7b08fa2-1440-4dd1-a0f0-33ac95931612', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('c7b9950e-23e3-4865-ad5b-01e7c3783f30', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('d6f67f0f-6ca9-44d2-bbd3-18d2a2d27e2d', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('dbfaf04d-484d-4d32-b670-7046f320fca0', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('e34dda13-fe46-49b8-89e9-9cd8fd42783b', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('e779648e-bc4e-4d72-b8ce-87a352cd3b0c', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('e81616fe-ed1f-44ea-bf6a-1e8d708849c8', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('ebd6b396-3795-47f3-990f-775538f981ca', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('f4460d9d-288f-46ce-bf72-0720fbd3efb3', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('f7f8fe2b-1a8e-40fd-866e-29cd7d2a17f0', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('f929feec-3c04-4024-a593-416689830afc', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('fb0c73fb-abb0-467a-90b1-aa011f6cc4ae', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  ('fcac1a0c-1443-4dbe-86e9-2a73245472bd', 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'),
  -- 瀧田（たっきー → 瀧田）。保持先候補。
  ('de28fa8d-4f04-4ed5-88d6-7b5b10cb6081', '2a843167-2875-4c8b-b2b2-98860a2f2517'),
  -- 上田（ueken9843 → 上田）。保持先候補。
  ('78f3fc0c-fe89-47eb-b9a8-fbdf541edcb1', 'acce99ab-1bd7-47c3-bb8b-8c80e7d22466');
-- 移行プラン終了

-- 件数だけでなく保持先IDと内訳も固定し、対象外IDはどちらの列への混入も止める。
do $$
begin
  if not exists (select 1 from approved_profile_map) then raise exception '承認済みプランが未設定です。変更は行いません'; end if;
  if exists (
    select 1 from approved_profile_map
    where source_id in (
      '3f787ec6-d6f4-48ee-934d-7f00bacda625'::uuid, '71d12eaf-fcd3-4df2-a7d4-5319498f9643'::uuid
    ) or target_id in (
      '3f787ec6-d6f4-48ee-934d-7f00bacda625'::uuid, '71d12eaf-fcd3-4df2-a7d4-5319498f9643'::uuid
    )
  ) then raise exception '対象外の安倍・テスト01が移行元または移行先に含まれています'; end if;
  if (select count(*) from approved_profile_map) <> 53 or (select count(distinct target_id) from approved_profile_map) <> 3 then
    raise exception '確認対象マップの件数または移行先の人数が想定外です（53行・3名）';
  end if;
  if exists (
    select 1 from (select target_id, count(*) as source_count from approved_profile_map group by target_id) actual
    full join (values
      ('ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c'::uuid, 51),
      ('2a843167-2875-4c8b-b2b2-98860a2f2517'::uuid, 1),
      ('acce99ab-1bd7-47c3-bb8b-8c80e7d22466'::uuid, 1)
    ) expected(target_id, source_count) using (target_id)
    where actual.source_count is distinct from expected.source_count
  ) then raise exception '保持先IDまたは移行元の内訳が確認対象プラン（51・1・1）と異なります'; end if;
end $$;

do $$
declare r record; changed boolean; field_name text; conflict_found boolean;
begin
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
  if (select count(distinct p.linked_auth_user_id) from public.player_profiles p where p.id in (select target_id from approved_profile_map)) <> 3 then
    raise exception '保持先は異なる3アカウントであることを確認してください';
  end if;

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
