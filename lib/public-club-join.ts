import type { SupabaseClient } from "@supabase/supabase-js";
import type { DirectoryMember, PublicClaimPreview } from "./group-read";

export type NamedJoinContext = { clubId: string; userId: string | null; visibility: "public" | "private"; isMember: boolean; hasPendingRequest: boolean };
export type BoundClaimPreview = { clubId: string; reference: string; value: PublicClaimPreview };
export class PublicClubJoinError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}
export function validClaimPreview(value: PublicClaimPreview | null): value is PublicClaimPreview {
  return !!value && typeof value.display_name === "string" && typeof value.has_target === "boolean"
    && typeof value.review_token === "string" && value.review_token.length > 0
    && [value.membership_count,value.participant_count,value.match_count,value.result_count,value.team_match_count,value.official_match_count]
      .every(count => Number.isSafeInteger(count) && count >= 0);
}
export async function previewPublicJoin(db: SupabaseClient, clubId: string, reference: string): Promise<BoundClaimPreview> {
  const { data, error } = await db.rpc("preview_public_club_claim", { p_club_id: clubId, p_reference: reference });
  if (error || !validClaimPreview(data)) throw new PublicClubJoinError("引き継ぐ内容を確認できません。入力は保持されています。再確認してください", error?.code);
  return { clubId, reference, value: data };
}
export async function submitNamedPublicJoin(db: SupabaseClient, context: NamedJoinContext, candidates: DirectoryMember[], draft: {
  reference: string | null; name: string; message: string; publicConfirmation: boolean; inheritanceConsent: boolean;
  preview: BoundClaimPreview | null;
}): Promise<string> {
  if (!context.clubId || !context.userId || context.visibility !== "public" || context.isMember || context.hasPendingRequest) {
    throw new PublicClubJoinError("加入先・ログイン・申請状況を確認してください", "42501");
  }
  const name = draft.name.trim();
  if (!name || Array.from(name).length > 120 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) throw new PublicClubJoinError("グループ内表示名は制御文字を含めず120文字以内で入力してください", "22023");
  if (!draft.publicConfirmation) throw new PublicClubJoinError("承認後のメンバー一覧への表示を確認してください", "42501");
  let token: string | null = null;
  if (draft.reference !== null) {
    const match = candidates.some(candidate => candidate.reference === draft.reference && candidate.is_unlinked);
    const preview = draft.preview;
    if (!match || !draft.inheritanceConsent || !preview || preview.clubId !== context.clubId || preview.reference !== draft.reference
      || !validClaimPreview(preview.value) || !preview.value.has_target) {
      throw new PublicClubJoinError("仮登録選手と引き継ぐ内容を再確認して同意してください", "42501");
    }
    token = preview.value.review_token;
  }
  const { data, error } = await db.rpc("submit_public_club_claim_named", {
    p_club_id: context.clubId, p_reference: draft.reference, p_message: draft.message.trim() || null,
    p_review_token: token, p_club_display_name: name, p_public_confirmation: true,
  });
  if (error) throw new PublicClubJoinError("申請できませんでした。入力は保持されています。加入先や仮登録選手の状態を確認し、引き継ぐ内容を再確認してください", error.code);
  if (typeof data !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(data)) {
    throw new PublicClubJoinError("送信結果を確認できません。再送する前に申請状況を確認してください");
  }
  return data;
}
