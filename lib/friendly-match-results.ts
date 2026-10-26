export type FriendlyMatchResult = {
  score_a: unknown;
  score_b: unknown;
};

type EnteredFriendlyMatchScore = {
  completed: true;
  result: {
    score_a: number;
    score_b: number;
  };
};

const isValidScore = (score: unknown): score is number => typeof score === "number" && Number.isFinite(score);

export const hasEnteredFriendlyMatchScore = <T extends { completed?: boolean | null; result?: FriendlyMatchResult | null }>(match: T): match is T & EnteredFriendlyMatchScore => {
  if (match.completed !== true || !match.result) return false;
  return isValidScore(match.result.score_a) && isValidScore(match.result.score_b);
};

export const isFriendlyMatchDraw = (match: { completed?: boolean | null; result?: FriendlyMatchResult | null }) => {
  return hasEnteredFriendlyMatchScore(match) && match.result.score_a === match.result.score_b;
};

// 試合の成立判定は当時の所属・参加者で行い、現在の退会状態で試合全体を落とさない。
export function getHistoricalGroupMatchTeams(players: { participant_id: string; team: string }[], historicalParticipantIds: ReadonlySet<string>) {
  const teamA = players.filter(player => player.team === "A").map(player => player.participant_id);
  const teamB = players.filter(player => player.team === "B").map(player => player.participant_id);
  if (teamA.length !== 2 || teamB.length !== 2 || players.length !== 4 || !players.every(player => historicalParticipantIds.has(player.participant_id))) return null;
  return { teamA, teamB };
}
