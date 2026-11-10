import { friendlyPairKey, friendlyFormScore, type FriendlyFormStat } from "./friendly-rounds";

export function friendlyTeamRoundError(error: {message?:string;code?:string}|null|undefined, fallback="編成を保存できませんでした。入力を保持しています。再試行してください") {
  if(error?.code==="PGRST202")return "自動編成の準備が完了していません";
  return error?.message&&/[\u3040-\u30ff\u3400-\u9fff]/.test(error.message)?error.message:fallback;
}
export type TeamSource = "team_a" | "team_b";
export type TeamRoundMode = "confrontation" | "mixed";
export type TeamRoundPlayer = { key: string; source: TeamSource; profile_id: string | null; guest_id: string | null; member_id: string | null; name: string };
export type TeamSlot = `team_${"a" | "b"}_player${1 | 2}`;
export const teamSlots: TeamSlot[] = ["team_a_player1", "team_a_player2", "team_b_player1", "team_b_player2"];
export type TeamCard = { id: string; match_order: number; team_a_score: number | null; team_b_score: number | null; result: "win" | "lose" | "draw" | "undecided"; round_id?: string | null; round_number?: number | null; court_number?: number | null; generation_mode?: TeamRoundMode | null; updated_at?: string | null; pair_1_score?:number|null;pair_2_score?:number|null;pair_result?:"win"|"lose"|"draw"|"undecided"|null }
  & Record<`${TeamSlot}_profile_id` | `${TeamSlot}_guest_name`, string | null>
  & Partial<Record<`${TeamSlot}_guest_id`, string | null> & Record<`${TeamSlot}_source_side`, TeamSource | null>>;
