import { hasEnteredFriendlyMatchScore } from "./friendly-match-results";

export type FriendlyRoundMode = "normal" | "balance" | "rival";
export const FRIENDLY_MODE_UNLOCK_MATCHES = 10;
export const FRIENDLY_PAIR_ALLOWANCE = 400;
export const friendlyRoundModes = [
  { value: "normal", label: "通常モード", description: "休憩・ペア・対戦相手の公平性を重視します" },
  { value: "balance", label: "バランスペア", description: "好調な選手と苦戦中の選手を組み合わせ、接戦を狙います" },
  { value: "rival", label: "ライバル対決", description: "好調な選手同士の直接対決を増やします" },
] as const;

export type FriendlyRoundHistory = {
  event_id?: string;
  round_number: number;
  players: { participant_id: string; team: string }[];
  completed?: boolean | null;
  result?: { score_a: unknown; score_b: unknown } | null;
};
export type FriendlyRoundMatch = { teamA: [string, string]; teamB: [string, string]; court: number };
type Teams = { teamA: [string, string]; teamB: [string, string] };
export const friendlyPairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function validFriendlyTeams(match: FriendlyRoundHistory, knownIds: ReadonlySet<string>): Teams | null {
  if (match.players.length !== 4 || new Set(match.players.map(p => p.participant_id)).size !== 4 || !match.players.every(p => knownIds.has(p.participant_id))) return null;
  const a = match.players.filter(p => p.team === "A").map(p => p.participant_id);
  const b = match.players.filter(p => p.team === "B").map(p => p.participant_id);
  return a.length === 2 && b.length === 2 ? { teamA: [a[0], a[1]], teamB: [b[0], b[1]] } : null;
}

export function scoredFriendlyMatches(eventId: string, history: readonly FriendlyRoundHistory[], knownIds: ReadonlySet<string>) {
  return history.filter(match => match.event_id === eventId && validFriendlyTeams(match, knownIds) && hasEnteredFriendlyMatchScore(match) && Number.isSafeInteger(match.result.score_a) && Number.isSafeInteger(match.result.score_b) && match.result.score_a >= 0 && match.result.score_b >= 0);
}

export function friendlyFormScores(eventId: string, history: readonly FriendlyRoundHistory[], knownIds: ReadonlySet<string>) {
  const stats = new Map([...knownIds].map(id => [id, { wins: 0, draws: 0, played: 0, diff: 0 }]));
  for (const match of scoredFriendlyMatches(eventId, history, knownIds)) {
    if (!hasEnteredFriendlyMatchScore(match)) continue;
    for (const player of match.players) {
      const row = stats.get(player.participant_id)!;
      const diff = player.team === "A" ? match.result.score_a - match.result.score_b : match.result.score_b - match.result.score_a;
      row.played++; row.diff += diff;
      if (diff > 0) row.wins++;
      if (diff === 0) row.draws++;
    }
  }
  return new Map([...stats].map(([id, row]) => [id, row.played ? clamp(100 * (row.wins + 0.5 * row.draws + 2) / (row.played + 4) + 2 * clamp(row.diff / row.played, -4, 4)) : 50]));
}

export function friendlyHistory(eventId: string, history: readonly FriendlyRoundHistory[], knownIds: ReadonlySet<string>, lastRound: number) {
  const pairs = new Map<string, number>(), opponents = new Map<string, number>(), lastPairs = new Map<string, number>(), lastOpponents = new Set<string>();
  const roundPlayers = new Map<number, Set<string>>();
  const add = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const match of history) {
    if (match.event_id !== eventId) continue;
    // 休憩カウントは従来どおり各Roundの出場記録で行う。評価用の成立判定とは分ける。
    if (!roundPlayers.has(match.round_number)) roundPlayers.set(match.round_number, new Set());
    for (const player of match.players) roundPlayers.get(match.round_number)!.add(player.participant_id);
    const teams = validFriendlyTeams(match, knownIds);
    if (!teams) continue;
    for (const team of [teams.teamA, teams.teamB]) {
      const key = friendlyPairKey(...team); add(pairs, key);
      if (match.round_number === lastRound) add(lastPairs, key);
    }
    for (const a of teams.teamA) for (const b of teams.teamB) {
      const key = friendlyPairKey(a, b); add(opponents, key);
      if (match.round_number === lastRound) lastOpponents.add(key);
    }
  }
  return { pairs, opponents, lastPairs, lastOpponents, roundPlayers };
}

