import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfficialGroup } from "./official-matches";

// RLSで閲覧可能な中から所属・公開だけを候補にする。取得失敗を未所属と扱わない。
export async function readTeamGroups(s: SupabaseClient) {
  const { data: auth, error: authError } = await s.auth.getUser();
  if (authError || !auth.user) throw new Error("ログイン状態を確認できません");
  const { data: profiles, error: profileError } = await s.from("player_profiles").select("id").eq("linked_auth_user_id", auth.user.id).eq("is_active", true);
  if (profileError) throw profileError;
  const ids = (profiles ?? []).map(p=>p.id);
  const legacy = await s.from("club_members").select("club_id,role").eq("profile_id", auth.user.id).eq("is_active", true);
  const linked = ids.length ? await s.from("club_members").select("club_id,role").in("player_profile_id",ids).eq("is_active",true) : { data: [], error: null };
  if (legacy.error || linked.error) throw legacy.error || linked.error;
  const roles = new Map([...(legacy.data ?? []), ...(linked.data ?? [])].map(m=>[m.club_id,m.role]));
  const clubs = await s.from("clubs").select("id,name,visibility").eq("is_active",true).eq("is_deleted",false);
  if (clubs.error) throw clubs.error;
  const groups = [...new Map((clubs.data ?? []).filter(g=>roles.has(g.id)||g.visibility==="public").map(g=>[g.id,{id:g.id,name:g.name,role:roles.get(g.id) ?? "member"} as OfficialGroup])).values()];
  return { groups, memberIds: [...roles.keys()] as string[] };
}
