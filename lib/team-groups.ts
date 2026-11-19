import type { SupabaseClient } from "@supabase/supabase-js";
import { readMyMemberships } from "./group-read";
import type { OfficialGroup } from "./official-matches";

// RLSで閲覧可能な中から所属・公開だけを候補にする。取得失敗を未所属と扱わない。
export async function readTeamGroups(s: SupabaseClient) {
  const { data: auth, error: authError } = await s.auth.getUser();
  if (authError || !auth.user) throw new Error("ログイン状態を確認できません");
  const own = (await readMyMemberships(s)).filter(m=>m.is_active);
  const roles = new Map(own.map(m=>[m.club_id,m.role]));
  const clubs = await s.from("clubs").select("id,name,visibility").eq("is_active",true).eq("is_deleted",false);
  if (clubs.error) throw clubs.error;
  const groups = [...new Map((clubs.data ?? []).filter(g=>roles.has(g.id)||g.visibility==="public").map(g=>[g.id,{id:g.id,name:g.name,role:roles.get(g.id) ?? "member"} as OfficialGroup])).values()];
  return { uid: auth.user.id, groups, memberIds: [...roles.keys()] as string[] };
}
