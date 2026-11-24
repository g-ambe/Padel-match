-- TASK-08 / H14: legacy score semantics and historical-member exposure, read-only.
-- Execute unmodified against BOTH prod and staging. Never correct legacy scores.
-- Output aggregate counts only. No names, IDs, event dates, share tokens or score rows.
BEGIN READ ONLY;
SET LOCAL statement_timeout='25s';

WITH flagged AS (
  SELECT r.match_id, m.event_id, e.club_id, e.event_mode, e.stats_mode,
    e.status, coalesce(e.is_deleted,false) AS deleted, m.completed,
    r.score_a, r.score_b, r.winner_team,
    CASE WHEN r.score_a<0 OR r.score_b<0 THEN 'negative_score' ELSE 'tie_with_saved_winner' END kind
  FROM public.match_results r
  JOIN public.matches m ON m.id=r.match_id
  JOIN public.events e ON e.id=m.event_id
  WHERE r.score_a<0 OR r.score_b<0
     OR (r.score_a=r.score_b AND r.winner_team<>'draw')
), eligible AS (
  SELECT f.*,
    (SELECT count(*) FROM public.match_players mp WHERE mp.match_id=f.match_id) AS player_slots,
    (SELECT count(DISTINCT mp.participant_id) FROM public.match_players mp WHERE mp.match_id=f.match_id) AS distinct_slots,
    (SELECT count(*) FROM public.match_players mp WHERE mp.match_id=f.match_id AND mp.team='A') AS team_a_slots,
    (SELECT count(*) FROM public.match_players mp WHERE mp.match_id=f.match_id AND mp.team='B') AS team_b_slots,
    (SELECT count(*) FROM public.match_players mp JOIN public.event_participants ep
      ON ep.id=mp.participant_id AND ep.event_id=f.event_id
      WHERE mp.match_id=f.match_id AND ep.participant_type<>'guest'
        AND ep.player_profile_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.club_members cm
          WHERE cm.club_id=f.club_id AND cm.player_profile_id=ep.player_profile_id
        )) AS historical_club_member_slots,
    (SELECT count(*) FROM public.match_players mp JOIN public.event_participants ep
      ON ep.id=mp.participant_id AND ep.event_id=f.event_id
      WHERE mp.match_id=f.match_id AND ep.participant_type<>'guest'
        AND ep.player_profile_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.club_members cm
          WHERE cm.club_id=f.club_id AND cm.player_profile_id=ep.player_profile_id AND cm.is_active
        )) AS active_club_member_slots
  FROM flagged f
), countable AS (
  SELECT *, (status='closed' AND stats_mode='official' AND NOT deleted
    AND completed AND player_slots=4 AND distinct_slots=4
    AND team_a_slots=2 AND team_b_slots=2
    AND historical_club_member_slots=4) AS counted_by_group
  FROM eligible
), tied_slots AS (
  SELECT c.kind,c.counted_by_group,mp.team,ep.player_profile_id,pp.linked_auth_user_id
  FROM countable c
  JOIN public.match_players mp ON mp.match_id=c.match_id
  JOIN public.event_participants ep ON ep.id=mp.participant_id AND ep.event_id=c.event_id
  LEFT JOIN public.player_profiles pp ON pp.id=ep.player_profile_id
  WHERE c.kind='tie_with_saved_winner' AND ep.participant_type='member'
)
SELECT jsonb_build_object(
  'read_only',current_setting('transaction_read_only'),
  'friendly_results_total',(SELECT count(*) FROM public.match_results),
  'flagged_total',(SELECT count(*) FROM countable),
  'score_signature_groups', (
    SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.kind,v.score_a,v.score_b),'[]'::jsonb)
    FROM (SELECT kind,score_a,score_b,winner_team,event_mode,stats_mode,status,deleted,completed,
        player_slots,distinct_slots,team_a_slots,team_b_slots,
        historical_club_member_slots,active_club_member_slots,count(*) AS matches
      FROM countable
      GROUP BY kind,score_a,score_b,winner_team,event_mode,stats_mode,status,deleted,completed,
        player_slots,distinct_slots,team_a_slots,team_b_slots,
        historical_club_member_slots,active_club_member_slots) v),
  'flagged_event_distribution',(
    SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.kind,g.matches_per_event),'[]'::jsonb)
    FROM (SELECT kind,matches_per_event,count(*) AS event_count
      FROM (SELECT kind,event_id,count(*) AS matches_per_event FROM countable GROUP BY kind,event_id) ev
      GROUP BY kind,matches_per_event) g),
  'counted_tie_winner_conflicts',(
    SELECT count(*) FROM countable WHERE kind='tie_with_saved_winner' AND counted_by_group),
  'counted_negative_score_matches',(
    SELECT count(*) FROM countable WHERE kind='negative_score' AND counted_by_group),
  'tied_participant_slots',(
    SELECT count(*) FROM tied_slots WHERE counted_by_group),
  'tied_distinct_player_profiles',(
    SELECT count(DISTINCT player_profile_id) FROM tied_slots WHERE counted_by_group),
  'tied_distinct_linked_accounts',(
    SELECT count(DISTINCT linked_auth_user_id) FROM tied_slots WHERE counted_by_group),
  'saved_B_win_credit_slots',(
    SELECT count(*) FROM tied_slots WHERE counted_by_group AND team='B'),
  'saved_B_win_credit_slots_with_linked_account',(
    SELECT count(*) FROM tied_slots WHERE counted_by_group AND team='B' AND linked_auth_user_id IS NOT NULL),
  'inactive_member_rows',(SELECT count(*) FROM public.club_members WHERE NOT is_active),
  'inactive_members_with_event_participation',(
    SELECT count(DISTINCT cm.id) FROM public.club_members cm
    JOIN public.event_participants ep ON ep.player_profile_id=cm.player_profile_id
    JOIN public.events e ON e.id=ep.event_id AND e.club_id=cm.club_id
    WHERE NOT cm.is_active),
  'inactive_members_with_non_deleted_official_event_participation',(
    SELECT count(DISTINCT cm.id) FROM public.club_members cm
    JOIN public.event_participants ep ON ep.player_profile_id=cm.player_profile_id
    JOIN public.events e ON e.id=ep.event_id AND e.club_id=cm.club_id
      AND e.status='closed' AND e.stats_mode='official' AND NOT coalesce(e.is_deleted,false)
    WHERE NOT cm.is_active)
) AS report;
ROLLBACK;
