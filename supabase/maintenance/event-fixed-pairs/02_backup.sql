-- 手動実行専用。ユーザー承認後、0040より前に実行。既存データの更新・削除はしない。
-- 開催操作が少ない時間に実行し、完了を確認してから適用へ進む。
begin isolation level repeatable read;
set local lock_timeout='5s';
set local statement_timeout='120s';
lock table public.events,public.event_participants,public.rounds,public.matches,public.match_players,public.match_results in share mode;
do $$ begin
 if current_user in('anon','authenticated','service_role') or to_regnamespace('event_fixed_pair_backup_20261102') is not null
 then raise exception '管理ロール・バックアップ名を確認してください。既存バックアップは上書きしません'; end if;
end $$;
create schema event_fixed_pair_backup_20261102;
revoke all on schema event_fixed_pair_backup_20261102 from public,anon,authenticated,service_role;
create table event_fixed_pair_backup_20261102.events as table public.events;
create table event_fixed_pair_backup_20261102.event_participants as table public.event_participants;
create table event_fixed_pair_backup_20261102.rounds as table public.rounds;
create table event_fixed_pair_backup_20261102.matches as table public.matches;
create table event_fixed_pair_backup_20261102.match_players as table public.match_players;
create table event_fixed_pair_backup_20261102.match_results as table public.match_results;
create table event_fixed_pair_backup_20261102.metadata as
select 'policy' kind,p.tablename||'.'||p.policyname key,to_jsonb(p) value from pg_policies p
where schemaname='public' and tablename in('events','event_participants','rounds','matches','match_players','match_results')
union all select 'acl',c.relname,jsonb_build_object('table',c.relacl,'columns',(select jsonb_agg(jsonb_build_array(a.attname,a.attacl) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped))
from pg_class c where c.oid in('public.events'::regclass,'public.event_participants'::regclass,'public.rounds'::regclass,'public.matches'::regclass,'public.match_players'::regclass,'public.match_results'::regclass)
union all select 'trigger',c.relname||'.'||t.tgname,jsonb_build_object('definition',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid),'enabled',t.tgenabled)
from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.oid in('public.events'::regclass,'public.event_participants'::regclass,'public.rounds'::regclass,'public.matches'::regclass,'public.match_players'::regclass,'public.match_results'::regclass);
create table event_fixed_pair_backup_20261102.captured as select now() captured_at,current_user captured_by;
revoke all on all tables in schema event_fixed_pair_backup_20261102 from public,anon,authenticated,service_role;
select 'events' table_name,count(*) rows from event_fixed_pair_backup_20261102.events
union all select 'event_participants',count(*) from event_fixed_pair_backup_20261102.event_participants
union all select 'rounds',count(*) from event_fixed_pair_backup_20261102.rounds
union all select 'matches',count(*) from event_fixed_pair_backup_20261102.matches
union all select 'match_players',count(*) from event_fixed_pair_backup_20261102.match_players
union all select 'match_results',count(*) from event_fixed_pair_backup_20261102.match_results;
commit;
