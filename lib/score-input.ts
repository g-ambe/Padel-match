export type ScorePair = { a: string; b: string };
export type ScoreInputKind = "number" | "non-negative-integer";

// 各画面の既存の入力条件を維持する。選択ボタンの範囲は得点の上限ではない。
export function scoreInputError(scores: ScorePair, kind: ScoreInputKind) {
  for (const value of [scores.a, scores.b]) {
    if (!value.trim()) continue;
    const score = Number(value);
    if (!Number.isFinite(score)) return "得点を数値で入力してください";
    if (kind === "non-negative-integer" && (!Number.isInteger(score) || score < 0)) return "得点は0以上の整数で入力してください";
  }
  return "";
}
