import type { SupabaseClient } from "@supabase/supabase-js";

export type ParticipantStatus = "active" | "resting" | "absent";
type StatusRow = { id: string; event_id: string; status: ParticipantStatus };
const validStatus = (value: unknown): value is ParticipantStatus => ["active", "resting", "absent"].includes(String(value));

export async function readParticipantStatus(supabase: SupabaseClient, eventId: string, participantId: string): Promise<StatusRow> {
  const { data, error } = await supabase.from("event_participants").select("id,event_id,status")
    .eq("event_id", eventId).eq("id", participantId).single();
  if (error || !data || data.id !== participantId || data.event_id !== eventId || !validStatus(data.status)) {
    throw new Error("参加状態を確認できませんでした。再読み込みしてから操作してください。");
  }
  return data;
}

// 既存のstatus更新だけを行う。所属・選手参照・作成済みの対戦・固定ペアには触れない。
export async function saveParticipantStatus(supabase: SupabaseClient, eventId: string, participantId: string, before: ParticipantStatus, next: ParticipantStatus): Promise<StatusRow> {
  if (!validStatus(before) || !validStatus(next)) throw new Error("参加状態が不正です。再読み込みしてください。");
  const { data, error } = await supabase.from("event_participants").update({ status: next })
    .eq("event_id", eventId).eq("id", participantId).eq("status", before).select("id,event_id,status");
  if (error) throw new Error("参加状態の更新に失敗しました。所属・権限と通信状態を確認してください。");
  if (!Array.isArray(data) || data.length !== 1 || data[0].id !== participantId || data[0].event_id !== eventId || data[0].status !== next) {
    throw new Error("参加状態を更新できませんでした。他の操作との競合や権限を確認し、状態を再読み込みしてください。");
  }
  const saved = await readParticipantStatus(supabase, eventId, participantId);
  if (saved.status !== next) throw new Error("保存後に参加状態が変更されています。状態を再読み込みしてください。");
  return saved;
}
