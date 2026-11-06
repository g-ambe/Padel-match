export type FriendlyMatchResult = {
  score_a: unknown;
  score_b: unknown;
};

// UNIQUE(match_id) の有無によりPostgRESTの埋め込みは単一オブジェクト/配列に変わる。
// 保存データや集計式は変えず、移行前後のレスポンスを同じ読み取り規則で扱う。
export type EmbeddedMatchResults<T> = T | T[] | null | undefined;
export function matchResultRows<T>(value: EmbeddedMatchResults<T>): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}
export function firstMatchResult<T>(value: EmbeddedMatchResults<T>): T | null {
  return matchResultRows(value)[0] ?? null;
}

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
