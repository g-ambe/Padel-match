-- 読み取り専用。0039の手動適用直後と試験後に実行する。
-- いずれも0行が期待値。実アカウントでの新規登録・承認試験はステージングで行う。
select linked_auth_user_id,array_agg(id) from public.player_profiles where is_active and linked_auth_user_id is not null group by linked_auth_user_id having count(*)>1;
select m.id,m.source_player_profile_id,m.target_player_profile_id from public.player_profile_merges m
join public.player_profiles s on s.id=m.source_player_profile_id join public.player_profiles t on t.id=m.target_player_profile_id
where m.restored_at is null and (s.is_active or s.linked_auth_user_id is not null or not t.is_active or t.linked_auth_user_id is distinct from m.target_auth_user_id);
select 'club_members' as source_table,cm.id from public.club_members cm join public.player_profile_merges m on m.source_player_profile_id=cm.player_profile_id and m.restored_at is null
union all select 'event_participants',ep.id from public.event_participants ep join public.player_profile_merges m on m.source_player_profile_id=ep.player_profile_id and m.restored_at is null
union all select 'join_requests',jr.id from public.join_requests jr join public.player_profile_merges m on m.source_player_profile_id=jr.requester_player_profile_id and m.restored_at is null
union all select 'event_team_matches',tm.id from public.event_team_matches tm join public.player_profile_merges m on m.source_player_profile_id in (tm.team_a_player1_profile_id,tm.team_a_player2_profile_id,tm.team_b_player1_profile_id,tm.team_b_player2_profile_id) and m.restored_at is null
union all select 'official_matches',om.id from public.official_matches om join public.player_profile_merges m on m.source_player_profile_id in (om.our_player1_profile_id,om.our_player2_profile_id) and m.restored_at is null;
select mp.id from public.match_players mp left join public.event_participants ep on ep.id=mp.participant_id where mp.participant_id is not null and ep.id is null;
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='profile_link_private' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'));
select role_name,column_name from (values ('anon'),('authenticated')) roles(role_name) cross join (values ('linked_auth_user_id'),('is_active'),('id')) cols(column_name)
where has_column_privilege(role_name,'public.player_profiles',column_name,'UPDATE');
select role_name from (values ('anon'),('authenticated')) roles(role_name) where has_column_privilege(role_name,'public.profiles','email','SELECT');
select * from public.player_profile_merges order by merged_at desc;
select id,status,expires_at,reviewed_at from public.player_profile_link_requests order by created_at desc;
-- 0039の直後、利用を再開する前だけ実行。既存選手に新しい作成者列以外の変更がないこと。
do $$ declare backup_name text; changed boolean; begin
  select backup_table into backup_name from player_profile_link_backup_20261023.manifest where source_schema='public' and source_table='player_profiles';
  if backup_name is null then raise exception '適用前バックアップを確認してください'; end if;
  execute format('select exists ((select to_jsonb(p)-''created_by_auth_user_id'' from public.player_profiles p except all select to_jsonb(b) from player_profile_link_backup_20261023.%I b) union all (select to_jsonb(b) from player_profile_link_backup_20261023.%I b except all select to_jsonb(p)-''created_by_auth_user_id'' from public.player_profiles p))',backup_name,backup_name) into changed;
  if changed then raise notice '適用前から選手データが変わっています。承認・作成試験後なら監査と照合し、適用直後なら利用再開を止めて確認してください'; end if;
end $$;
