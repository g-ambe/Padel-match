import type { SupabaseClient } from "@supabase/supabase-js";
export type OfficialGroup = { id: string; name: string; role: "main_admin" | "sub_admin" | "member" };
export async function getOfficialAccess(s: SupabaseClient) {
  const { data: u } = await s.auth.getUser(); const uid = u.user?.id; if (!uid) return { uid: "", superUser: false, groups: [] as OfficialGroup[] };
  const { data: admin } = await s.from("app_admins").select("id").eq("profile_id", uid).eq("is_active", true).maybeSingle();
  const { data: profiles } = await s.from("player_profiles").select("id").eq("linked_auth_user_id", uid); const ids = (profiles ?? []).map((p: any) => p.id);
  let q: any = s.from("club_members").select("club_id,role,clubs(id,name,is_active)").eq("is_active", true); q = ids.length ? q.in("player_profile_id", ids) : q.eq("profile_id", uid);
  const { data: memberships } = await q; let groups = (memberships ?? []).filter((m: any) => m.clubs?.is_active !== false).map((m: any) => ({ id: m.club_id, name: m.clubs?.name ?? "名称未設定", role: m.role ?? "member" }));
  if (admin) { const { data } = await s.from("clubs").select("id,name").eq("is_active", true); groups = (data ?? []).map((g: any) => ({ ...g, role: "main_admin" })); }
  return { uid, superUser: !!admin, groups: groups as OfficialGroup[] };
}
export const resultLabel: Record<string,string> = { win: "勝ち", lose: "負け", draw: "引き分け", undecided: "未定" };
export const autoResult = (a: number | null, b: number | null) => a === null || b === null ? "undecided" : a > b ? "win" : a < b ? "lose" : "draw";
export const validYoutubeUrl = (v: string) => !v || /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(v);
