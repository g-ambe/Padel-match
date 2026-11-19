import { readMyMemberships } from "./group-read";
import type { SupabaseClient } from "@supabase/supabase-js";

export type FriendlyGroup = { id: string; name: string };
type Group = FriendlyGroup;
type ClubRow = { id?: string | null; name?: string | null; is_active?: boolean | null; is_deleted?: boolean | null };

// 通常フレンドリーの既存ホームと同じ所属・旧列フォールバックを利用する。
export async function loadFriendlyEventAccess(supabase: SupabaseClient) {
  const { data: userRes, error } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (error || !userId) throw new Error("ログイン情報を確認できません");
  const isMissingColumnError = (error: any, column: string) => {
    const message = `${error?.message ?? ""} ${error?.details ?? ""}`;
    return error?.code === "42703" || message.includes(column);
  };

  const isSuperUser = async () => {
    const { data } = await supabase
      .from("app_admins")
      .select("id")
      .eq("profile_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    return !!data;
  };

  const loadActiveClubs = async (clubIds?: string[]): Promise<Group[]> => {
    const fetchClubs = async (select: string) => {
      let query: any = supabase.from("clubs").select(select).order("created_at", { ascending: true });
      if (clubIds) query = query.in("id", clubIds);
      return await query;
    };

    let { data, error } = await fetchClubs("id,name,is_active,is_deleted");
    if (error && isMissingColumnError(error, "is_deleted")) {
      const fallback = await fetchClubs("id,name,is_active");
      data = fallback.data;
      error = fallback.error;
    }
    if (error && isMissingColumnError(error, "is_active")) {
      const fallback = await fetchClubs("id,name");
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      throw new Error("グループ取得に失敗しました");
    }

    return ((data ?? []) as ClubRow[])
      .filter((club) => club.is_active !== false && club.is_deleted !== true)
      .map((club): Group => ({ id: club.id ?? "", name: club.name ?? "" }))
      .filter((club): club is Group => Boolean(club.id && club.name));
  };

  const superUser = await isSuperUser();
  let groupRows: Group[] = [];
  if (superUser) {
    groupRows = await loadActiveClubs();
  } else {
    const memberships = (await readMyMemberships(supabase)).filter(m=>m.is_active);
    const groupIds: string[] = Array.from(
      new Set(
        memberships
          .map((m: any) => m.club_id)
          .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      )
    );
    groupRows = groupIds.length ? await loadActiveClubs(groupIds) : [];
  }

  return { uid: userId, superUser, groups: groupRows };
}
