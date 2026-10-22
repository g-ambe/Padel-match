-- 03をROLLBACKで試した場合は、元の状態であることを確認する。
-- 手動COMMIT後は件数・参照・変更記録を確認する。管理者で実行。
begin transaction read only;
set local row_security = off;

select count(*) as profiles, count(linked_auth_user_id) as linked,
  count(distinct linked_auth_user_id) as accounts from public.player_profiles;
select linked_auth_user_id, count(*) from public.player_profiles
where linked_auth_user_id is not null group by linked_auth_user_id having count(*) > 1;
select source_table, count(*) as modified_rows, min(applied_at) as applied_at, max(restored_at) as restored_at
from player_profile_backup_20261022.repair_changes group by source_table order by source_table;

do $$
declare r record; total bigint;
begin
  for r in select * from player_profile_backup_20261022.manifest loop
    execute format('select count(*) from %I.%I', r.source_schema, r.source_table) into total;
    if total <> r.row_count then raise exception '%.% の行数がバックアップ時と異なります', r.source_schema, r.source_table; end if;
  end loop;
end $$;

-- 修復後にも全バックアップ表の行数が変わっていないことを確認するSQLを生成する。
select format('select %L as table_name, %s as before_count, count(*) as current_count from %I.%I;',
  source_schema || '.' || source_table, row_count, source_schema, source_table) as verification_sql
from player_profile_backup_20261022.manifest order by source_schema, source_table;

-- 保存したafter_rowが現在の行と一致するか、表ごとの確認SQLを生成する。
select distinct format(
  'select %L as table_name, c.row_id from player_profile_backup_20261022.repair_changes c left join %I.%I t on t.id = c.row_id where c.source_schema = %L and c.source_table = %L and c.restored_at is null and to_jsonb(t) is distinct from c.after_row;',
  source_schema || '.' || source_table, source_schema, source_table, source_schema, source_table
) as changed_after_repair_check
from player_profile_backup_20261022.repair_changes;

-- 移行元（連携解除されたID）への参照が残っていたら個別確認する。
with sources as (
  select row_id from player_profile_backup_20261022.repair_changes
  where source_table = 'player_profiles' and before_row->>'linked_auth_user_id' is not null
    and after_row->>'linked_auth_user_id' is null and restored_at is null
)
select 'club_members' as source_table, cm.id as row_id from public.club_members cm join sources s on s.row_id = cm.player_profile_id
union all select 'event_participants', ep.id from public.event_participants ep join sources s on s.row_id = ep.player_profile_id
union all select 'join_requests', jr.id from public.join_requests jr join sources s on s.row_id = jr.requester_player_profile_id
union all select 'event_team_matches', tm.id from public.event_team_matches tm join sources s on s.row_id = any(array[tm.team_a_player1_profile_id, tm.team_a_player2_profile_id, tm.team_b_player1_profile_id, tm.team_b_player2_profile_id])
union all select 'official_matches', om.id from public.official_matches om join sources s on s.row_id in (om.our_player1_profile_id, om.our_player2_profile_id);

-- match_playersは参加者IDを保持するため、参照切れが増えていないことを確認する。
select mp.id from public.match_players mp left join public.event_participants ep on ep.id = mp.participant_id
where mp.participant_id is not null and ep.id is null;
rollback;
