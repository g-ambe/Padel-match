import { countableTeamCard, teamCardScores, teamCardPlayers, type TeamCard, type TeamSource } from "./friendly-team-rounds";
export type TeamStatsRow = { name: string; matches: number; wins: number; losses: number; draws: number; points: number; scored: number; conceded: number; diff: number; winRate: number };
const empty = (name: string): TeamStatsRow => ({ name, matches: 0, wins: 0, losses: 0, draws: 0, points: 0, scored: 0, conceded: 0, diff: 0, winRate: 0 });
const apply = (row: TeamStatsRow, scored: number, conceded: number) => { row.matches++; row.scored += scored; row.conceded += conceded; if (scored > conceded) { row.wins++; row.points += 3; } else if (scored < conceded) row.losses++; else { row.draws++; row.points++; } row.diff = row.scored - row.conceded; row.winRate = row.matches ? Math.round((row.wins / row.matches) * 1000) / 10 : 0; };
const sorted = (rows: TeamStatsRow[]) => [...rows].sort((a, b) => b.points - a.points || b.wins - a.wins || b.winRate - a.winRate || b.diff - a.diff || b.scored - a.scored || b.draws - a.draws || a.matches - b.matches || a.name.localeCompare(b.name, "ja"));
export function friendlyTeamStats(matches: readonly TeamCard[], teamNames: [string,string], name: (source: TeamSource, profile: string|null, guest: string|null) => string, guestKey?: (source: TeamSource, name: string) => string | undefined) {
  const teams = teamNames.map(empty), players = new Map<string,TeamStatsRow>(), pairs = new Map<string,TeamStatsRow>(); let allCountedMatches = 0;
  const row = (map: Map<string,TeamStatsRow>, key: string, label: string) => { if (!map.has(key)) map.set(key, empty(label)); return map.get(key)!; };
  for (const match of matches) {
    if (!countableTeamCard(match)) continue;
    allCountedMatches++;
    const a = teamCardScores(match).a!, b = teamCardScores(match).b!;
    if (match.generation_mode !== "mixed") { apply(teams[0],a,b); apply(teams[1],b,a); }
    const people = teamCardPlayers(match).map(p => ({ ...p, key: !p.profile_id && !p.guest_id && p.name ? guestKey?.(p.source,p.name) ?? p.key : p.key, label: name(p.source,p.profile_id,p.name||null) }));
    for (const pair of [0,1]) {
      const scored = pair === 0 ? a : b, conceded = pair === 0 ? b : a;
      const valid = people.filter(p => p.pair === pair && p.key).sort((a,b) => a.key.localeCompare(b.key));
      for (const p of valid) apply(row(players,p.key,p.label),scored,conceded);
      if (valid.length === 2) apply(row(pairs,valid.map(p=>p.key).join("|"),valid.map(p=>p.label).join(" / ")),scored,conceded);
    }
  }
  return { countedMatches: teams[0].matches, allCountedMatches, teams, players: sorted([...players.values()]), pairs: sorted([...pairs.values()]) };
}
