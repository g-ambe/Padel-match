import type { SupabaseClient } from "@supabase/supabase-js";

export type OfficialGroup = {
  id: string;
  name: string;
  role: "main_admin" | "sub_admin" | "member";
};

type ClubRow = { id: string; name: string; is_active?: boolean | null; is_deleted?: boolean | null };
type MembershipRow = { club_id: string; role?: OfficialGroup["role"] | null };

const missingColumn = (error: any, column: string) =>
  error?.code === "42703" || `${error?.message ?? ""} ${error?.details ?? ""}`.includes(column);

async function loadActiveClubs(supabase: SupabaseClient, clubIds?: string[]) {
  const fetch = async (select: string) => {
    let query: any = supabase.from("clubs").select(select);
    if (clubIds) query = query.in("id", clubIds);
    return await query;
  };

  let { data, error } = await fetch("id,name,is_active,is_deleted");
  if (error && missingColumn(error, "is_deleted")) ({ data, error } = await fetch("id,name,is_active"));
  if (error && missingColumn(error, "is_active")) ({ data, error } = await fetch("id,name"));
  if (error) return [] as ClubRow[];

  return ((data ?? []) as ClubRow[]).filter((club) => club.is_active !== false && club.is_deleted !== true);
}

async function loadMemberships(supabase: SupabaseClient, column: "player_profile_id" | "profile_id", ids: string[]) {
  if (!ids.length) return [] as MembershipRow[];
  const fetch = async (withStatus: boolean) => {
    let query: any = supabase.from("club_members").select("club_id,role").eq("is_active", true);
    query = ids.length === 1 ? query.eq(column, ids[0]) : query.in(column, ids);
    if (withStatus) query = query.eq("status", "active");
    return await query;
  };

  let { data, error } = await fetch(true);
  if (error && missingColumn(error, "status")) ({ data, error } = await fetch(false));
  return error ? [] : ((data ?? []) as MembershipRow[]);
}

export async function getOfficialAccess(supabase: SupabaseClient) {
  const { data: userResult } = await supabase.auth.getUser();
  const uid = userResult.user?.id;
  if (!uid) return { uid: "", superUser: false, groups: [] as OfficialGroup[] };

  const { data: admin } = await supabase.from("app_admins").select("id").eq("profile_id", uid).eq("is_active", true).maybeSingle();
  if (admin) {
    const clubs = await loadActiveClubs(supabase);
    return { uid, superUser: true, groups: clubs.map((club) => ({ id: club.id, name: club.name, role: "main_admin" as const })) };
  }

  const { data: profiles } = await supabase.from("player_profiles").select("id").eq("linked_auth_user_id", uid);
  const profileIds = (profiles ?? []).map((profile: any) => profile.id).filter(Boolean);
  let memberships = await loadMemberships(supabase, "player_profile_id", profileIds);
  if (!memberships.length) memberships = await loadMemberships(supabase, "profile_id", [uid]);

  const roleByClub = new Map(memberships.map((membership) => [membership.club_id, membership.role ?? "member"]));
  const clubs = await loadActiveClubs(supabase, [...roleByClub.keys()]);
  return { uid, superUser: false, groups: clubs.map((club) => ({ id: club.id, name: club.name, role: roleByClub.get(club.id) ?? "member" })) };
}

export const officialStatusLabel = (status: string) => (status === "closed" ? "終了済み" : "進行中");
