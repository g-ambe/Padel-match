-- 読み取り専用。管理者がSQL Editorで実行し、変更前の定義・ACLを外部に保存する。
select table_name,column_name from information_schema.columns
where table_schema='public' and table_name='club_members' order by ordinal_position;
select id,club_id,player_profile_id,role,is_active from public.club_members order by club_id,id;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('club_members','player_profiles','official_events');
select p.oid::regprocedure as signature,pg_get_functiondef(p.oid) as restore_definition,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='profile_link_private' and p.proname in ('club_role','preview','notify_admins'))
 or (n.nspname='public' and p.proname in ('can_manage_player_profile_club','can_edit_player_profile_member','preview_profile_join','request_player_profile_link','review_player_profile_link','submit_profile_join_request','review_profile_join_request','add_provisional_club_member'))
order by 1;
select grantee,privilege_type,column_name from information_schema.role_column_grants
where table_schema='public' and table_name='club_members' and column_name='is_active';
select t.tgrelid::regclass,t.tgname,pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid='public.club_members'::regclass and not t.tgisinternal;
-- 広いUPDATE許可を追加せず、0件更新・42501・42703・42P17の原因と既存定義を確認する。

-- 独自の所属判定がある場合は、この一覧も個別に確認してから02を検討する。
select p.oid::regprocedure,pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','profile_link_private') and p.prokind in ('f','p')
  and p.prosrc like '%club_members%' and p.prosrc like '%status%';
