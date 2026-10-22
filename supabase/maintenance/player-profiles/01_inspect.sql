-- 管理者のSQL Editorで実行する読み取り専用の調査。アプリからは実行しない。
begin transaction read only;
set local row_security = off;

select current_user as execution_role, count(*) as total,
  count(linked_auth_user_id) as linked,
  count(distinct linked_auth_user_id) as accounts
from public.player_profiles;

-- linked_auth_user_idの制約・索引・自動作成トリガーも確認する。
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'player_profiles';
select t.tgname, pg_get_triggerdef(t.oid) as definition
from pg_trigger t where t.tgrelid = 'public.player_profiles'::regclass and not t.tgisinternal;

-- 実DBの外部キーを列単位で列挙。コードに存在しない追加の参照も見落とさない。
select ns.nspname as referencing_schema, rel.relname as referencing_table,
  att.attname as referencing_column, c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class rel on rel.oid = c.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
join lateral unnest(c.conkey) with ordinality as k(attnum, position) on true
join pg_attribute att on att.attrelid = c.conrelid and att.attnum = k.attnum
where c.contype = 'f' and c.confrelid = 'public.player_profiles'::regclass
order by 1, 2, 3;

-- 外部キーの無い参照も手動確認。official_matchesの2列は現行スキーマではFK無し。
select table_schema, table_name, column_name
from information_schema.columns
where table_schema = 'public' and (column_name like '%profile_id' or column_name = 'linked_auth_user_id')
order by table_name, column_name;

with duplicate_accounts as (
  select linked_auth_user_id from public.player_profiles
  where linked_auth_user_id is not null group by linked_auth_user_id having count(*) > 1
)
select pp.*,
  (select count(*) from unnest(array[pp.bio, pp.play_level, pp.dominant_hand, pp.preferred_position, pp.activity_area]) v where nullif(btrim(v), '') is not null) as detail_fields,
  (select jsonb_agg(jsonb_build_object('membership_id', cm.id, 'club_id', cm.club_id, 'role', cm.role, 'is_active', cm.is_active)) from public.club_members cm where cm.player_profile_id = pp.id) as memberships,
  (select count(*) from public.event_participants ep where ep.player_profile_id = pp.id) as event_participations,
  (select count(distinct mp.match_id) from public.event_participants ep join public.match_players mp on mp.participant_id = ep.id where ep.player_profile_id = pp.id) as friendly_matches,
  (select count(*) from public.event_team_matches tm where pp.id = any(array[tm.team_a_player1_profile_id, tm.team_a_player2_profile_id, tm.team_b_player1_profile_id, tm.team_b_player2_profile_id])) as team_matches,
  (select count(*) from public.official_matches om where pp.id in (om.our_player1_profile_id, om.our_player2_profile_id)) as official_matches,
  (select count(*) from public.join_requests jr where jr.requester_player_profile_id = pp.id) as join_requests
from public.player_profiles pp join duplicate_accounts d using (linked_auth_user_id)
order by pp.linked_auth_user_id, pp.id;

-- 同じアカウントの別選手が同じグループに存在すると、そのまま参照を付け替えられない。
select cm.club_id, pp.linked_auth_user_id, array_agg(cm.id) as membership_ids, array_agg(pp.id) as player_ids
from public.club_members cm join public.player_profiles pp on pp.id = cm.player_profile_id
where pp.linked_auth_user_id is not null
group by cm.club_id, pp.linked_auth_user_id having count(*) > 1;

select ep.event_id, pp.linked_auth_user_id, array_agg(ep.id) as participant_ids, array_agg(pp.id) as player_ids
from public.event_participants ep join public.player_profiles pp on pp.id = ep.player_profile_id
where pp.linked_auth_user_id is not null
group by ep.event_id, pp.linked_auth_user_id having count(*) > 1;

-- player_stats.profile_id等はprofiles.id（認証側）参照。選手IDとして付け替えない。
select c.conrelid::regclass as referencing_table, pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass;
rollback;
