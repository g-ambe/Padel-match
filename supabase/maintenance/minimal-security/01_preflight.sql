-- 初回適用前の読み取り専用点検。対象件数・理由・対応案を確認し、データ補正は別承認にする。
begin transaction read only;
set local statement_timeout='60s';
do $$ begin
  if to_regprocedure('profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)') is null then raise exception '0039の本人承認機能が必要です'; end if;
  if to_regnamespace('security_private') is not null or to_regclass('public.public_player_profiles') is not null then
    raise exception '既存のセキュリティ実装があります。新旧を混在させず差分を確認してください'; end if;
end $$;
select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname;
select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' order by table_name,grantee;
select table_name,column_name,grantee,privilege_type from information_schema.role_column_grants where table_schema='public' order by table_name,column_name;
-- 試合結果の重複だけは一意制約の前提。勝手に削除・代表選択しない。
select match_id,count(*) result_rows from public.match_results where match_id is not null group by match_id having count(*)>1;
select count(*) orphan_results from public.match_results where match_id is null;
select count(*) invalid_parent_rows from public.matches m join public.rounds r on r.id=m.round_id where m.event_id is distinct from r.event_id;
select count(*) invalid_players from public.match_players mp join public.matches m on m.id=mp.match_id join public.event_participants ep on ep.id=mp.participant_id where m.event_id is distinct from ep.event_id;
select count(*) unresolved_memberships from public.club_members where player_profile_id is null;
select count(*) legacy_memberships_without_player from public.club_members cm where cm.player_profile_id is null and not exists(select 1 from public.player_profiles p where p.linked_auth_user_id=cm.profile_id and p.is_active);
select count(*) legacy_stat_rows,count(*) filter(where club_id is null) null_club_rows from public.player_stats;
select count(*) inconsistent_legacy_counts from public.player_stats where match_count<win_count+loss_count or match_count<0 or win_count<0 or loss_count<0;
-- これらの旧累計は今回の保存・表示に使用せず、そのまま保持する。
select count(*) duplicate_active_accounts from (select linked_auth_user_id from public.player_profiles where is_active and linked_auth_user_id is not null group by linked_auth_user_id having count(*)>1) d;
rollback;