// 従来の600回探索・重み・乱数の使い方を維持する。モード・好調度には依存しない。
export function chooseFriendlyResters(ids: readonly string[], slots: number, roundPlayers: ReadonlyMap<number, ReadonlySet<string>>, lastRound: number, random: () => number) {
  const restNeeded = ids.length - slots;
  if (restNeeded <= 0) return [] as string[];
  const restCounts = new Map(ids.map(id => [id, 0]));
  for (const [round, players] of roundPlayers) {
    if (round <= 0) continue;
    for (const id of ids) if (!players.has(id)) restCounts.set(id, restCounts.get(id)! + 1);
  }
  const lastPlayers = roundPlayers.get(lastRound) ?? new Set<string>();
  const lastRest = new Set(ids.filter(id => !lastPlayers.has(id)));
  let best: { ids: string[]; score: number } | null = null;
  for (let trial = 0; trial < 600; trial++) {
    const resters = [...ids].sort(() => random() - 0.5).slice(0, restNeeded);
    const restSet = new Set(resters);
    let score = 0;
    for (const id of resters) {
      if (lastRest.has(id)) score += 10000;
      score += (restCounts.get(id) ?? 0) * 300;
    }
    for (const id of lastRest) score += restSet.has(id) ? 5000 : -300;
    score += random() * 50;
    if (!best || score < best.score) best = { ids: resters, score };
  }
  return best!.ids;
}

export function balancePairPenalty(teams: Teams, form: ReadonlyMap<string, number>) {
  const [a1, a2] = teams.teamA.map(id => form.get(id) ?? 50);
  const [b1, b2] = teams.teamB.map(id => form.get(id) ?? 50);
  const teamGap = clamp(Math.abs(a1 + a2 - b1 - b2) / 2);
  const pairGap = clamp((Math.abs(a1 - a2) + Math.abs(b1 - b2)) / 2);
  return clamp(0.7 * teamGap + 0.3 * (100 - pairGap));
}

export function friendlyRivalContext(playingIds: readonly string[], form: ReadonlyMap<string, number>) {
  const ranked = [...playingIds].sort((a, b) => (form.get(b) ?? 50) - (form.get(a) ?? 50) || compareId(a, b));
  const topPair = friendlyPairKey(ranked[0], ranked[1]);
  const hot = ranked.slice(0, Math.max(2, Math.ceil(ranked.length / 2)));
  const auxiliary = new Map<string, number>();
  for (let i = 0; i < hot.length; i++) for (let j = i + 1; j < hot.length; j++) {
    const key = friendlyPairKey(hot[i], hot[j]);
    if (key !== topPair) auxiliary.set(key, (form.get(hot[i]) ?? 50) * (form.get(hot[j]) ?? 50) / 10000);
  }
  return { topPair, auxiliary, totalWeight: [...auxiliary.values()].reduce((a, b) => a + b, 0) };
}

type Pattern = Teams & { pair: number; consecutive: number; opponent: number; balance: number; topRival: number; rivalWeight: number };

