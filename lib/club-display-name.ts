import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageTargetMember } from "./permissions";

export type ClubNameMember = {
  id: string; club_id: string; player_profile_id: string | null;
  linked_auth_user_id: string | null; role: "main_admin" | "sub_admin" | "member";
  is_active: boolean; status: string; player_active: boolean;
  profile_display_name: string; club_display_name: string | null; public_name_confirmed: boolean;
};
export type ClubNameContext = {
  clubId: string; userId: string | null; visibility: "public" | "private";
  isSuperUser: boolean; myRole: "main_admin" | "sub_admin" | "member";
};
export type ClubNameResult = { member_id: string; club_display_name: string; public_name_confirmed: boolean };
export class ClubDisplayNameError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}

export function canEditClubDisplayName(member: ClubNameMember, context: ClubNameContext) {
  if (!context.userId || member.club_id !== context.clubId || !member.is_active
    || member.status !== "active" || !member.player_active || !member.player_profile_id) return false;
  return member.linked_auth_user_id !== null
    ? member.linked_auth_user_id === context.userId
    : canManageTargetMember(context, member.role);
}
export function groupMemberLabel(member: Pick<ClubNameMember, "linked_auth_user_id" | "club_display_name" | "profile_display_name">) {
  return member.linked_auth_user_id !== null
    ? `${member.club_display_name ?? "グループ内表示名 未設定"}（${member.profile_display_name}）`
    : member.club_display_name ?? member.profile_display_name;
}
export const requiresPublicNameConfirmation = (member: ClubNameMember, context: ClubNameContext) =>
  member.linked_auth_user_id !== null && context.visibility === "public";

export async function saveClubDisplayName(db: SupabaseClient, member: ClubNameMember, context: ClubNameContext, input: string, confirmation: boolean): Promise<ClubNameResult> {
  if (!canEditClubDisplayName(member, context)) throw new ClubDisplayNameError("このグループ内表示名を変更する権限がありません", "42501");
  const name = input.trim();
  if (!name || Array.from(name).length > 120 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
    throw new ClubDisplayNameError("グループ内表示名は制御文字を含めず120文字以内で入力してください", "22023");
  }
  const publicConfirmation = requiresPublicNameConfirmation(member, context);
  if (publicConfirmation && !confirmation) throw new ClubDisplayNameError("公開グループへの表示を確認してください", "42501");
  const { data, error } = await db.rpc("save_club_member_display_name", {
    p_club_id: context.clubId, p_member_id: member.id, p_display_name: name,
    // Always the raw alias from the roster, including NULL. Never a profile-name fallback.
    p_expected_club_display_name: member.club_display_name,
    p_public_confirmation: publicConfirmation && confirmation,
  });
  if (error) throw new ClubDisplayNameError(error.code === "40001"
    ? "表示名が更新されています。最新の状態を確認してから再度保存してください"
    : "表示名を保存できませんでした。入力は保持されています。所属・権限を確認して再度お試しください", error.code);
  if (!data || data.member_id !== member.id || data.club_display_name !== name || data.public_name_confirmed !== publicConfirmation) {
    throw new ClubDisplayNameError("保存結果を確認できません。入力を保持したまま、最新の状態を確認してください");
  }
  return data as ClubNameResult;
}
