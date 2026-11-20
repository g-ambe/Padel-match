import type { SupabaseClient } from "@supabase/supabase-js";

export type OwnerTransferStatus = "pending" | "accepted" | "declined" | "cancelled";
export type OwnerTransfer = {
  id: string; club_id: string; club_name: string; status: OwnerTransferStatus; created_at: string;
  responded_at: string | null; is_sender: boolean; is_recipient: boolean; target_display_name: string;
};
export type OwnerCandidate = { member_id: string; display_name: string };
export type OwnerMembership = { club_id: string; role: string; is_active: boolean; status: string };
export const ownerTransferLabel: Record<OwnerTransferStatus, string> = { pending: "返答待ち", accepted: "引継ぎ完了", declined: "辞退済み", cancelled: "取消済み" };
export class OwnerTransferError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}
async function rpc<T>(db: SupabaseClient, name: string, args?: Record<string, unknown>): Promise<T> {
  let result;
  try { result = await db.rpc(name, args); }
  catch { throw new OwnerTransferError("通信結果を確認できません。選択は保持しています。再送せず、再読み込みして申請状況を確認してください"); }
  if (result.error) throw new OwnerTransferError(result.error.code === "PT409"
    ? "申請状況が変更されています。選択は保持しています。再読み込みしてください"
    : "操作を完了できません。選択は保持しています。再読み込みして権限と申請状況を確認してください", result.error.code);
  if (result.data === null) throw new OwnerTransferError("結果を確認できません。再送せず再読み込みしてください");
  return result.data as T;
}
export async function readOwnerCandidates(db: SupabaseClient, clubId: string): Promise<OwnerCandidate[] | null> {
  let rows: OwnerCandidate[];
  try { rows = await rpc(db, "get_club_owner_transfer_candidates", { p_club_id: clubId }); }
  catch (e) { if (e instanceof OwnerTransferError && e.code === "42501") return null; throw e; }
  if (!Array.isArray(rows) || rows.some(r => !r || typeof r.member_id !== "string" || typeof r.display_name !== "string")) throw new OwnerTransferError("引継ぎ候補を確認できません。再読み込みしてください");
  // Use only the owner-only RPC DTO; never derive candidates from a public roster.
  return rows.map(r => ({ member_id: r.member_id, display_name: r.display_name }));
}
export async function readMyOwnerTransfers(db: SupabaseClient): Promise<OwnerTransfer[]> {
  const rows = await rpc<OwnerTransfer[]>(db, "list_my_club_owner_transfers");
  if (!Array.isArray(rows) || rows.some(r => !r || typeof r.id !== "string" || typeof r.club_id !== "string" || typeof r.club_name !== "string"
    || !["pending", "accepted", "declined", "cancelled"].includes(r.status) || typeof r.is_sender !== "boolean" || typeof r.is_recipient !== "boolean"
    || !(r.is_sender || r.is_recipient) || typeof r.target_display_name !== "string")) throw new OwnerTransferError("本人の引継ぎ申請を確認できません。再読み込みしてください");
  return rows.map(r => ({ id:r.id, club_id:r.club_id, club_name:r.club_name, status:r.status, created_at:r.created_at,
    responded_at:r.responded_at, is_sender:r.is_sender, is_recipient:r.is_recipient, target_display_name:r.target_display_name }));
}
export const canAcceptOwnerTransfer = (r: OwnerTransfer, memberships: OwnerMembership[]) => r.status === "pending" && r.is_recipient
  && memberships.some(m => m.club_id === r.club_id && m.is_active && m.status === "active" && m.role === "main_admin");
export async function requestOwnerTransfer(db: SupabaseClient, clubId: string, selected: string, candidates: OwnerCandidate[] | null, requests: OwnerTransfer[], confirmed: boolean) {
  if (!confirmed || !candidates?.some(c => c.member_id === selected) || requests.some(r => r.club_id === clubId && r.status === "pending")) throw new OwnerTransferError("現在の候補と申請状況を再確認してください");
  const id = await rpc<string>(db, "request_club_owner_transfer", { p_club_id: clubId, p_to_member_id: selected });
  if (typeof id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new OwnerTransferError("申請結果が不明です。再送せず再読み込みしてください");
  return id;
}
export async function decideOwnerTransfer(db: SupabaseClient, request: OwnerTransfer, decision: "accepted" | "declined" | "cancelled",
  memberships: OwnerMembership[], isCurrentOwner: boolean, confirmed: boolean) {
  if (!confirmed || request.status !== "pending" || (decision === "cancelled" ? !request.is_sender || !isCurrentOwner
    : !request.is_recipient || (decision === "accepted" && !canAcceptOwnerTransfer(request, memberships)))) throw new OwnerTransferError("本人の権限と申請状況を再確認してください");
  const result = decision === "cancelled"
    ? await rpc(db, "cancel_club_owner_transfer", { p_request_id: request.id })
    : await rpc(db, "respond_club_owner_transfer", { p_request_id: request.id, p_decision: decision });
  if (result !== decision) throw new OwnerTransferError("処理結果が不明です。再送せず再読み込みしてください");
  return decision;
}
