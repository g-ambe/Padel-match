import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCountedFriendlyEvents, readStatsRows, readStatsRowsByIds } from "./stats-history";
import { getHistoricalGroupMatchTeams, hasEnteredFriendlyMatchScore } from "./friendly-match-results";
import type { FriendlyFormStat } from "./friendly-rounds";

type Participant = { id: string; player_profile_id: string | null; participant_type?: string | null };
type PastParticipant = Participant & { event_id: string };
type PastMatch = { id: string; event_id: string; completed: boolean; match_players: { participant_id: string; team: string }[]; match_results: { score_a: number; score_b: number }[] };
type CurrentEvent = { id: string; club_id: string | null; created_at: string };

// 新しい権限やサーバーの代理取得は使わず、本人の既存セッションで同じグループだけ読む。
export async function fetchBalancePastStats(s: SupabaseClient, current: CurrentEvent, participants: readonly Participant[]): Promise<Map<string, FriendlyFormStat>> {
  const targetIds = new Set(participants.filter(p => p.participant_type !== "guest" && p.player_profile_id).map(p => p.player_profile_id!));
  if (!current.club_id || !targetIds.size) return new Map();
  try {
    if (!Number.isFinite(Date.parse(current.created_at))) throw new Error("イベントの作成日時が不明です");
    const { data: auth, error: authError } = await s.auth.getUser();
    if (authError || !auth.user) throw new Error("ログインを確認できません");
    const uid = auth.user.id;
    const { data: admin, error: adminError } = await s.from("app_admins").select("id").eq("profile_id", uid).eq("is_active", true).maybeSingle();
    if (adminError) throw adminError;
    if (!admin) {
      const linked = await readStatsRows<{ id: string }>((start, end) => s.from("player_profiles").select("id").eq("linked_auth_user_id", uid).eq("is_active", true).order("id").range(start, end));
      const filters = [`profile_id.eq.${uid}`, ...(linked.length ? [`player_profile_id.in.(${linked.map(p => p.id).join(",")})`] : [])];
      const membership = await readStatsRows<{ id: string }>((start, end) => s.from("club_members").select("id").eq("club_id", current.club_id!).eq("is_active", true).or(filters.join(",")).order("id").range(start, end));
      if (!membership.length) throw new Error("グループの所属を確認できません");
    }
    const events = await fetchCountedFriendlyEvents(s, { clubId: current.club_id }, { before: current.created_at, excludeId: current.id, ordinaryOnly: true });
    if (!events.length) return new Map();
    const eventIds = events.map(e => e.id);
    // 戦績画面と同じく退会済みを含む所属履歴で、当時のメンバー4人の試合を判定する。
    const members = await readStatsRows<{ player_profile_id: string | null }>((start, end) => s.from("club_members").select("player_profile_id").eq("club_id", current.club_id!).order("id").range(start, end));
    const pastParticipants = await readStatsRowsByIds<PastParticipant>(eventIds, (ids, start, end) => s.from("event_participants").select("id,event_id,player_profile_id,participant_type").in("event_id", ids).order("id").range(start, end));
    const matches = await readStatsRowsByIds<PastMatch>(eventIds, (ids, start, end) => s.from("matches").select("id,event_id,completed,match_players(participant_id,team),match_results(score_a,score_b)").in("event_id", ids).lt("created_at", current.created_at).order("id").range(start, end));
    return collectBalancePastStats(participants, members, pastParticipants, matches);
  } catch {
    throw new Error("バランスペア用の過去戦績を取得できませんでした。権限・通信を確認し、再試行してください");
  }
}

// 集計は既存の正式戦績判定を使い、永続的な選手IDでだけ対応付ける。
export function collectBalancePastStats(participants: readonly Participant[], members: readonly { player_profile_id: string | null }[], pastParticipants: readonly PastParticipant[], matches: readonly PastMatch[]): Map<string, FriendlyFormStat> {
  const targetIds = new Set(participants.filter(p => p.participant_type !== "guest" && p.player_profile_id).map(p => p.player_profile_id!));
  const memberIds = new Set(members.map(m => m.player_profile_id).filter(Boolean));
  const participantMap = new Map(pastParticipants.map(p => [p.id, p]));
  const historicalIds = new Set(pastParticipants.filter(p => p.participant_type !== "guest" && p.player_profile_id && memberIds.has(p.player_profile_id)).map(p => p.id));

  const stats = new Map<string, FriendlyFormStat>();
  for (const match of matches) {
    const teams = getHistoricalGroupMatchTeams(match.match_players ?? [], historicalIds);
    if (!teams || new Set(match.match_players.map(p => p.participant_id)).size !== 4 || !match.match_players.every(p => participantMap.get(p.participant_id)?.event_id === match.event_id)) continue;
    const profiles = match.match_players.map(p => participantMap.get(p.participant_id)!.player_profile_id);
    if (new Set(profiles).size !== 4) continue;
    if (!profiles.some(id => id && targetIds.has(id))) continue;
    const result = match.match_results?.[0];
    // 既存の戦績画面と同じく1試合を1回だけ数える。同じ得点の重複行で二重計上しない。
    // 異なる得点から先頭や最新を勝手に選ばない。未成立・対象外の試合は評価しない。
    if (match.completed && result && match.match_results.some(r => r.score_a !== result.score_a || r.score_b !== result.score_b)) throw new Error("過去の同じ試合に異なる得点が保存されています");
    if (!hasEnteredFriendlyMatchScore({ completed: match.completed, result }) || !Number.isSafeInteger(result.score_a) || !Number.isSafeInteger(result.score_b) || result.score_a < 0 || result.score_b < 0) continue;
    for (const player of match.match_players) {
      const profileId = participantMap.get(player.participant_id)!.player_profile_id!;
      if (!targetIds.has(profileId)) continue;
      const row = stats.get(profileId) ?? { wins: 0, draws: 0, played: 0, diff: 0 };
      const diff = player.team === "A" ? result.score_a - result.score_b : result.score_b - result.score_a;
      row.played++; row.diff += diff; if (diff > 0) row.wins++; if (diff === 0) row.draws++;
      stats.set(profileId, row);
    }
  }
  return new Map(participants.flatMap(p => {
    const row = p.participant_type !== "guest" && p.player_profile_id ? stats.get(p.player_profile_id) : undefined;
    return row ? [[p.id, row] as const] : [];
  }));
}
