export type ParticipantStatus = "active" | "resting" | "absent";

export type Player = {
  id: string;
  name: string;
  skill: number;
  matchCount: number;
  restStreak: number;
  playedLastRound: boolean;
};

export type MatchTeam = [Player, Player];

export type GeneratedMatch = {
  court: number;
  teamA: MatchTeam;
  teamB: MatchTeam;
};

export type RoundGenerationContext = {
  pairHistory?: Record<string, number>;
  opponentHistory?: Record<string, number>;
};
