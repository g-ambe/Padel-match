-- TASK-08 H14: read-only summary of score, match and historical membership invariants.
-- Intended for both staging and production; NEVER repair user results here.
-- Returns aggregate counts only; no player names, UUIDs, scores per match, token
-- values, event dates, or other identifying event data.
BEGIN READ ONLY;
SET LOCAL statement_timeout='25s';
SELECT jsonb_build_object(
 'read_only',current_setting('transaction_read_only'),
 'events',(SELECT count(*) FROM public.events),
 'friendly_matches',(SELECT count(*) FROM public.matches),
 'friendly_results',(SELECT count(*) FROM public.match_results),
 'match_result_without_match',(SELECT count(*) FROM public.match_results mr LEFT JOIN public.matches m ON m.id=mr.match_id WHERE m.id IS NULL),
 'duplicate_results_per_match',(SELECT count(*) FROM (SELECT match_id FROM public.match_results GROUP BY match_id HAVING count(*)>1) c),
 'completed_match_without_result',(SELECT count(*) FROM public.matches m WHERE m.completed AND NOT EXISTS(SELECT 1 FROM public.match_results r WHERE r.match_id=m.id)),
 'result_for_uncompleted_match',(SELECT count(*) FROM public.match_results r JOIN public.matches m ON m.id=r.match_id WHERE NOT m.completed),
 'negative_scores',(SELECT count(*) FROM public.match_results WHERE score_a<0 OR score_b<0),
 'tied_scores_marked_as_non_draw',(SELECT count(*) FROM public.match_results WHERE score_a=score_b AND winner_team<>'draw'),
 'untied_scores_marked_wrong_winner',(SELECT count(*) FROM public.match_results WHERE
   (score_a>score_b AND winner_team<>'A') OR (score_a<score_b AND winner_team<>'B')),
 'participation_references_different_event',(SELECT count(*) FROM public.match_players mp
   JOIN public.matches m ON m.id=mp.match_id
   JOIN public.event_participants ep ON ep.id=mp.participant_id
   WHERE ep.event_id IS DISTINCT FROM m.event_id),
 'missing_player_profiles_in_history',(SELECT count(*) FROM public.event_participants ep
   LEFT JOIN public.player_profiles pp ON pp.id=ep.player_profile_id
   WHERE ep.player_profile_id IS NOT NULL AND pp.id IS NULL),
 'official_matches',(SELECT count(*) FROM public.official_matches),
 'orphan_official_matches',(SELECT count(*) FROM public.official_matches om
   LEFT JOIN public.official_events oe ON oe.id=om.official_event_id WHERE oe.id IS NULL),
 'official_negative_scores',(SELECT count(*) FROM public.official_matches
   WHERE our_score<0 OR opponent_score<0),
 'official_resolved_without_both_scores',(SELECT count(*) FROM public.official_matches
   WHERE result<>'undecided' AND (our_score IS NULL OR opponent_score IS NULL)),
 'inactive_club_member_rows',(SELECT count(*) FROM public.club_members WHERE NOT is_active),
 'inactive_members_with_historical_participation',(SELECT count(DISTINCT cm.id) FROM public.club_members cm
   JOIN public.event_participants ep ON ep.player_profile_id=cm.player_profile_id
   JOIN public.events e ON e.id=ep.event_id AND e.club_id=cm.club_id
   WHERE NOT cm.is_active),
 'inactive_player_profiles_still_referenced',(SELECT count(DISTINCT ep.player_profile_id)
   FROM public.event_participants ep JOIN public.player_profiles pp ON pp.id=ep.player_profile_id
   WHERE NOT pp.is_active)
) AS report;
ROLLBACK;
