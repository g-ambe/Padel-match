import type { SupabaseClient } from "@supabase/supabase-js";
import { readFriendlyRoundRows } from "./friendly-round-history";

// 集計途中の取得失敗を「戦績0件」として表示しない。
export async function readStatsRows<T>(query: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const result = await readFriendlyRoundRows(query);
  if (result.error) throw result.error;
  return result.data;
}

// URL長とSupabaseの取得上限の両方に対応する。IDの重複で同じ履歴を二重取得しない。
export async function readStatsRowsByIds<T>(ids: string[], query: (ids: string[], start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const uniqueIds = [...new Set(ids)];
  const rows: T[] = [];
  for (let index = 0; index < uniqueIds.length; index += 100) {
    rows.push(...await readStatsRows((start, end) => query(uniqueIds.slice(index, index + 100), start, end)));
  }
  return rows;
}

type StatsEvent = { id: string; name: string; created_at: string; status: string };
type StatsMember = { player_profile_id: string | null; is_active: boolean };
type StatsParticipant = { id: string; event_id: string; player_profile_id: string | null; participant_type: string };
type StatsPlayer = { id: string; display_name: string };
type StatsMatch = { id: string; event_id: string; completed: boolean; match_players: { participant_id: string; team: string }[]; match_results: { score_a: number; score_b: number; winner_team: string }[] };

// 個人・グループ共通の正式戦績対象。参加者の所属判定や計算式は各画面に残す。
// チーム戦の試合は別テーブルのため、ここで通常戦績へ読み込まない。
export async function fetchCountedFriendlyEvents(s: SupabaseClient, scope: { clubId: string } | { eventIds: string[] }, limits?: { before: string; excludeId: string; ordinaryOnly: true }): Promise<StatsEvent[]> {
  const query = (start: number, end: number, ids?: string[]) => {
    let events = s.from("events").select("id,name,created_at,status")
      .eq("status", "closed").eq("is_deleted", false).eq("stats_mode", "official");
    if ("clubId" in scope) events = events.eq("club_id", scope.clubId);
    if (ids) events = events.in("id", ids);
    // バランスペアの過去評価だけに適用。従来の戦績画面の対象条件は変えない。
    if (limits) events = events.lt("created_at", limits.before).neq("id", limits.excludeId).in("event_mode", ["auto", "manual"]);
    return events.order("created_at", { ascending: false }).order("id").range(start, end);
  };
  return "clubId" in scope
    ? readStatsRows((start, end) => query(start, end))
    : readStatsRowsByIds(scope.eventIds, (ids, start, end) => query(start, end, ids));
}

export async function fetchGroupStatsHistory(s: SupabaseClient, clubId: string) {
  const events = await fetchCountedFriendlyEvents(s, { clubId });
  const eventIds = events.map(event => event.id);
  if (!eventIds.length) return { events, membersRaw: [] as StatsMember[], participants: [] as StatsParticipant[], pps: [] as StatsPlayer[], matches: [] as StatsMatch[] };
  // 退会済みも含む所属履歴を使う。現在の在籍条件による表示は既存の集計側で行う。
  const membersRaw = await readStatsRows<StatsMember>((start, end) => s.from("club_members")
    .select("player_profile_id,is_active").eq("club_id", clubId).order("id").range(start, end));
  const participants = await readStatsRowsByIds<StatsParticipant>(eventIds, (ids, start, end) => s.from("event_participants")
    .select("id,event_id,player_profile_id,participant_type").in("event_id", ids).order("id").range(start, end));
  const profileIds = participants.map(participant => participant.player_profile_id).filter((id): id is string => !!id);
  const pps = await readStatsRowsByIds<StatsPlayer>(profileIds, (ids, start, end) => s.from("player_profiles")
    .select("id,display_name").in("id", ids).order("id").range(start, end));
  const matches = await readStatsRowsByIds<StatsMatch>(eventIds, (ids, start, end) => s.from("matches")
    .select("id,event_id,completed,match_players(participant_id,team),match_results(score_a,score_b,winner_team)")
    .in("event_id", ids).order("id").range(start, end));
  return { events, membersRaw, participants, pps, matches };
}
