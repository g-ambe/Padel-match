-- TASK-08/H47: PROD READ ONLY, baseline fingerprints for legacy app tables.
-- Privacy: hash actual whole rows inside Prod DB. Output is ONLY whole-table
-- count + SHA-like MD5 checksums (not individual row hashes, tokens, images,
-- scores, UUIDs, names, event dates or other raw identifiers).
-- No mutation. Do not treat legitimate new user data as unexpected migration drift.
-- Run immediately before and after intended release; compare counts+hashes
-- while accounting for concurrent normal usage.
BEGIN READ ONLY;
SET LOCAL statement_timeout='45s';
WITH base AS (
 SELECT 'clubs' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.clubs x
 UNION ALL
 SELECT 'club_members' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.club_members x
 UNION ALL
 SELECT 'player_profiles' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.player_profiles x
 UNION ALL
 SELECT 'profiles' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.profiles x
 UNION ALL
 SELECT 'events' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.events x
 UNION ALL
 SELECT 'rounds' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.rounds x
 UNION ALL
 SELECT 'event_participants' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.event_participants x
 UNION ALL
 SELECT 'matches' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.matches x
 UNION ALL
 SELECT 'match_players' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.match_players x
 UNION ALL
 SELECT 'match_results' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.match_results x
 UNION ALL
 SELECT 'event_team_matches' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.event_team_matches x
 UNION ALL
 SELECT 'official_events' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.official_events x
 UNION ALL
 SELECT 'official_matches' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.official_matches x
 UNION ALL
 SELECT 'event_fixed_pair_state' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.event_fixed_pair_state x
 UNION ALL
 SELECT 'event_fixed_pairs' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.event_fixed_pairs x
 UNION ALL
 SELECT 'event_fixed_pair_rounds' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.event_fixed_pair_rounds x
 UNION ALL
 SELECT 'friendly_match_operations' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.friendly_match_operations x
 UNION ALL
 SELECT 'player_profile_private' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.player_profile_private x
 UNION ALL
 SELECT 'profile_media_objects' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.profile_media_objects x
 UNION ALL
 SELECT 'profile_media_operations' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.profile_media_operations x
 UNION ALL
 SELECT 'profile_media_attempts' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.profile_media_attempts x
 UNION ALL
 SELECT 'padel_facilities' AS table_name, count(*)::bigint AS row_count,
        md5(coalesce(string_agg(md5(to_jsonb(x)::text),'|' ORDER BY md5(to_jsonb(x)::text)),'')) AS fingerprint
 FROM public.padel_facilities x
), integrity AS (
 SELECT jsonb_build_object(
  'match_result_orphan',(SELECT count(*) FROM public.match_results r LEFT JOIN public.matches m ON m.id=r.match_id WHERE m.id IS NULL),
  'duplicate_results',(SELECT count(*) FROM (SELECT match_id FROM public.match_results GROUP BY match_id HAVING count(*)>1) x),
  'completed_without_result',(SELECT count(*) FROM public.matches m WHERE m.completed AND NOT EXISTS(SELECT 1 FROM public.match_results r WHERE r.match_id=m.id)),
  'result_on_uncompleted',(SELECT count(*) FROM public.match_results r JOIN public.matches m ON m.id=r.match_id WHERE NOT m.completed),
  'participation_other_event',(SELECT count(*) FROM public.match_players mp JOIN public.matches m ON m.id=mp.match_id JOIN public.event_participants ep ON ep.id=mp.participant_id WHERE ep.event_id IS DISTINCT FROM m.event_id),
  'legacy_tied_saved_non_draw',(SELECT count(*) FROM public.match_results WHERE score_a=score_b AND winner_team<>'draw'),
  'legacy_negative_scores',(SELECT count(*) FROM public.match_results WHERE score_a<0 OR score_b<0),
  'legacy_winner_mismatch_untied',(SELECT count(*) FROM public.match_results WHERE (score_a>score_b AND winner_team<>'A') OR (score_a<score_b AND winner_team<>'B')),
  'team_match_missing_event',(SELECT count(*) FROM public.event_team_matches m LEFT JOIN public.events e ON e.id=m.event_id WHERE e.id IS NULL),
  'fixed_state_missing_event',(SELECT count(*) FROM public.event_fixed_pair_state f LEFT JOIN public.events e ON e.id=f.event_id WHERE e.id IS NULL),
  'fixed_pair_missing_event',(SELECT count(*) FROM public.event_fixed_pairs f LEFT JOIN public.events e ON e.id=f.event_id WHERE e.id IS NULL),
  'fixed_round_missing_event',(SELECT count(*) FROM public.event_fixed_pair_rounds f LEFT JOIN public.events e ON e.id=f.event_id WHERE e.id IS NULL),
  'fixed_round_missing_round',(SELECT count(*) FROM public.event_fixed_pair_rounds f LEFT JOIN public.rounds r ON r.id=f.round_id WHERE f.round_id IS NOT NULL AND r.id IS NULL),
  'official_match_missing_event',(SELECT count(*) FROM public.official_matches m LEFT JOIN public.official_events e ON e.id=m.official_event_id WHERE e.id IS NULL),
  'official_negative_scores',(SELECT count(*) FROM public.official_matches WHERE our_score<0 OR opponent_score<0),
  'profile_media_missing_profile',(SELECT count(*) FROM public.profile_media_objects o LEFT JOIN public.player_profiles pp ON pp.id=o.profile_id WHERE o.profile_id IS NOT NULL AND pp.id IS NULL),
  'avatar_object_mismatch',(SELECT count(*) FROM public.player_profile_private p JOIN public.profile_media_objects o ON o.object_key=p.avatar_key WHERE p.profile_id IS DISTINCT FROM o.profile_id OR o.state<>'active'),
  'private_owner_link_mismatch',(SELECT count(*) FROM public.player_profile_private p JOIN public.player_profiles pp ON pp.id=p.profile_id WHERE p.owner_id IS DISTINCT FROM CASE WHEN pp.is_active THEN pp.linked_auth_user_id ELSE NULL END),
  'fixed_pair_rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.event_fixed_pairs'::regclass),
  'media_object_rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.profile_media_objects'::regclass),
  'anon_fixed_pair_read',has_table_privilege('anon','public.event_fixed_pairs','SELECT'),
  'anon_media_object_read',has_table_privilege('anon','public.profile_media_objects','SELECT')
 ) AS report
)
SELECT jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),
 'captured_at',transaction_timestamp(),
 'fingerprint_algorithm','md5-of-sorted-row-md5, all columns, server-side only',
 'row_counts',(SELECT jsonb_object_agg(table_name,row_count) FROM base),
 'full_row_fingerprints',(SELECT jsonb_object_agg(table_name,fingerprint) FROM base),
 'integrity',(SELECT report FROM integrity),
 'migration_history_count',(SELECT count(*) FROM supabase_migrations.schema_migrations)
) AS report;
ROLLBACK;
