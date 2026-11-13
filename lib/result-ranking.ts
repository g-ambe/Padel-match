export type RankingMetric = "wins" | "winRate" | "diff";
export type ResultRankingRow = { name: string; wins: number; losses: number; draws: number; winRate: number; diff: number; scored: number; conceded: number; played?: number; matches?: number; matchPoints?: number; points?: number };
export type RankingGroup = { rank: number; value: number; rows: ResultRankingRow[] };

// 集計・同値内の並び順は呼び出し元の既存ランキングを維持。順位表示だけを同率でまとめる。
export function groupResultRanking(rows: readonly ResultRankingRow[], metric: RankingMetric): RankingGroup[] {
  const groups: RankingGroup[] = [];
  rows.forEach((row, index) => {
    const last = groups.at(-1);
    if (last && last.value === row[metric]) last.rows.push(row);
    else groups.push({ rank: index + 1, value: row[metric], rows: [row] });
  });
  return groups;
}
export function compactRankingGroups(groups: readonly RankingGroup[]) {
  return groups.filter((group, index) => index < 2 || index === groups.length - 1);
}
export const rankingValue = (metric: RankingMetric, value: number) => metric === "wins" ? `${value}勝` : metric === "winRate" ? `${value}%` : `${value > 0 ? "+" : ""}${value}`;
