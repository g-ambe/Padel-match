-- 問題発生時の手動停止用。実データ・設定・履歴・利用済みの印は削除しない。
-- 先にREADMEの復旧手順を確認。利用済み開催の生成・終了・再開を停止するため、運営者へ周知する。
begin;
set local lock_timeout='5s';
revoke execute on function public.replace_event_fixed_pairs(uuid,bigint,jsonb,uuid),
public.create_fixed_pair_round(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid),
public.finish_fixed_pair_event(uuid,bigint,boolean,text) from public,anon,authenticated,service_role;
-- SELECT・RLS補助関数・追加ガードは維持する。通常イベントを権限エラーにせず、利用済みの誤終了を防ぐ。
commit;
