import type { SupabaseClient } from "@supabase/supabase-js";
import { PlayerProfileError, type PlayerProfile } from "./player-profiles";

export type LinkStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";
export const linkStatusLabel: Record<LinkStatus, string> = { pending: "承認待ち", approved: "承認済み", rejected: "拒否済み", cancelled: "取消済み", expired: "期限切れ" };
export type ProfileMergePreview = {
  source: PlayerProfile;
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
  id: string; club_id: string; source_player_profile_id: string;
  source_display_name: string; club_name: string; status: LinkStatus; created_at: string; expires_at: string;
};
type ProfileLinkDetailBase = {
  id: string; club_id: string; club_name: string; status: LinkStatus; created_at: string; expires_at: string;
};
export type RecipientLinkName = {
  group_display_name_suggestion: string;
  group_display_name_current: string | null;
  group_visibility: "public" | "private";
};
export type ProfileLinkDetail = ProfileLinkDetailBase & (
  | ({ detail_scope: "recipient"; is_recipient: true } & Partial<ProfileMergePreview> & Partial<RecipientLinkName>)
  | { detail_scope: "manager"; is_recipient: false; source_display_name: string | null;
      group_membership: { role: string; is_active: boolean; created_at: string } | null }
);
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
export function hasRecipientLinkName(request: ProfileLinkDetail): request is ProfileLinkDetail & RecipientLinkName & { is_recipient: true; detail_scope: "recipient" } {
  return request.is_recipient === true && request.detail_scope === "recipient" && request.status === "pending"
    && typeof request.group_display_name_suggestion === "string"
    && (request.group_display_name_current === null || typeof request.group_display_name_current === "string")
    && (request.group_visibility === "public" || request.group_visibility === "private");
}
export class NamedProfileLinkError extends PlayerProfileError {
  readonly code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}
export function isValidProfileLinkDisplayName(input: string) {
  const name = input.trim();
  return !!name && Array.from(name).length <= 120 && !/[\u0000-\u001f\u007f-\u009f]/u.test(name);
}
export type NamedProfileLinkApproval = { status: "approved"; merge_id: string; club_display_name: string; public_name_confirmed: boolean };
export async function approveNamedPlayerProfileLink(supabase: SupabaseClient, request: ProfileLinkDetail,
  input: { name: string; inheritanceConsent: boolean; publicConfirmation: boolean }): Promise<NamedProfileLinkApproval> {
  if (!hasRecipientLinkName(request) || !request.target_profile_id || !request.review_token
    || !Number.isFinite(Date.parse(request.expires_at)) || Date.parse(request.expires_at) <= Date.now()
    || !input.inheritanceConsent) throw new NamedProfileLinkError("本人の有効な申請と引継ぎ内容を確認して同意してください", "42501");
  const name = input.name.trim();
  if (!isValidProfileLinkDisplayName(input.name)) {
    throw new NamedProfileLinkError("グループ内表示名は制御文字を含めず120文字以内で入力してください", "22023");
  }
  const publicConfirmation = request.group_visibility === "public" && input.publicConfirmation;
  if (typeof input.publicConfirmation !== "boolean") throw new NamedProfileLinkError("公開設定を選択してください", "22023");
  let result;
  try {
    result = await supabase.rpc("review_player_profile_link_named", {
      p_request_id: request.id, p_review_token: request.review_token, p_club_display_name: name,
      p_expected_club_display_name: request.group_display_name_current,
      p_public_confirmation: publicConfirmation && input.publicConfirmation,
    });
  } catch { throw new NamedProfileLinkError("通信に失敗しました。入力と確認は保持しています。再送する前に再読み込みして申請状況を確認してください"); }
  const { data, error } = result;
  if (error) throw new NamedProfileLinkError(error.code === "PT409"
    ? "仮登録名が更新されています。入力と確認は保持しています。再読み込みして内容を再確認してください"
    : "承認できませんでした。入力と確認は保持しています。再読み込みして申請状況と引継ぎ内容を確認してください", error.code);
  if (!data || data.status !== "approved" || typeof data.merge_id !== "string" || !data.merge_id
    || data.club_display_name !== name || data.public_name_confirmed !== publicConfirmation) {
    throw new NamedProfileLinkError("承認結果を確認できません。入力と確認は保持しています。再送せず再読み込みして申請状況を確認してください");
  }
  return data as NamedProfileLinkApproval;
}
export function effectiveJoinStatus(request: { status: LinkStatus; expires_at?: string | null; created_at: string }): LinkStatus {
  const expires = request.expires_at ? Date.parse(request.expires_at) : Date.parse(request.created_at) + 7 * 86400000;
  return request.status === "pending" && expires <= Date.now() ? "expired" : request.status;
}
