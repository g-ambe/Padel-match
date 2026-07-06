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
