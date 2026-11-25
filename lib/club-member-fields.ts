import type { SupabaseClient } from "@supabase/supabase-js";
import { canEditClubDisplayName, ClubDisplayNameError, type ClubNameMember, type ClubNameContext } from "./club-display-name";
export type PublicNameChoice = null | "default_on" | "on" | "off";
export type MemberFieldState = {
  member_id: string; club_display_name: string | null; public_name_choice: PublicNameChoice;
  public_name_confirmed: boolean; public_name_enabled: boolean; group_visibility: "public" | "private";
};
export function validMemberFieldState(value: unknown): value is MemberFieldState {
  if (!value || typeof value !== "object") return false;
  const v = value as MemberFieldState;
  return typeof v.member_id === "string" && (v.club_display_name === null || typeof v.club_display_name === "string")
    && [null,"on","off","default_on"].includes(v.public_name_choice)
    && typeof v.public_name_confirmed === "boolean" && typeof v.public_name_enabled === "boolean"
    && ["public","private"].includes(v.group_visibility)
    && !(v.public_name_choice === "on" && !v.public_name_confirmed)
    && !(["off","default_on"].includes(v.public_name_choice ?? "") && v.public_name_confirmed)
    && !(v.public_name_choice !== null && v.club_display_name === null)
    && !(v.public_name_enabled && (v.group_visibility !== "public" || v.public_name_choice === "off" || v.club_display_name === null));
}
export async function saveClubMemberField(db: SupabaseClient, member: ClubNameMember, context: ClubNameContext,
  snapshot: MemberFieldState, change: { field: "name"; name: string } | { field: "public"; enabled: boolean }): Promise<MemberFieldState> {
  if (!canEditClubDisplayName(member,context) || member.id !== snapshot.member_id || !validMemberFieldState(snapshot)
    || snapshot.group_visibility !== context.visibility
    || (change.field === "public" && (!member.linked_auth_user_id || context.visibility !== "public"))) {
    throw new ClubDisplayNameError("所属・権限・最新の表示設定を確認してください", "42501");
  }
  const name = change.field === "name" ? change.name.trim() : null;
  if (change.field === "name" && (!name || Array.from(name).length > 120 || /[\u0000-\u001f\u007f-\u009f]/u.test(name))) {
    throw new ClubDisplayNameError("表示名は制御文字を含めず120文字以内で入力してください", "22023");
  }
  let response;
  try { response = await db.rpc("save_club_member_field_v2", {
    p_club_id: context.clubId, p_member_id: member.id, p_field: change.field,
    p_name: name, p_public: change.field === "public" ? change.enabled : null,
    p_expected_name: snapshot.club_display_name, p_expected_choice: snapshot.public_name_choice,
    p_expected_confirmed: snapshot.public_name_confirmed, p_expected_visibility: snapshot.group_visibility,
  }); } catch { throw new ClubDisplayNameError("通信結果を確認できません。入力は保持しています。再送せず最新の状態を確認してください"); }
  const {data,error} = response;
  if(error) throw new ClubDisplayNameError(error.code === "PT409" || error.code === "40001"
    ? "他の操作で更新されています。入力を保持したまま最新の状態を確認してください"
    : "保存できませんでした。入力は保持しています。最新の状態を確認してください",error.code);
  if (!validMemberFieldState(data) || data.member_id !== member.id || data.group_visibility !== snapshot.group_visibility
    || (change.field === "name" && data.club_display_name !== name)
    || (change.field === "public" && (data.public_name_enabled !== change.enabled || data.public_name_choice !== (change.enabled ? "on" : "off")))
    || (change.field === "name" && (data.public_name_confirmed !== snapshot.public_name_confirmed
      || data.public_name_choice !== (snapshot.club_display_name === null && snapshot.public_name_choice === null && !snapshot.public_name_confirmed && member.linked_auth_user_id && context.visibility === "public" ? "default_on" : snapshot.public_name_choice)))
    || (change.field === "public" && snapshot.club_display_name !== null && data.club_display_name !== snapshot.club_display_name)) {
    throw new ClubDisplayNameError("保存結果を確認できません。入力は保持しています。再送せず最新の状態を確認してください");
  }
  return data;
}
