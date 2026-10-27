import type { SupabaseClient } from "@supabase/supabase-js";
import { PlayerProfileError, type PlayerProfile } from "./player-profiles";

export type LinkStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";
export const linkStatusLabel: Record<LinkStatus, string> = { pending: "承認待ち", approved: "承認済み", rejected: "拒否済み", cancelled: "取消済み", expired: "期限切れ" };
export type ProfileMergePreview = {
  source: Pick<PlayerProfile, "id" | "display_name">;
  target_profile_id: string | null;
  target_display_name: string | null;
  memberships: { id: string; club_name: string; role: string; status: string; is_active: boolean; created_at: string }[];
  participant_count: number;
  match_count: number;
  result_count: number;
  team_match_count: number;
  official_match_count: number;
  review_token: string;
};
export type ProfileLinkRequest = {
  id: string; club_id: string; source_player_profile_id: string; target_auth_user_id: string;
  source_display_name: string; club_name: string; status: LinkStatus; created_at: string; expires_at: string;
};
export type ProfileLinkDetail = Omit<ProfileLinkRequest, "source_display_name"> & Partial<ProfileMergePreview> & { is_recipient: boolean };
export type AccountCandidate = { auth_user_id: string; display_name: string; identifier: string };

export async function profileLinkRpc<T>(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    const message = error.code === "P0001" ? error.message : "連携処理に失敗しました。DBの適用状態と申請状況を確認してください";
    throw new PlayerProfileError(message, { cause: error });
  }
  if (data === null) throw new PlayerProfileError("連携処理の結果を確認できません。申請状況を再読み込みしてください");
  return data as T;
}

export async function requestPlayerProfileLink(supabase: SupabaseClient, clubId: string, memberId: string, targetUserId: string) {
  return profileLinkRpc<string>(supabase, "request_player_profile_link", { p_club_id: clubId, p_member_id: memberId, p_target_auth_user_id: targetUserId });
}
export async function reviewPlayerProfileLink(supabase: SupabaseClient, requestId: string, decision: "approved" | "rejected" | "cancelled", reviewToken?: string) {
  return profileLinkRpc<{ status: LinkStatus; merge_id?: string }>(supabase, "review_player_profile_link", { p_request_id: requestId, p_decision: decision, p_review_token: reviewToken ?? null });
}
export function effectiveJoinStatus(request: { status: LinkStatus; expires_at?: string | null; created_at: string }): LinkStatus {
  const expires = request.expires_at ? Date.parse(request.expires_at) : Date.parse(request.created_at) + 7 * 86400000;
  return request.status === "pending" && expires <= Date.now() ? "expired" : request.status;
}
