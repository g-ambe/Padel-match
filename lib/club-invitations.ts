import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidProfileLinkDisplayName } from "./profile-links";

export type ClubInvitation = { invite_id: string; generation: number; club_id: string; club_name: string; member_name: string; expires_at: string; group_visibility: "public" | "private"; inflight: boolean };
export type ClubInvitationPreview = { status: "ok"; invite_id: string; generation: number; club_id: string; club_name: string; expires_at: string; group_visibility: "public" | "private"; group_display_name_suggestion: string; group_display_name_current: string | null; review_token: string; target_display_name: string | null; participant_count: number; match_count: number; result_count: number; team_match_count: number; official_match_count: number };
type Result = { status?: unknown; [key: string]: unknown };
async function rpc(s: SupabaseClient, name: string, args: Record<string, unknown>): Promise<Result> {
  const {data,error}=await s.rpc(name,args);
  if(error || !data || typeof data!=="object" || Array.isArray(data)) throw new Error("招待情報を確認できません。時間をおいて再読み込みしてください。");
  return data as Result;
}
export async function listClubInvitations(s: SupabaseClient): Promise<ClubInvitation[]> {
  const r=await rpc(s,"list_my_club_invites",{});
  if(r.status!=="ok" || !Array.isArray(r.invitations)) throw new Error(r.status==="identity_required"?"確認済みのアカウントとプロフィールが必要です。":"招待一覧を確認できません。");
  if(!r.invitations.every(i=>i && typeof i==="object" && typeof i.invite_id==="string" && Number.isSafeInteger(i.generation) && typeof i.club_id==="string" && typeof i.club_name==="string" && typeof i.member_name==="string" && typeof i.expires_at==="string" && (i.group_visibility==="public"||i.group_visibility==="private") && typeof i.inflight==="boolean")) throw new Error("招待一覧を確認できません。");
  return r.invitations as ClubInvitation[];
}
export async function previewClubInvitation(s: SupabaseClient, invite: ClubInvitation): Promise<ClubInvitationPreview> {
  const r=await rpc(s,"preview_my_club_invite",{p_invite:invite.invite_id,p_generation:invite.generation});
  if(r.status!=="ok" || r.invite_id!==invite.invite_id || r.generation!==invite.generation || r.club_id!==invite.club_id || typeof r.review_token!=="string" || !r.review_token || typeof r.group_display_name_suggestion!=="string" || (r.group_display_name_current!==null&&typeof r.group_display_name_current!=="string") || typeof r.expires_at!=="string" || (r.group_visibility!=="public"&&r.group_visibility!=="private")) throw new Error("招待の内容を確認できません。再読み込みしてください。");
  return r as ClubInvitationPreview;
}
export async function acceptClubInvitation(s: SupabaseClient, p: ClubInvitationPreview, input: {name:string; publicChoice:boolean; consent:boolean; operationId:string}) {
  if(!input.consent || !isValidProfileLinkDisplayName(input.name) || !p.review_token || !Number.isFinite(Date.parse(p.expires_at)) || Date.parse(p.expires_at)<=Date.now()) throw new Error("表示名と引継ぎへの同意を確認してください。");
  const r=await rpc(s,"accept_my_club_invite",{p_invite:p.invite_id,p_generation:p.generation,p_operation_id:input.operationId,p_review_token:p.review_token,p_expected_club_display_name:p.group_display_name_current,p_expected_visibility:p.group_visibility,p_club_display_name:input.name.trim(),p_public_confirmation:p.group_visibility==="public"&&input.publicChoice,p_inheritance_consent:true});
  if(r.status!=="approved" || r.invite_id!==p.invite_id || r.club_id!==p.club_id) throw new Error("参加を確定できません。入力を保持しています。招待内容を再確認してください。");
  return r;
}
export async function rejectClubInvitation(s:SupabaseClient, invite:ClubInvitation, operationId:string) {
  const r=await rpc(s,"reject_my_club_invite",{p_invite:invite.invite_id,p_generation:invite.generation,p_operation_id:operationId});
  if(r.status!=="rejected" || r.invite_id!==invite.invite_id) throw new Error("拒否を確定できません。再読み込みして招待状態を確認してください。");
  return r;
}