export function generateFriendlyRound(params: {
  eventId: string;
  participantIds: readonly string[];
  knownParticipantIds: ReadonlySet<string>;
  courtCount: number;
  lastRound: number;
  history: readonly FriendlyRoundHistory[];
  mode: FriendlyRoundMode;
  random?: () => number;
}) {
  const { eventId, participantIds: ids, knownParticipantIds: known, history, lastRound, mode } = params;
  const random = params.random ?? Math.random;
  if (ids.length < 4) throw new Error("アクティブ参加者が4人未満のためRound生成できません");
  if (new Set(ids).size !== ids.length || !ids.every(id => known.has(id))) throw new Error("参加者情報を確認できません。画面を更新してください");
  if (!Number.isInteger(params.courtCount) || params.courtCount < 1 || params.courtCount > 5) throw new Error("コート数は1〜5面で設定してください");
  if (!friendlyRoundModes.some(item => item.value === mode)) throw new Error("組み合わせモードを確認してください");
  const completed = scoredFriendlyMatches(eventId, history, known).length;
  if (mode !== "normal" && completed < FRIENDLY_MODE_UNLOCK_MATCHES) throw new Error("特別モードはスコア登録済みの10試合達成後に利用できます");
  const courtCount = Math.min(params.courtCount, Math.floor(ids.length / 4));
  const context = friendlyHistory(eventId, history, known, lastRound);
  const resters = chooseFriendlyResters(ids, courtCount * 4, context.roundPlayers, lastRound, random);
  const playing = ids.filter(id => !resters.includes(id));
  const form = friendlyFormScores(eventId, history, known);
  const rival = friendlyRivalContext(playing, form);
  const hasNew = new Map(playing.map(a => [a, playing.some(b => a !== b && !context.pairs.has(friendlyPairKey(a, b)))]));
  const pairPenalty = (a: string, b: string) => {
    const key = friendlyPairKey(a, b), count = context.pairs.get(key) ?? 0;
    return 5000 * (context.lastPairs.get(key) ?? 0) + (count && (hasNew.get(a) || hasNew.get(b)) ? 4000 : 0) + 800 * count;
  };
  const cache = new Map<string, Pattern[]>();
  const patterns = (group: string[]) => {
    const key = JSON.stringify(group);
    if (cache.has(key)) return cache.get(key)!;
    const [a, b, c, d] = group;
    const entries: Teams[] = [{ teamA: [a, b], teamB: [c, d] }, { teamA: [a, c], teamB: [b, d] }, { teamA: [a, d], teamB: [b, c] }];
    const result = entries.map(teams => {
      let opponent = 0, topRival = 0, rivalWeight = 0;
      for (const x of teams.teamA) for (const y of teams.teamB) {
        const edge = friendlyPairKey(x, y);
        opponent += 35 * Math.min(4, context.opponents.get(edge) ?? 0) + (context.lastOpponents.has(edge) ? 60 : 0);
        if (edge === rival.topPair) topRival = 1;
        rivalWeight += rival.auxiliary.get(edge) ?? 0;
      }
      return { ...teams, pair: pairPenalty(...teams.teamA) + pairPenalty(...teams.teamB), consecutive: Number(context.lastPairs.has(friendlyPairKey(...teams.teamA))) + Number(context.lastPairs.has(friendlyPairKey(...teams.teamB))), opponent, balance: balancePairPenalty(teams, form), topRival, rivalWeight };
    });
    cache.set(key, result);
    return result;
  };
  // 700回の出場者シャッフルを維持。重複するコート分割の評価だけを省く。
  const partitions = new Map<string, Pattern[][]>();
  let minConsecutive = Infinity, minPair = Infinity;
  for (let trial = 0; trial < 700; trial++) {
    const shuffled = [...playing].sort(() => random() - 0.5);
    const groups = Array.from({ length: courtCount }, (_, i) => shuffled.slice(i * 4, i * 4 + 4).sort(compareId)).sort((a, b) => compareId(JSON.stringify(a), JSON.stringify(b)));
    const key = JSON.stringify(groups);
    if (partitions.has(key)) continue;
    const choices = groups.map(patterns);
    partitions.set(key, choices);
    const consecutive = choices.reduce((total, options) => total + Math.min(...options.map(p => p.consecutive)), 0);
    const pair = choices.reduce((total, options) => total + Math.min(...options.filter(p => p.consecutive === Math.min(...options.map(q => q.consecutive))).map(p => p.pair)), 0);
    if (consecutive < minConsecutive) { minConsecutive = consecutive; minPair = pair; }
    else if (consecutive === minConsecutive) minPair = Math.min(minPair, pair);
  }
  let winner: { matches: FriendlyRoundMatch[]; pair: number; consecutive: number; opponent: number; modePenalty: number; final: number } | null = null;
  let evaluated = 0;
  for (const choices of partitions.values()) {
    const minimums = choices.map(options => Math.min(...options.map(p => p.consecutive)));
    if (minimums.reduce((a, b) => a + b, 0) !== minConsecutive) continue;
    const allowed = choices.map((options, i) => options.filter(p => p.consecutive === minimums[i]));
    const suffix = Array(courtCount + 1).fill(0) as number[];
    for (let i = courtCount - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + Math.min(...allowed[i].map(p => p.pair));
    const selected: Pattern[] = [];
    const visit = (index: number, pair: number, opponent: number, balance: number, topRival: number, rivalWeight: number) => {
      if (pair + suffix[index] > minPair + FRIENDLY_PAIR_ALLOWANCE) return;
      if (index < courtCount) {
        for (const pattern of allowed[index]) {
          selected.push(pattern);
          visit(index + 1, pair + pattern.pair, opponent + pattern.opponent, balance + pattern.balance, topRival + pattern.topRival, rivalWeight + pattern.rivalWeight);
          selected.pop();
        }
        return;
      }
      evaluated++;
      const modePenalty = mode === "balance" ? balance / courtCount : mode === "rival" ? clamp(70 * (1 - topRival) + (rival.totalWeight ? 30 * (1 - rivalWeight / rival.totalWeight) : 0)) : 0;
      const final = opponent + 0.6 * modePenalty + random() * 5;
      if (!winner || final < winner.final) winner = { matches: selected.map((p, i) => ({ teamA: p.teamA, teamB: p.teamB, court: i + 1 })), pair, consecutive: minConsecutive, opponent, modePenalty, final };
    };
    visit(0, 0, 0, 0, 0, 0);
  }
  // visit内の代入をTypeScriptの制御フロー解析から独立して扱う。
  const result = winner as { matches: FriendlyRoundMatch[]; pair: number; consecutive: number; opponent: number; modePenalty: number; final: number } | null;
  if (!result) throw new Error("組み合わせを生成できませんでした。再試行してください");
  // 重複候補を正規化したID順が、そのままコート番号の偏りにならないようにする。
  const courts = Array.from({ length: courtCount }, (_, i) => i + 1).sort(() => random() - 0.5);
  return { ...result, matches: result.matches.map((match, i) => ({ ...match, court: courts[i] })), resters, form, diagnostics: { minConsecutive, minPair, evaluated, partitions: partitions.size, completed } };
}
