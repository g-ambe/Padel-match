import type { SupabaseClient } from "@supabase/supabase-js";
export type DirectoryMember = { reference: string; display_name: string; is_unlinked: boolean };
export type ContextName = { id: string; display_name: string; kind: "player" | "account" };
// No fallback to the old globally-readable profile tables on RPC failure.
async function rows<T>(db: SupabaseClient, rpc: string, args?: Record<string, unknown>): Promise<T[]> {
  const result = await db.rpc(rpc, args);
  if (result.error || !Array.isArray(result.data)) throw new Error("必要な情報を取得できませんでした。再度読み込んでください");
  return result.data as T[];
}
export const readPublicDirectory = (db: SupabaseClient, club: string) => rows<DirectoryMember>(db, "get_public_club_directory", { p_club_id: club });
export const readMyMemberships = (db: SupabaseClient) => rows<{ id: string; club_id: string; role: string; is_active: boolean; status: string }>(db, "get_my_club_memberships");
export const readEventCandidates = (db: SupabaseClient, event: string, club: string) => rows<{ member_id: string; player_profile_id: string; display_name: string }>(db, "get_event_club_candidates", { p_event_id: event, p_club_id: club });
export const readEventNames = (db: SupabaseClient, event: string) => rows<ContextName>(db, "get_event_player_names", { p_event_id: event });
export const readSharedEventNames = (db: SupabaseClient, token: string) => rows<ContextName>(db, "get_shared_event_player_names", { p_token: token });
export const readSharedOfficialNames = (db: SupabaseClient, token: string) => rows<{ id: string; display_name: string }>(db, "get_shared_official_player_names", { p_token: token });
export const readClubStatsNames = (db: SupabaseClient, club: string) => rows<{ id: string; display_name: string }>(db, "get_club_stats_player_names", { p_club_id: club });
