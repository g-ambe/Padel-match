-- 承認済み修復・外部バックアップ・隔離試験後のみ。既存行を削除・統合しない。
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.matches,public.match_results in share row exclusive mode;
do $$begin
 if current_user in('anon','authenticated','service_role') then raise exception '管理用接続で適用してください';end if;
 if exists(select 1 from public.match_results where match_id is not null group by match_id having count(*)>1) then raise exception '結果の重複が残っています。自動整理せず停止します';end if;
 if to_regprocedure('public.delete_friendly_match(uuid,uuid,jsonb,uuid)') is null then raise exception '0041・0042を先に適用してください';end if;
end$$;
alter table public.match_results add constraint match_results_one_per_match unique(match_id);
notify pgrst,'reload schema';
commit;
