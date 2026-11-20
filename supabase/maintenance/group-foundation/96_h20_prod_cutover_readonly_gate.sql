-- TASK-08/H20 Production cutover preflight. READ ONLY, safe on Stage AND Prod.
-- This is an INVENTORY not approval to revoke privileges or deploy a migration.
-- Never emit user IDs, member names, share tokens, JWTs, table rows or event data.
BEGIN READ ONLY;
WITH rel AS (
 SELECT c.relname AS name,c.oid,c.relrowsecurity,c.relkind,
   has_table_privilege('anon',c.oid,'SELECT') AS anon_table,
   has_any_column_privilege('anon',c.oid,'SELECT') AS anon_columns,
   has_any_column_privilege('authenticated',c.oid,'SELECT') AS auth_columns
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN('r','p','v')
),
anon_policies AS (
 SELECT rel.name,COALESCE(bool_or(
   (p.roles @> ARRAY['anon']::name[] OR p.roles @> ARRAY['public']::name[])
   AND p.cmd IN('SELECT','ALL')
 ),false) AS permits_anon_by_policy
 FROM rel LEFT JOIN pg_policies p
  ON p.schemaname='public' AND p.tablename=rel.name
 GROUP BY rel.name
),
public_cols AS (
 SELECT table_name,array_agg(column_name ORDER BY ordinal_position) AS names
 FROM information_schema.columns
 WHERE table_schema='public' AND table_name IN('club_members','player_profiles',
 'profiles','official_events','official_matches','official_opponents','events',
 'event_participants','matches','match_players','match_results')
 AND has_column_privilege('anon',format('%I.%I','public',table_name),column_name,'SELECT')
 GROUP BY table_name
)
SELECT jsonb_build_object(
 'read_only',true,
 'public_relation_count',(SELECT count(*) FROM rel),
 'public_relation_names',(SELECT jsonb_agg(name ORDER BY name) FROM rel),
 'anonymous_potentially_readable_tables',(
    SELECT jsonb_agg(r.name ORDER BY r.name) FROM rel r
    JOIN anon_policies p ON p.name=r.name
    WHERE r.anon_columns AND (NOT r.relrowsecurity OR p.permits_anon_by_policy)
 ),
 'sensitive_anon_column_exposure',(
    SELECT jsonb_agg(jsonb_build_object('table',table_name,'columns',names) ORDER BY table_name) FROM public_cols
 ),
 'sensitive_read_access',(
    SELECT jsonb_agg(jsonb_build_object('table',r.name,'rls',r.relrowsecurity,
      'anon_select_grant',r.anon_table,'anon_any_column_grant',r.anon_columns,
      'anon_select_policy',p.permits_anon_by_policy,'authenticated_column_grant',r.auth_columns)
      ORDER BY r.name)
    FROM rel r JOIN anon_policies p ON p.name=r.name
    WHERE r.name IN('club_members','player_profiles','profiles','events','event_participants',
      'matches','match_players','match_results','official_events','official_matches',
      'official_opponents','clubs','notifications')
 ),
 'application_rpc_present',jsonb_build_object(
  'shared_event_token',to_regprocedure('public.get_shared_event(text,text)') IS NOT NULL,
  'group_roster',to_regprocedure('public.get_club_roster(uuid)') IS NOT NULL,
  'public_group_directory',to_regprocedure('public.get_public_club_directory(uuid)') IS NOT NULL,
  'self_leave',to_regprocedure('public.leave_my_club(uuid,uuid)') IS NOT NULL,
  'named_owner_transfer',to_regprocedure('public.respond_club_owner_transfer(uuid,text)') IS NOT NULL,
  'named_profile_link',to_regprocedure('public.review_player_profile_link_named(uuid,text,text,text,boolean)') IS NOT NULL
 )
) AS release_gate;
ROLLBACK;