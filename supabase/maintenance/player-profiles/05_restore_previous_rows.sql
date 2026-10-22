-- 03を手動COMMITした後に戻すためのSQL。承認後に管理者が手動実行する。
-- 修復後に同じ行を誰かが編集していた場合は中止し、後からの設定値を上書きしない。
-- 行IDや件数は変えず、記録済みの変更行だけをUPDATEで戻す。最後は既定でROLLBACK。
begin;
set local row_security = off;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare r record; mismatch boolean; assignments text;
begin
  if not exists (select 1 from player_profile_backup_20261022.repair_changes where restored_at is null) then
    raise exception '未復旧の修復記録がありません';
  end if;
  for r in select distinct source_schema, source_table from player_profile_backup_20261022.repair_changes
    where restored_at is null order by source_schema, source_table loop
    execute format('lock table %I.%I in share row exclusive mode', r.source_schema, r.source_table);
    execute format(
      'select exists (select 1 from player_profile_backup_20261022.repair_changes c left join %I.%I t on t.id = c.row_id
       where c.source_schema = %L and c.source_table = %L and c.restored_at is null and to_jsonb(t) is distinct from c.after_row)',
      r.source_schema, r.source_table, r.source_schema, r.source_table
    ) into mismatch;
    if mismatch then raise exception '%.% が修復後に編集・削除されています。後の変更を保護するため復旧を中止します', r.source_schema, r.source_table; end if;
  end loop;

  -- まず元の選手情報・アカウント連携を復元し、その後で参照列を戻す。
  for r in select * from (select distinct source_schema, source_table from player_profile_backup_20261022.repair_changes
    where restored_at is null) affected order by (source_table = 'player_profiles') desc, source_schema, source_table loop
    select string_agg(format('%I = original.%I', a.attname, a.attname), ', ' order by a.attnum) into assignments
    from pg_attribute a where a.attrelid = format('%I.%I', r.source_schema, r.source_table)::regclass
      and a.attnum > 0 and not a.attisdropped and a.attname <> 'id' and a.attgenerated = '';
    execute format(
      'update %I.%I t set %s from player_profile_backup_20261022.repair_changes c,
       lateral jsonb_populate_record(null::%I.%I, c.before_row) original
       where c.source_schema = %L and c.source_table = %L and c.restored_at is null and t.id = c.row_id',
      r.source_schema, r.source_table, assignments, r.source_schema, r.source_table, r.source_schema, r.source_table
    );
    execute format(
      'select exists (select 1 from player_profile_backup_20261022.repair_changes c left join %I.%I t on t.id = c.row_id
       where c.source_schema = %L and c.source_table = %L and c.restored_at is null and to_jsonb(t) is distinct from c.before_row)',
      r.source_schema, r.source_table, r.source_schema, r.source_table
    ) into mismatch;
    if mismatch then raise exception '%.% の復元結果が一致しません。全体をロールバックしてください', r.source_schema, r.source_table; end if;
  end loop;
  update player_profile_backup_20261022.repair_changes set restored_at = transaction_timestamp() where restored_at is null;
end $$;

select source_table, count(*) as restored_rows from player_profile_backup_20261022.repair_changes where restored_at is not null group by source_table;
rollback;
