-- 読み取り専用。氏名・メール・試合ID・得点の実値は取得せず、不整合の集計だけ返す。
begin read only;
set local statement_timeout='30s';
with duplicated as (
 select m.id,e.status,e.is_deleted,m.completed,count(*) result_rows,
 count(distinct jsonb_build_array(r.score_a,r.score_b,r.winner_team)) variants
 from public.match_results r join public.matches m on m.id=r.match_id join public.events e on e.id=m.event_id
 where e.event_mode='auto' group by m.id,e.status,e.is_deleted,m.completed having count(*)>1
)
select jsonb_build_object(
 'duplicate_matches',count(*),'extra_result_rows',coalesce(sum(result_rows-1),0),'max_results_per_match',coalesce(max(result_rows),0),
 'identical_results',count(*) filter(where variants=1),'conflicting_results',count(*) filter(where variants>1),
 'active_events',count(*) filter(where status='active' and not is_deleted),'closed_events',count(*) filter(where status='closed' and not is_deleted),
 'deleted_events',count(*) filter(where is_deleted),'completed_matches',count(*) filter(where completed)
) from duplicated;
rollback;
