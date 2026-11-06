-- 適用後の読み取り専用検証。個別ID・実スコアは出力しない。
begin read only;
set local statement_timeout='30s';
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.match_results'::regclass and conname='match_results_one_per_match' and contype='u' and convalidated and pg_get_constraintdef(oid)='UNIQUE (match_id)') then raise exception '一意制約の適用状態が異なります';end if;
 if exists(select 1 from public.match_results where match_id is not null group by match_id having count(*)>1) then raise exception '結果が重複しています';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='score_repair_182' and c.relkind='r' and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE'))) then raise exception '修復監査の権限が想定外です';end if;
 if exists(select 1 from score_repair_182.rows s join score_repair_182.batches b on b.id=s.batch_id where b.restored_at is null and s.id<>s.keeper_id and exists(select 1 from public.match_results r where r.id=s.id)) then raise exception '整理済みのIDが再利用されています';end if;
end$$;
select jsonb_build_object('results',count(*),'logical_matches',count(distinct match_id),'duplicate_matches',count(*)-count(distinct match_id)) from public.match_results;
select count(*) applied_batches,coalesce(sum(removed_rows),0) removed_rows from score_repair_182.batches where restored_at is null;
rollback;
