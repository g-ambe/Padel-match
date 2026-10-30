import type { SupabaseClient } from "@supabase/supabase-js";

// Deployment compatibility only: legacyName has already passed the caller's clubs SELECT RLS.
export async function readSharedOfficialClubName(supabase: SupabaseClient, token: string, legacyName: string | null = null) {
  if (!token.trim()) return null;
  const { data, error } = await supabase.rpc("get_shared_official_club_name", { p_share_token: token });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return legacyName;
    throw error;
  }
  return typeof data === "string" ? data : null;
}
