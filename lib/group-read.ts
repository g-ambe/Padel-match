import type { SupabaseClient } from "@supabase/supabase-js";
export type DirectoryMember = { reference: string; display_name: string; is_unlinked: boolean };
export type ContextName = { id: string; display_name: string; kind: "player" | "account" };
// No fallback to the old globally-readable profile tables on RPC failure.
async function rows<T>(db: SupabaseClient, rpc: string, args?: Record<string, unknown>): Promise<T[]> {
  const all:T[]=[];
  for(let start=0;;start+=500){
    const result=await db.rpc(rpc,args).range(start,start+499);
    if(result.error||!Array.isArray(result.data))throw new Error("必要な情報を取得できませんでした。再度読み込んでください");
    all.push(...result.data as T[]);
    if(result.data.length<500)return all;
  }
}
export const readPublicDirectory = (db: SupabaseClient, club: string) => rows<DirectoryMember>(db, "get_public_club_directory", { p_club_id: club });
export const readMyMemberships = (db: SupabaseClient) => rows<{ id: string; club_id: string; role: string; is_active: boolean; status: string }>(db, "get_my_club_memberships");
export const readEventCandidates = (db: SupabaseClient, event: string, club: string) => rows<{ member_id: string; player_profile_id: string; display_name: string }>(db, "get_event_club_candidates", { p_event_id: event, p_club_id: club });
export const readEventNames = (db: SupabaseClient, event: string) => rows<ContextName>(db, "get_event_player_names", { p_event_id: event });
export const readSharedEventNames = (db: SupabaseClient, token: string) => rows<ContextName>(db, "get_shared_event_player_names", { p_token: token });
export const readSharedOfficialNames = (db: SupabaseClient, token: string) => rows<{ id: string; display_name: string }>(db, "get_shared_official_player_names", { p_token: token });
export const readClubStatsNames = (db: SupabaseClient, club: string) => rows<{ id: string; display_name: string }>(db, "get_club_stats_player_names", { p_club_id: club });
export type RosterMember = { id: string; club_id: string; profile_id: string|null; player_profile_id:string|null; role:"main_admin"|"sub_admin"|"member"; is_active:boolean; status:string; created_at:string; player_profiles:{id:string;display_name:string;linked_auth_user_id:string|null;is_active:boolean;club_display_name:string|null;public_name_confirmed:boolean}|null };
export const readClubRoster = (db:SupabaseClient,club:string)=>rows<RosterMember>(db,"get_club_roster",{p_club_id:club});
export const readStatsMembers = (db:SupabaseClient,club:string)=>rows<{player_profile_id:string|null;is_active:boolean}>(db,"get_club_stats_members",{p_club_id:club});
export const readClubCandidates = (db:SupabaseClient,club:string)=>rows<{member_id:string;player_profile_id:string;display_name:string}>(db,"get_club_selection_candidates",{p_club_id:club});
export const readOfficialNames = (db:SupabaseClient,event:string)=>rows<{id:string;display_name:string}>(db,"get_official_player_names",{p_event_id:event});
export type PublicClaimPreview={display_name:string;target_display_name:string|null;has_target:boolean;review_token:string;membership_count:number;participant_count:number;match_count:number;result_count:number;team_match_count:number;official_match_count:number};
export const readJoinRequestNames=(db:SupabaseClient,club:string)=>rows<{id:string;display_name:string}>(db,"get_club_join_request_names",{p_club_id:club});
export const readAdminMemberCounts=(db:SupabaseClient)=>rows<{club_id:string;member_count:number}>(db,"get_admin_group_member_counts");
export async function readAdminAccountNames(db:SupabaseClient,ids:string[]){const result:{id:string;display_name:string}[]=[];for(let i=0;i<ids.length;i+=100)result.push(...await rows<{id:string;display_name:string}>(db,"get_admin_account_names",{p_ids:ids.slice(i,i+100)}));return result;}
