import type { SupabaseClient } from "@supabase/supabase-js";

export type MemberGroup = { id: string; name: string; description: string | null; is_active: boolean; visibility: "private" | "public" };
const check = (error: unknown) => { if (error) throw new Error("所属グループを取得できませんでした。再読み込みしてください。"); };

// 所属一覧の既存条件を再利用する。super_userの閲覧可能グループと本人の所属は分ける。
export async function readMemberGroups(supabase: SupabaseClient) {
  const { data: userRes, error: authError } = await supabase.auth.getUser();
  check(authError);
  const userId = userRes.user?.id;
  if (!userId) return { uid: "", groups: [] as MemberGroup[] };

  const { data: adminRow, error: adminError } = await supabase.from("app_admins").select("id").eq("profile_id", userId).eq("is_active", true).maybeSingle();
  check(adminError);
  const isSuperUser = !!adminRow;

  if (isSuperUser) {
    const { data, error: clubsError } = await supabase.from("clubs").select("id,name,description,is_active,visibility").order("created_at", { ascending: false });
    check(clubsError);
    const all = (data ?? []) as MemberGroup[];
    const { data: linkedProfilesForSuper, error: profilesError } = await supabase
      .from("player_profiles")
      .select("id")
      .eq("linked_auth_user_id", userId);
    check(profilesError);
    const linkedProfileIdsForSuper = (linkedProfilesForSuper ?? []).map((p: any) => p.id).filter(Boolean);
    const { data: memberRowsForSuper, error: membershipError } = linkedProfileIdsForSuper.length
      ? await supabase
          .from("club_members")
          .select("club_id")
          .in("player_profile_id", linkedProfileIdsForSuper)
          .eq("is_active", true)
      : await supabase
          .from("club_members")
          .select("club_id")
          .eq("profile_id", userId)
          .eq("is_active", true);
    check(membershipError);
    const memberClubIdSet = new Set((memberRowsForSuper ?? []).map((r: any) => r.club_id).filter(Boolean));
    const memberships = all.filter((g) => g.is_active && memberClubIdSet.has(g.id));
    return { uid: userId, groups: memberships };
  }

  const { data: linkedProfiles, error: profilesError } = await supabase
    .from("player_profiles")
    .select("id")
    .eq("linked_auth_user_id", userId);
  check(profilesError);

  const linkedProfileIds = (linkedProfiles ?? []).map((p: any) => p.id).filter(Boolean);

  let memberRows: any[] = [];
  if (linkedProfileIds.length) {
    const { data, error } = await supabase
      .from("club_members")
      .select("clubs(id,name,description,is_active,visibility)")
      .in("player_profile_id", linkedProfileIds)
      .eq("is_active", true)
      .eq("clubs.is_active", true);
    check(error);
    memberRows = data ?? [];
  }

  if (!memberRows.length) {
    const { data, error } = await supabase
      .from("club_members")
      .select("clubs(id,name,description,is_active,visibility)")
      .eq("profile_id", userId)
      .eq("is_active", true)
      .eq("clubs.is_active", true);
    check(error);
    memberRows = data ?? [];
  }


  const ownedRows: MemberGroup[] = memberRows.map((r: any) => r.clubs).filter(Boolean);
  const memberMap = new Map<string, MemberGroup>();
  for (const g of ownedRows) memberMap.set(g.id, g);
  const memberRowsUnique = [...memberMap.values()];

  return { uid: userId, groups: memberRowsUnique };
}
