-- 管理者がSQL Editorで手動実行する読み取り専用の確認。個人名・スコアの内容は出力しない。
begin read only;
-- この結果が0行であること。既存ポリシー・権限・保護トリガーがバックアップと一致する。
with current_metadata as (
select 'policy' kind,p.tablename||'.'||p.policyname key,to_jsonb(p) value from pg_policies p
where schemaname='public' and tablename in('events','event_participants','rounds','matches','match_players','match_results')
union all select 'acl',c.relname,jsonb_build_object('table',c.relacl,'columns',(select jsonb_agg(jsonb_build_array(a.attname,a.attacl) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped))
from pg_class c where c.oid in('public.events'::regclass,'public.event_participants'::regclass,'public.rounds'::regclass,'public.matches'::regclass,'public.match_players'::regclass,'public.match_results'::regclass)
union all select 'trigger',c.relname||'.'||t.tgname,jsonb_build_object('definition',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid),'enabled',t.tgenabled)
from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.oid in('public.events'::regclass,'public.event_participants'::regclass,'public.rounds'::regclass,'public.matches'::regclass,'public.match_players'::regclass,'public.match_results'::regclass)
)
select b.kind,b.key from event_fixed_pair_backup_20261102.metadata b left join current_metadata c using(kind,key) where c.value is distinct from b.value;
-- 3表ともRLS=true。anonはすべてfalse、authenticatedはSELECT=true／書込み=false。
select c.relname,c.relrowsecurity,
has_table_privilege('anon',c.oid,'SELECT') anon_select,
has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE') anon_write,
has_table_privilege('authenticated',c.oid,'SELECT') authenticated_select,
has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') authenticated_write
from pg_class c where c.oid in('public.event_fixed_pair_state'::regclass,'public.event_fixed_pairs'::regclass,'public.event_fixed_pair_rounds'::regclass);
select tablename,policyname,roles,cmd,qual from pg_policies where schemaname='public' and tablename like 'event_fixed_pair%';
-- 新RPCのsearch_pathは空、SECURITY DEFINER=true、anon=false、authenticated=true。
select p.oid::regprocedure function,p.prosecdef,p.proconfig,
has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in('get_event_fixed_pair_state','replace_event_fixed_pairs','create_fixed_pair_round','finish_fixed_pair_event');
-- 下記4件の不整合がすべて0件。閉じた利用済みイベントだけ反映方法が確定する。
select '重複固定' check_name,count(*) violations from (
 select event_id,participant_id from (select event_id,a participant_id from event_fixed_pairs union all select event_id,b from event_fixed_pairs) p group by event_id,participant_id having count(*)>1
) duplicates
union all select '別イベントの選手参照',count(*) from event_fixed_pairs f left join event_participants a on a.event_id=f.event_id and a.id=f.a left join event_participants b on b.event_id=f.event_id and b.id=f.b where a.id is null or b.id is null
union all select '実使用の印が未記録',count(*) from event_fixed_pair_rounds r left join event_fixed_pair_state s on s.event_id=r.event_id where jsonb_array_length(r.effective_pairs)>0 and not coalesce(s.used_fixed_pairs,false)
union all select '終了した利用済みの反映方法未確定',count(*) from event_fixed_pair_state s join events e on e.id=s.event_id where s.used_fixed_pairs and e.status='closed' and e.stats_mode not in('official','record_only');
select '固定設定' item,count(*) rows from event_fixed_pairs union all select '利用状態',count(*) from event_fixed_pair_state union all select '生成の監査',count(*) from event_fixed_pair_rounds;
rollback;
