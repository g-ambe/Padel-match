import type { SupabaseClient } from "@supabase/supabase-js";

export type TutorialStatus = "unseen" | "dismissed" | "completed";
export type ThemeMode = "dark" | "light";
export const isTutorialStatus = (value: unknown): value is TutorialStatus => ["unseen", "dismissed", "completed"].includes(String(value));

// 更新対象を1項目に限定する。新規作成の競合時も、他項目をDEFAULTへ戻さない。
export async function savePreference(db: SupabaseClient, owner: string, field: "theme_mode" | "tutorial_status", value: ThemeMode | TutorialStatus) {
  if (!(field === "theme_mode" ? ["dark", "light"] : ["unseen", "dismissed", "completed"]).includes(value)) throw new Error("設定値を確認してください");
  const { data, error } = await db.auth.getUser();
  if (error || data.user?.id !== owner) throw new Error("ログイン状態が変わりました。画面を更新してください。");
  const patch = { [field]: value };
  const update = () => db.from("user_preferences").update(patch).eq("auth_user_id", owner).select("auth_user_id").maybeSingle();
  const existing = await update();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  const inserted = await db.from("user_preferences").insert({ auth_user_id: owner, ...patch }).select("auth_user_id").single();
  if (!inserted.error) return;
  if (inserted.error.code !== "23505") throw inserted.error;
  const retry = await update();
  if (retry.error || !retry.data) throw retry.error ?? new Error("設定を保存できませんでした");
}
