-- 読み取り専用。SQL Editorの管理者として0039適用前に実行する。
select id, linked_auth_user_id, display_name, is_active, created_at
from public.player_profiles order by linked_auth_user_id nulls last, id;
-- 1行でも出たら停止。本人の選択・所属・戦績を確認し、既存IDを勝手に選び直さない。
select linked_auth_user_id, array_agg(id order by id) as conflicting_profile_ids
from public.player_profiles where is_active and linked_auth_user_id is not null
 group by linked_auth_user_id having count(*) > 1;
select p.id, p.linked_auth_user_id from public.player_profiles p
left join auth.users u on u.id = p.linked_auth_user_id
where p.is_active and p.linked_auth_user_id is not null and u.id is null;
select c.conname, c.conrelid::regclass as referencing_table, pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.contype='f' and c.confrelid='public.player_profiles'::regclass order by 2,1;
select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ('player_profiles','club_members','event_participants','join_requests');
select event_object_schema, event_object_table, trigger_name, action_statement from information_schema.triggers
where event_object_schema='public' and event_object_table in ('player_profiles','club_members','event_participants','join_requests','event_team_matches','official_matches','profiles','app_admins');
select * from pg_policies where schemaname='public' and tablename in ('player_profiles','profiles','club_members','join_requests','app_admins','notifications');
select grantee,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name in ('player_profiles','profiles','club_members','join_requests','app_admins','notifications');
select grantee,table_name,column_name,privilege_type from information_schema.role_column_grants
where table_schema='public' and table_name in ('player_profiles','profiles','club_members','join_requests','app_admins','notifications');
-- 旧profile_idは認証側ID。選手UUIDとして付け替えない。連携先と矛盾する行は個別確認する。
select 'club_members' as source_table,cm.id,cm.profile_id,cm.player_profile_id,pp.linked_auth_user_id
from public.club_members cm join public.player_profiles pp on pp.id=cm.player_profile_id
where cm.profile_id is not null and pp.linked_auth_user_id is not null and cm.profile_id<>pp.linked_auth_user_id
union all
select 'event_participants',ep.id,ep.profile_id,ep.player_profile_id,pp.linked_auth_user_id
from public.event_participants ep join public.player_profiles pp on pp.id=ep.player_profile_id
where ep.profile_id is not null and pp.linked_auth_user_id is not null and ep.profile_id<>pp.linked_auth_user_id;
select id,club_id,target_club_member_id,requester_auth_user_id,status,created_at,
  (status='pending' and created_at+interval '7 days' <= now()) as already_expired
from public.join_requests order by created_at;
-- 旧加入申請には新仕様の統合同意がない。対象選手ありの旧申請は本人が再申請する。
select (select count(*) from public.player_profiles) as all_profiles,
  (select count(*) from public.player_profiles where is_active) as active_profiles,
  (select count(*) from public.club_members) as memberships,
  (select count(*) from public.event_participants) as participants,
  (select count(*) from public.match_players) as match_players,
  (select count(*) from public.match_results) as results;
