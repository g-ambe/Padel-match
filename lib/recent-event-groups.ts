import type { SupabaseClient } from "@supabase/supabase-js";

export function recentFirstGroups<T extends { id: string }>(groups: readonly T[], recentIds: readonly (string | null)[]): T[] {
  const order = new Map([...new Set(recentIds.filter((id): id is string => !!id))].map((id, index) => [id, index]));
  return groups.map((group, index) => ({ group, index })).sort((a,b) => (order.get(a.group.id) ?? Infinity) - (order.get(b.group.id) ?? Infinity) || a.index - b.index).map(row => row.group);
}

export async function recentEventGroups<T extends { id: string }>(s: SupabaseClient, groups: readonly T[]): Promise<T[]> {
  if (!groups.length) return [];
  // 閲覧可能な既存履歴から候補の順序だけを変える。所属・権限の候補は増やさない。
  try {
    const { data, error } = await s.from("events").select("club_id,created_at").eq("is_deleted",false)
      .in("club_id",groups.map(group=>group.id)).order("created_at",{ascending:false}).order("id").limit(50);
    return error || !data ? [...groups] : recentFirstGroups(groups, data.map(row=>row.club_id));
  } catch { return [...groups]; }
}
