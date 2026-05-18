import { GeneratedMatch, Player, RoundGenerationContext } from "./types";

type CandidateMatch = {
  teamA: [Player, Player];
  teamB: [Player, Player];
  score: number;
};

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function getPairPenalty(pair: [Player, Player], pairHistory: Record<string, number>): number {
  return (pairHistory[pairKey(pair[0].id, pair[1].id)] ?? 0) * 7;
}

function getOpponentPenalty(teamA: [Player, Player], teamB: [Player, Player], opponentHistory: Record<string, number>): number {
  let penalty = 0;
  for (const a of teamA) {
    for (const b of teamB) {
      penalty += (opponentHistory[pairKey(a.id, b.id)] ?? 0) * 3;
    }
  }
  return penalty;
}

function skillGapPenalty(teamA: [Player, Player], teamB: [Player, Player]): number {
  const aSkill = teamA[0].skill + teamA[1].skill;
  const bSkill = teamB[0].skill + teamB[1].skill;
  return Math.abs(aSkill - bSkill);
}

function buildCandidates(group: Player[], context: RoundGenerationContext): CandidateMatch[] {
  const [p1, p2, p3, p4] = group;
  const pairHistory = context.pairHistory ?? {};
  const opponentHistory = context.opponentHistory ?? {};

  const patterns: Array<[[Player, Player], [Player, Player]]> = [
    [[p1, p2], [p3, p4]],
    [[p1, p3], [p2, p4]],
    [[p1, p4], [p2, p3]]
  ];

  return patterns.map(([teamA, teamB]) => {
    const score =
      getPairPenalty(teamA, pairHistory) +
      getPairPenalty(teamB, pairHistory) +
      getOpponentPenalty(teamA, teamB, opponentHistory) +
      skillGapPenalty(teamA, teamB) +
      Math.random() * 0.2;

    return { teamA, teamB, score };
  });
}

function choosePlayingPlayers(players: Player[], courtCount: number): { selected: Player[]; resting: Player[] } {
  const slots = courtCount * 4;
  const ranked = [...players].sort((a, b) => {
    if (a.matchCount !== b.matchCount) return a.matchCount - b.matchCount; // equal participation first
    if (a.playedLastRound !== b.playedLastRound) return a.playedLastRound ? 1 : -1; // avoid consecutive play
    if (a.restStreak !== b.restStreak) return b.restStreak - a.restStreak; // prioritize players who rested
    return Math.random() - 0.5;
  });

  const selected = ranked.slice(0, Math.min(slots, ranked.length));
  const selectedIds = new Set(selected.map((p) => p.id));
  const resting = ranked.filter((p) => !selectedIds.has(p.id));

  return { selected, resting };
}

export function generateRound(
  players: Player[],
  courtCount: number,
  context: RoundGenerationContext = {}
): { matches: GeneratedMatch[]; resting: Player[] } {
  const { selected, resting } = choosePlayingPlayers(shuffle(players), courtCount);
  const sortedBySkill = [...selected].sort((a, b) => b.skill - a.skill);
  const matches: GeneratedMatch[] = [];

  for (let i = 0; i < Math.floor(sortedBySkill.length / 4); i++) {
    const group = sortedBySkill.slice(i * 4, i * 4 + 4);
    if (group.length < 4) break;

    const best = buildCandidates(group, context).sort((a, b) => a.score - b.score)[0];
    matches.push({
      court: i + 1,
      teamA: best.teamA,
      teamB: best.teamB
    });
  }

  return { matches, resting };
}
