-- DB外バックアップの代用にしない。既存バックアップを上書きしない。
begin isolation level repeatable read;
set local row_security=off;
set local lock_timeout='5s';
lock table public.events,public.event_participants,public.rounds,public.matches,public.match_players,public.match_results,public.event_fixed_pair_state,public.event_fixed_pair_rounds,public.event_fixed_pairs in share mode;
create schema round_lineup_backup_0041;
revoke all on schema round_lineup_backup_0041 from public,anon,authenticated,service_role;
do $$declare t text;begin
 foreach t in array array['events','event_participants','rounds','matches','match_players','match_results','event_fixed_pair_state','event_fixed_pair_rounds','event_fixed_pairs'] loop
  execute format('create table round_lineup_backup_0041.%I as table public.%I',t,t);
 end loop;
end$$;
create table round_lineup_backup_0041.catalog as select now() captured_at,
 (select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='public') policies,
 (select jsonb_agg(jsonb_build_object('table',tgrelid::regclass,'definition',pg_get_triggerdef(oid),'function',pg_get_functiondef(tgfoid))) from pg_trigger where not tgisinternal and tgrelid in('public.events'::regclass,'public.event_participants'::regclass,'public.rounds'::regclass,'public.matches'::regclass,'public.match_players'::regclass,'public.match_results'::regclass)) triggers;
revoke all on all tables in schema round_lineup_backup_0041 from public,anon,authenticated,service_role;
commit;