export type TeamRoundRecord = { id: string; round_number: number; mode: TeamRoundMode; court_count: number; eligible: TeamRoundPlayer[] };
export type TeamRoundContext = { revision: string; court_count: number; roster: TeamRoundPlayer[]; rounds: TeamRoundRecord[]; matches: TeamCard[] };
export type TeamRoundDraft = { mode: TeamRoundMode; courts: { court: number; pairs: [TeamRoundPlayer[], TeamRoundPlayer[]] }[]; resting: TeamRoundPlayer[] };
export function teamCardPlayers(card: TeamCard, known: readonly TeamRoundPlayer[] = []) {
  return teamSlots.map((slot, index) => {
    const source = card[`${slot}_source_side`] ?? (index < 2 ? "team_a" : "team_b");
    const profile_id = card[`${slot}_profile_id`], guest_id = card[`${slot}_guest_id`] ?? null, name = card[`${slot}_guest_name`] ?? "";
    return { pair: index < 2 ? 0 : 1, source, profile_id, guest_id, name, key: profile_id ? `profile:${profile_id}` : guest_id ? `guest:${guest_id}` : name ? (known.find(p=>p.source===source&&p.guest_id&&p.name===name)?.key ?? `legacy:${source}:${name}`) : "" };
  });
}
export function teamCardScores(card: Pick<TeamCard,"team_a_score"|"team_b_score"> & Partial<TeamCard>) {
  return card.generation_mode === "mixed" ? {a:card.pair_1_score??null,b:card.pair_2_score??null,result:card.pair_result??"undecided"} : {a:card.team_a_score,b:card.team_b_score,result:card.result??"undecided"};
}
export const pendingTeamCard = (card:TeamCard) => {const s=teamCardScores(card);return s.result==="undecided"||s.a===null||s.b===null;};
export const countableTeamCard = (card:TeamCard) => {const s=teamCardScores(card);return typeof s.a==="number"&&typeof s.b==="number"&&!(s.a===0&&s.b===0);};
const shuffle = <T,>(items: readonly T[], random: () => number) => {
  const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result;
};
const compare = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
export function teamRoundCapacity(roster: readonly TeamRoundPlayer[], courts: number) {
  const a = roster.filter(p => p.source === "team_a").length, b = roster.filter(p => p.source === "team_b").length;
  return Math.min(courts, Math.floor(a / 2), Math.floor(b / 2), Math.floor(new Set(roster.map(p => p.key)).size / 4));
}
export function generateTeamRound(context: TeamRoundContext, mode: TeamRoundMode, courtCount: number, random: () => number = Math.random): TeamRoundDraft {
  if (!["confrontation", "mixed"].includes(mode) || !Number.isInteger(courtCount) || courtCount < 1 || courtCount > 5) throw new Error("編成モード・コート数を確認してください");
  if (context.matches.some(pendingTeamCard)) throw new Error("未完了の試合カードのスコアを保存してください");
  const roster = context.roster;
  if (roster.some(p => !p.key || !["team_a", "team_b"].includes(p.source) || (!!p.profile_id === !!p.guest_id)) || new Set(roster.map(p => `${p.source}:${p.key}`)).size !== roster.length) throw new Error("参加候補の識別情報が不整合です");
  const courtTotal = teamRoundCapacity(roster, courtCount);
  if (!courtTotal) throw new Error("両チームに参加可能な選手が各2名以上、重複しない選手が合計4名以上必要です");
  const played = new Map<string, number>(), rests = new Map<string, number>(), streaks = new Map<string, number>();
  const pairs = new Map<string, number>(), opponents = new Map<string, number>();
  const form = new Map<string, FriendlyFormStat>();
  let lastPairs = new Set<string>(), lastOpponents = new Set<string>();
  const groups = new Map<string, TeamCard[]>();
  for (const card of context.matches) { const key = card.round_id ?? `manual:${card.id}`; groups.set(key, [...groups.get(key) ?? [], card]); }
  const groupList = [...groups.values()].sort((a, b) => Math.min(...a.map(c => c.match_order)) - Math.min(...b.map(c => c.match_order)));
  for (const group of groupList) {
    lastPairs = new Set(); lastOpponents = new Set();
    const present = new Set<string>();
    for (const card of group) {
      const players = teamCardPlayers(card, roster);
      if (countableTeamCard(card)) for (const p of players) if (p.key) { const stat = form.get(p.key) ?? {wins:0,draws:0,played:0,diff:0}; const delta = p.pair === 0 ? teamCardScores(card).a! - teamCardScores(card).b! : teamCardScores(card).b! - teamCardScores(card).a!; stat.played++; stat.diff += delta; stat.wins += Number(delta>0); stat.draws += Number(delta===0); form.set(p.key,stat); }
      for (const p of players) if (p.key) { const key = `${p.source}:${p.key}`; played.set(key, (played.get(key) ?? 0) + 1); present.add(p.key); }
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        if (!players[i].key || !players[j].key || players[i].key === players[j].key) continue;
        const key = friendlyPairKey(players[i].key, players[j].key), same = players[i].pair === players[j].pair;
        const counts = same ? pairs : opponents; counts.set(key, (counts.get(key) ?? 0) + 1); (same ? lastPairs : lastOpponents).add(key);
      }
    }
    const round = context.rounds.find(r => r.id === group[0].round_id);
    // 手動カード・削除済みコート・過去の不明な参加資格から休憩を推測しない。
    if (!round || group.length !== round.court_count || present.size !== group.length * 4) { streaks.clear(); continue; }
    const eligible = new Set(round.eligible.map(p => `${p.source}:${p.key}`));
    for (const p of roster) {
      const key = `${p.source}:${p.key}`;
      if (!eligible.has(key)) { streaks.delete(key); continue; }
      if (present.has(p.key)) streaks.set(key, 0);
      else { rests.set(key, (rests.get(key) ?? 0) + 1); streaks.set(key, (streaks.get(key) ?? 0) + 1); }
    }
  }
  // 2チームの定員を同時に満たす動的計画法。両所属の選手は1回だけ割り当てる。
  type Plan = { cost: number[]; players: TeamRoundPlayer[] };
  let plans = new Map<string, Plan>([["0,0", { cost: [0, 0, 0, 0], players: [] }]]);
  const identities = new Map<string, TeamRoundPlayer[]>();
  for (const p of roster) identities.set(p.key, [...identities.get(p.key) ?? [], p]);
  const quota = courtTotal * 2;
  for (const options of shuffle([...identities.values()], random)) {
    const next = new Map(plans);
    for (const [position, plan] of plans) for (const p of options) {
      const [a, b] = position.split(",").map(Number), na = a + Number(p.source === "team_a"), nb = b + Number(p.source === "team_b");
      if (na > quota || nb > quota) continue;
      const key = `${p.source}:${p.key}`, delta = [played.get(key) ?? 0, -(streaks.get(key) ?? 0), -(rests.get(key) ?? 0), random()];
      const candidate = { cost: plan.cost.map((n, i) => n + delta[i]), players: [...plan.players, p] }, target = `${na},${nb}`;
      if (!next.has(target) || compare(candidate.cost, next.get(target)!.cost) < 0) next.set(target, candidate);
    }
    plans = next;
  }
  const selected = plans.get(`${quota},${quota}`)?.players;
  if (!selected) throw new Error("同一選手の重複を避けた編成を作成できません。所属を確認してください");
  let best: TeamRoundDraft["courts"] = [], bestCost: number[] | null = null;
  for (let attempt = 0; attempt < 256; attempt++) {
    const a = shuffle(selected.filter(p => p.source === "team_a"), random), b = shuffle(selected.filter(p => p.source === "team_b"), random);
    const courts: TeamRoundDraft["courts"] = [];
    const cost = [0, 0, 0, 0, 0];
    for (let i = 0; i < quota; i += 2) {
      let sides: [TeamRoundPlayer[], TeamRoundPlayer[]] = mode === "confrontation" ? [[a[i], a[i + 1]], [b[i], b[i + 1]]] : [[a[i], b[i]], [a[i + 1], b[i + 1]]];
      if (mode === "mixed" && random() < .5) sides = [sides[1], sides[0]];
      for (const pair of sides) { const key = friendlyPairKey(pair[0].key, pair[1].key); cost[0] += Number(lastPairs.has(key)); cost[1] += pairs.get(key) ?? 0; }
      for (const x of sides[0]) for (const y of sides[1]) { const key = friendlyPairKey(x.key, y.key); cost[2] += Number(lastOpponents.has(key)); cost[3] += opponents.get(key) ?? 0; }
      if (sides.flat().every(p=>form.has(p.key))) cost[4] += Math.abs(sides[0].reduce((n,p)=>n+friendlyFormScore(form.get(p.key)!),0)-sides[1].reduce((n,p)=>n+friendlyFormScore(form.get(p.key)!),0));
      courts.push({ court: courts.length + 1, pairs: sides });
    }
    if (!bestCost || compare(cost, bestCost) < 0) { bestCost = cost; best = courts; }
  }
  const chosen = new Set(selected.map(p => p.key));
  return { mode, courts: best, resting: roster.filter(p => !chosen.has(p.key)) };
}
