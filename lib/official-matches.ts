import type { SupabaseClient } from "@supabase/supabase-js";

export type OfficialGroup = {
  id: string;
  name: string;
  role: "main_admin" | "sub_admin" | "member";
};

type ClubRow = { id: string; name: string; is_active?: boolean | null; is_deleted?: boolean | null };
type MembershipRow = { club_id: string; role?: OfficialGroup["role"] | null };

const missingColumn = (error: any, column: string) =>
  error?.code === "42703" || `${error?.message ?? ""} ${error?.details ?? ""}`.includes(column);

async function loadActiveClubs(supabase: SupabaseClient, clubIds?: string[]) {
  const fetch = async (select: string) => {
    let query: any = supabase.from("clubs").select(select);
    if (clubIds) query = query.in("id", clubIds);
    return await query;
  };

  let { data, error } = await fetch("id,name,is_active,is_deleted");
  if (error && missingColumn(error, "is_deleted")) ({ data, error } = await fetch("id,name,is_active"));
  if (error && missingColumn(error, "is_active")) ({ data, error } = await fetch("id,name"));
  if (error) return [] as ClubRow[];

  return ((data ?? []) as ClubRow[]).filter((club) => club.is_active !== false && club.is_deleted !== true);
}

async function loadMemberships(supabase: SupabaseClient, column: "player_profile_id" | "profile_id", ids: string[]) {
  if (!ids.length) return [] as MembershipRow[];
  const fetch = async (withStatus: boolean) => {
    let query: any = supabase.from("club_members").select("club_id,role").eq("is_active", true);
    query = ids.length === 1 ? query.eq(column, ids[0]) : query.in(column, ids);
    if (withStatus) query = query.eq("status", "active");
    return await query;
  };

  let { data, error } = await fetch(true);
  if (error && missingColumn(error, "status")) ({ data, error } = await fetch(false));
  return error ? [] : ((data ?? []) as MembershipRow[]);
}

export async function getOfficialAccess(supabase: SupabaseClient) {
  const { data: userResult } = await supabase.auth.getUser();
  const uid = userResult.user?.id;
  if (!uid) return { uid: "", superUser: false, groups: [] as OfficialGroup[] };

  const { data: admin } = await supabase.from("app_admins").select("id").eq("profile_id", uid).eq("is_active", true).maybeSingle();
  if (admin) {
    const clubs = await loadActiveClubs(supabase);
    return { uid, superUser: true, groups: clubs.map((club) => ({ id: club.id, name: club.name, role: "main_admin" as const })) };
  }

  const { data: profiles } = await supabase.from("player_profiles").select("id").eq("linked_auth_user_id", uid);
  const profileIds = (profiles ?? []).map((profile: any) => profile.id).filter(Boolean);
  let memberships = await loadMemberships(supabase, "player_profile_id", profileIds);
  if (!memberships.length) memberships = await loadMemberships(supabase, "profile_id", [uid]);

  const roleByClub = new Map(memberships.map((membership) => [membership.club_id, membership.role ?? "member"]));
  const clubs = await loadActiveClubs(supabase, [...roleByClub.keys()]);
  return { uid, superUser: false, groups: clubs.map((club) => ({ id: club.id, name: club.name, role: roleByClub.get(club.id) ?? "member" })) };
}

export const officialStatusLabel = (status: string) => (status === "closed" ? "終了済み" : "進行中");

export type OfficialResult = "win" | "lose" | "draw" | "undecided";
export type OfficialStatsRow = { name: string; matches: number; wins: number; losses: number; draws: number; winRate: number };
export type OfficialStats = {
  hasMatches: boolean;
  countedMatches: number;
  summary: OfficialStatsRow & { groupName: string; opponentCount: number };
  opponents: OfficialStatsRow[];
  players: OfficialStatsRow[];
  pairs: OfficialStatsRow[];
};

type OfficialStatsMatch = {
  result: OfficialResult;
  official_opponent_id: string;
  our_player1_profile_id: string | null;
  our_player2_profile_id: string | null;
  our_player1_guest_name: string | null;
  our_player2_guest_name: string | null;
};

const emptyStatsRow = (name: string): OfficialStatsRow => ({ name, matches: 0, wins: 0, losses: 0, draws: 0, winRate: 0 });
const applyResult = (row: OfficialStatsRow, result: OfficialResult) => {
  row.matches += 1;
  if (result === "win") row.wins += 1;
  if (result === "lose") row.losses += 1;
  if (result === "draw") row.draws += 1;
  row.winRate = row.matches ? Math.round((row.wins / row.matches) * 1000) / 10 : 0;
};

export function buildOfficialStats(params: {
  eventTitle: string;
  groupName: string;
  opponents: { id: string; opponent_team_name: string }[];
  matches: OfficialStatsMatch[];
  memberName: (profileId: string | null, guestName: string | null) => string;
}): OfficialStats {
  const counted = params.matches.filter((match) => match.result !== "undecided");
  const opponentNames = new Map(params.opponents.map((opponent) => [opponent.id, opponent.opponent_team_name]));
  const summary = { ...emptyStatsRow(params.eventTitle), groupName: params.groupName, opponentCount: params.opponents.length };
  const opponentRows = new Map<string, OfficialStatsRow>();
  const playerRows = new Map<string, OfficialStatsRow>();
  const pairRows = new Map<string, OfficialStatsRow>();

  for (const match of counted) {
    applyResult(summary, match.result);
    const opponentName = opponentNames.get(match.official_opponent_id) ?? "名称未設定";
    if (!opponentRows.has(opponentName)) opponentRows.set(opponentName, emptyStatsRow(opponentName));
    applyResult(opponentRows.get(opponentName)!, match.result);

    const players = [
      { id: match.our_player1_profile_id, guest: match.our_player1_guest_name, name: params.memberName(match.our_player1_profile_id, match.our_player1_guest_name) },
      { id: match.our_player2_profile_id, guest: match.our_player2_guest_name, name: params.memberName(match.our_player2_profile_id, match.our_player2_guest_name) }
    ].filter((player) => player.id || player.guest);

    for (const player of players) {
      const key = player.id ? `profile:${player.id}` : `guest:${player.name}`;
      if (!playerRows.has(key)) playerRows.set(key, emptyStatsRow(player.name));
      applyResult(playerRows.get(key)!, match.result);
    }

    if (players.length === 2) {
      const pairKey = players.map((player) => player.id ? `profile:${player.id}` : `guest:${player.name}`).sort().join("|");
      const pairName = players.map((player) => player.name).join(" / ");
      if (!pairRows.has(pairKey)) pairRows.set(pairKey, emptyStatsRow(pairName));
      applyResult(pairRows.get(pairKey)!, match.result);
    }
  }

  const sortRows = (rows: OfficialStatsRow[]) => rows.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || a.name.localeCompare(b.name, "ja"));
  return { hasMatches: params.matches.length > 0, countedMatches: counted.length, summary, opponents: sortRows([...opponentRows.values()]), players: sortRows([...playerRows.values()]), pairs: sortRows([...pairRows.values()]) };
}

export function createShareToken() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
