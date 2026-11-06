-- 呼出側が読み取り専用トランザクションを使用。出力は暗号化保管専用でログ禁止。
with ranked as (
 select r.id,first_value(r.id) over(partition by r.match_id order by r.created_at asc nulls last,r.id) keeper_id,
 count(*) over(partition by r.match_id) n from public.match_results r where r.match_id is not null
)
select coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(r),'keeper_id',x.keeper_id,'match',to_jsonb(m),'event',to_jsonb(e)) order by r.id),'[]')
from ranked x join public.match_results r on r.id=x.id join public.matches m on m.id=r.match_id join public.events e on e.id=m.event_id where x.n>1;
