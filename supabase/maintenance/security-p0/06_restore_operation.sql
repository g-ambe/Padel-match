-- 本番の自動実行は禁止。05で対象件数・理由・復旧方法を提示して承認を得る。
-- 最新バックアップを取得し、書き込み停止後に管理用接続から実行する。
-- 操作後の記録が変わっていれば中止する。既定ROLLBACKで必ず予行する。
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
create temporary table reviewed_operation_restore(request_id uuid primary key,expected_counts jsonb not null) on commit drop;
-- 復旧対象挿入位置
-- insert into reviewed_operation_restore values('承認済みの操作UUID','{"matches":1,"match_results":1,"player_stats":4}');
do $$ declare reviewed record; begin
  if (select count(*) from reviewed_operation_restore)<>1 then raise exception '承認済みの対象とテーブル別件数を1件だけ指定してください'; end if;
  select * into reviewed from reviewed_operation_restore;
  perform security_private.restore_operation(reviewed.request_id,reviewed.expected_counts);
end $$;
-- 実復旧も承認後に限り末尾をCOMMITへ変更する。操作監査を削除しない。
rollback;
