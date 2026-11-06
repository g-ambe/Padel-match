-- 読み取り専用。個人情報・試合ID・結果ID・実スコアは返さない。
begin read only;
set local statement_timeout='60s';
with d as (
 select r.match_id,count(*) n,count(distinct jsonb_build_array(r.score_a,r.score_b,r.winner_team)) variants,
 min(r.created_at) first_at,max(r.created_at) last_at,count(*) filter(where r.created_at is null) undated
 from public.match_results r where r.match_id is not null group by r.match_id having count(*)>1
), details as (
 select d.*,m.event_id,e.event_mode,e.status,e.is_deleted,e.stats_mode,e.club_id from d
 join public.matches m on m.id=d.match_id join public.events e on e.id=m.event_id
), rows_d as (select r.* from public.match_results r join d on d.match_id=r.match_id)
select jsonb_build_object(
 'captured_at',now(),
 'totals',(select jsonb_build_object('matches',count(*),'events',count(distinct event_id),'groups',count(distinct club_id),'rows',coalesce(sum(n),0),'extra_rows',coalesce(sum(n-1),0),'conflicting',count(*) filter(where variants<>1),'null_dates',coalesce(sum(undated),0)) from details),
 'modes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select event_mode,status,is_deleted,stats_mode,count(*) matches,count(distinct event_id) events,sum(n-1) extra_rows from details group by event_mode,status,is_deleted,stats_mode order by event_mode,status,is_deleted,stats_mode)x),
 'multiplicity',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select n result_rows,count(*) matches from d group by n order by n)x),
 'created_days_utc',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select to_char(created_at at time zone 'UTC','YYYY-MM-DD') as "day",count(*) as "rows" from rows_d group by 1 order by 1)x),
 'time_spread',(select jsonb_build_object('within_second',count(*) filter(where last_at-first_at<=interval '1 second'),'within_minute',count(*) filter(where last_at-first_at<=interval '1 minute'),'over_hour',count(*) filter(where last_at-first_at>interval '1 hour'),'min_at',min(first_at),'max_at',max(last_at)) from d),
 'same_timestamp_groups',(select count(*) from(select match_id,created_at from rows_d group by match_id,created_at having count(*)>1)x),
 'incoming_foreign_keys',(select coalesce(jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(oid)) order by conrelid::regclass::text,conname),'[]') from pg_constraint where contype='f' and confrelid='public.match_results'::regclass),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) order by n.nspname,c.relname),'[]') from pg_depend dep join pg_rewrite w on w.oid=dep.objid join pg_class c on c.oid=w.ev_class join pg_namespace n on n.oid=c.relnamespace where dep.refobjid='public.match_results'::regclass and c.relkind in('v','m')),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname) order by n.nspname,p.proname),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and p.prosrc ilike '%match_results%' and n.nspname not like 'pg_%'),
 'null_match_rows',(select count(*) from public.match_results where match_id is null),
 'orphan_rows',(select count(*) from public.match_results r left join public.matches m on m.id=r.match_id where r.match_id is not null and m.id is null),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) order by indexname),'[]') from pg_indexes where schemaname='public' and tablename='match_results')
);
rollback;
