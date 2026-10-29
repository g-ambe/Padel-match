import type { SupabaseClient } from "@supabase/supabase-js";

export const validCourtCount = (count: number) => Number.isInteger(count) && count >= 1 && count <= 5;

export async function readEventCourts(supabase: SupabaseClient, eventId: string) {
  const { data, error } = await supabase.from("events")
    .select("court_count,status,is_deleted,event_mode").eq("id", eventId).single();
  if (error || !data || !validCourtCount(data.court_count)) throw new Error("利用コート数を取得できませんでした。再度お試しください");
  return data as { court_count: number; status: string; is_deleted: boolean; event_mode: string | null };
}

export async function saveEventCourts(supabase: SupabaseClient, eventId: string, previous: number, next: number) {
  if (!validCourtCount(previous) || !validCourtCount(next)) throw new Error("利用コート数は1〜5面で選択してください");
  // 画面に表示した設定を比較条件に含め、他端末の変更を無断で上書きしない。
  const { data, error } = await supabase.from("events").update({ court_count: next })
    .eq("id", eventId).eq("status", "active").eq("event_mode", "auto").eq("is_deleted", false)
    .eq("court_count", previous).select("court_count").single();
  if (error || !data || data.court_count !== next) {
    throw new Error(error?.code === "PGRST116"
      ? "設定または開催状態が変更されています。閉じて現在の設定を確認し、再操作してください"
      : "利用コート数を保存できませんでした。元の設定を維持しています");
  }
  return data.court_count as number;
}
