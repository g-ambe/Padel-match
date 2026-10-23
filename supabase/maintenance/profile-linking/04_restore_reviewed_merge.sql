-- 自動実行禁止。最新バックアップ取得・本人/管理者の確認後、監査IDを1件だけ明示する。
-- 通常画面からの誤統合取消は実装しない。末尾はROLLBACKのまま試す。
begin;
set local row_security = off;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
create temporary table reviewed_merge_restore(id uuid primary key) on commit drop;
-- 復旧対象挿入位置
-- insert into reviewed_merge_restore values ('承認済みの監査UUID');
do $$
declare m public.player_profile_merges; change record; current_row jsonb; assignments text; total integer;
begin
  if (select count(*) from reviewed_merge_restore)<>1 then raise exception '復旧対象の監査IDを1件だけ本人/管理者が確認してください'; end if;
  perform profile_link_private.serialize_operations();
  perform profile_link_private.lock_references();
  select * into m from public.player_profile_merges where id=(select id from reviewed_merge_restore) for update;
  if not found or m.restored_at is not null then raise exception '有効な統合監査が見つからないか復旧済みです'; end if;
  if not exists (select 1 from profile_link_private.merge_changes where merge_id=m.id) then raise exception '変更前後の監査がありません。自動的には復旧できません'; end if;
  for change in select * from profile_link_private.merge_changes where merge_id=m.id loop
    execute format('select to_jsonb(t) from %I.%I t where id=$1',change.source_schema,change.source_table) into current_row using change.row_id;
    if current_row is distinct from change.after_row then raise exception '統合後に %.% の行 % が編集・削除されています。新しい情報を上書きせず中止します',change.source_schema,change.source_table,change.row_id; end if;
  end loop;
  -- 元プロフィールを先に戻し、当時の参照・役職・状態・日時を変更前JSONから復元する。
  for change in select * from profile_link_private.merge_changes where merge_id=m.id order by (source_table='player_profiles') desc,source_schema,source_table,row_id loop
    select string_agg(format('%1$I=b.%1$I',a.attname),',') into assignments from pg_attribute a
      where a.attrelid=format('%I.%I',change.source_schema,change.source_table)::regclass and a.attnum>0 and not a.attisdropped and a.attname<>'id' and a.attgenerated='';
    execute format('update %1$I.%2$I t set %3$s from jsonb_populate_record(null::%1$I.%2$I,$1) b where t.id=$2',change.source_schema,change.source_table,assignments) using change.before_row,change.row_id;
    get diagnostics total=row_count;
    if total<>1 then raise exception '復旧対象の更新件数が1件ではありません'; end if;
  end loop;
  update public.player_profile_merges set restored_at=now(),restored_by=session_user where id=m.id;
  update public.player_profile_link_requests set status='cancelled' where id=m.link_request_id;
  update public.join_requests set status='cancelled' where id=m.join_request_id;
  insert into public.notifications(target_auth_user_id,type,title,body,related_club_id,related_profile_link_request_id,related_join_request_id)
    values(m.target_auth_user_id,'profile_merge_restored','管理者がプロフィール統合を復旧しました','所属と戦績をご確認ください',m.club_id,m.link_request_id,m.join_request_id);
end $$;
select * from public.player_profile_merges where id in (select id from reviewed_merge_restore);
rollback;
