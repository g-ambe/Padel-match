-- 復旧時の手動実行専用。修正版・03_verifyの確認とユーザー承認後に使用する。
-- 0040を再実行せず、新RPCの元の認証限定EXECUTEだけを戻す。データ・既存RLSは変更しない。
begin;
set local lock_timeout='5s';
do $$ begin
 if current_user in('anon','authenticated','service_role') then raise exception '管理ロールで実行してください'; end if;
 if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.event_fixed_pair_rounds') and attname='effective_pairs' and attnotnull and not attisdropped)
 or (select count(*) from pg_class where oid in(to_regclass('public.event_fixed_pair_state'),to_regclass('public.event_fixed_pairs'),to_regclass('public.event_fixed_pair_rounds')) and relrowsecurity)<>3
 or (select count(*) from pg_proc p where p.oid in(to_regprocedure('public.replace_event_fixed_pairs(uuid,bigint,jsonb,uuid)'),to_regprocedure('public.create_fixed_pair_round(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid)'),to_regprocedure('public.finish_fixed_pair_event(uuid,bigint,boolean,text)')) and p.prosecdef and exists(select 1 from unnest(p.proconfig) c where c in('search_path=','search_path=""')))<>3
 or (select count(*) from pg_trigger where tgname in('fixed_pair_event_finish','fixed_pair_round_create','fixed_pair_match_create','fixed_pair_lineup') and tgenabled='O')<>4
 then raise exception '現行0040の定義と異なります。再調査するまで再開しません'; end if;
end $$;
revoke execute on function public.replace_event_fixed_pairs(uuid,bigint,jsonb,uuid),
public.create_fixed_pair_round(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid),
public.finish_fixed_pair_event(uuid,bigint,boolean,text) from public,anon,service_role;
grant execute on function public.replace_event_fixed_pairs(uuid,bigint,jsonb,uuid),
public.create_fixed_pair_round(uuid,bigint,integer,integer,text,uuid[],jsonb,uuid),
public.finish_fixed_pair_event(uuid,bigint,boolean,text) to authenticated;
commit;
