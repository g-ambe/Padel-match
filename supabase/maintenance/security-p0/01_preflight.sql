-- 読み取り専用。レビュー済みSQLを適用する環境の管理者が実行する。
-- このファイルは本番へ自動実行しない。過去の全migrationの再適用は禁止。
begin transaction read only;
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('profile_link_private.club_role(uuid,uuid)') is null
    or to_regprocedure('profile_link_private.guard_reference()') is null
    or to_regclass('public.player_profile_merges') is null then
    raise exception '0039の本人連携・参照保護が未適用です。履歴だけで判断せず実スキーマを確認してください';
  end if;
  if exists (select 1 from pg_namespace where nspname='security_private')
    or to_regprocedure('public.get_shared_event(text)') is not null then
    raise exception 'P0用オブジェクトが既に存在します。再適用か別実装かを比較し、既存バックアップを再利用してください';
  end if;
  if not exists (select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
    where c.relnamespace='public'::regnamespace and c.relname='events_share_token_unique_idx'
      and i.indisunique and i.indisvalid and i.indrelid='public.events'::regclass) then
    raise exception '共有トークンの有効な一意indexがありません。0039だけでなく共有関連の実スキーマも確認してください';
  end if;
end $$;

select c.relname, c.relrowsecurity, c.relforcerowsecurity,
  pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
  ('clubs','events','event_participants','rounds','matches','match_players','match_results','player_stats');
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public'
order by tablename,policyname;
select table_name,grantee,privilege_type,is_grantable
from information_schema.role_table_grants where table_schema='public'
order by table_name,grantee,privilege_type;
select table_name,column_name,grantee,privilege_type,is_grantable
from information_schema.role_column_grants where table_schema='public'
order by table_name,column_name,grantee,privilege_type;
select n.nspname,p.oid::regprocedure as signature,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','profile_link_private') and p.prokind='f'
order by n.nspname,p.oid::regprocedure::text;

-- 1行でも出る場合は原因と修正後の扱いを確認する。ここでは既存データを補正しない。
select m.id,m.event_id,m.round_id,r.event_id as round_event_id
from public.matches m left join public.rounds r on r.id=m.round_id
where r.id is null or m.event_id is distinct from r.event_id;
select mp.id,mp.match_id,mp.participant_id,m.event_id as match_event_id,ep.event_id as participant_event_id
from public.match_players mp left join public.matches m on m.id=mp.match_id
left join public.event_participants ep on ep.id=mp.participant_id
where m.id is null or ep.id is null or m.event_id is distinct from ep.event_id;
select id,club_id,profile_id from public.player_stats where club_id is null;
-- 旧アカウント専用FKは両ID形式の所属検証へ置き換える。未知の参照先なら適用しない。
select c.conname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attname='profile_id'
where c.conrelid='public.player_stats'::regclass and c.contype='f' and a.attnum=any(c.conkey);
select id,club_id,created_by_auth_user_id from public.events
where club_id is null and created_by_auth_user_id is null;
select club_id,profile_id,count(*) from public.player_stats
group by club_id,profile_id having count(*)>1;
-- 以下は補正候補の算出だけ。保存値を更新・統合・削除しない。
select match_id,count(*) as result_rows from public.match_results group by match_id having count(*)>1;
select id,match_id from public.match_results where winner_team is distinct from
  case when score_a=score_b then 'draw' when score_a>score_b then 'A' else 'B' end;
select r.id,r.event_id,r.round_number from public.rounds r where not exists(select 1 from public.matches m where m.round_id=r.id);
with canonical_stats as (
  select s.*,coalesce(p.id,a.id,s.profile_id) as player_id from public.player_stats s
  left join public.player_profiles p on p.id=s.profile_id
  left join public.player_profiles a on a.linked_auth_user_id=s.profile_id and a.is_active
), actual as (
  select e.club_id,coalesce(ep.player_profile_id,p.id,ep.profile_id) as player_id,
    count(distinct m.id) as played,count(distinct m.id) filter(where mr.winner_team=mp.team) as wins,
    count(distinct m.id) filter(where mr.winner_team<>'draw' and mr.winner_team<>mp.team) as losses
  from public.matches m join public.events e on e.id=m.event_id join public.match_results mr on mr.match_id=m.id
  join public.match_players mp on mp.match_id=m.id join public.event_participants ep on ep.id=mp.participant_id and ep.event_id=e.id
  left join public.player_profiles p on p.linked_auth_user_id=ep.profile_id and p.is_active
  where m.completed and not e.is_deleted and e.stats_mode='official'
  group by e.club_id,coalesce(ep.player_profile_id,p.id,ep.profile_id)
)
select s.id,s.club_id,s.profile_id,s.match_count,s.win_count,s.loss_count,
  coalesce(a.played,0) as proposed_matches,coalesce(a.wins,0) as proposed_wins,coalesce(a.losses,0) as proposed_losses
from canonical_stats s left join actual a on a.club_id=s.club_id and a.player_id=s.player_id
where s.club_id is not null and (s.match_count,s.win_count,s.loss_count) is distinct from
  (coalesce(a.played,0),coalesce(a.wins,0),coalesce(a.losses,0));
with canonical_stats as (
  select s.club_id,coalesce(p.id,a.id,s.profile_id) as player_id from public.player_stats s
  left join public.player_profiles p on p.id=s.profile_id
  left join public.player_profiles a on a.linked_auth_user_id=s.profile_id and a.is_active
)
select club_id,player_id,count(*) as alias_rows from canonical_stats group by club_id,player_id having count(*)>1;
select pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal order by c.relname,t.tgname;
commit;
