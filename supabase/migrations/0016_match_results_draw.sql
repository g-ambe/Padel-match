-- Allow friendly match score results to be recorded as draws.
alter table match_results
  drop constraint if exists match_results_winner_team_check;

alter table match_results
  add constraint match_results_winner_team_check
  check (winner_team in ('A','B','draw'));
