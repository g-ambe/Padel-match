import { readClubCandidates, readEventCandidates, readEventNames, readOfficialNames } from "./group-read";
import type { SupabaseClient } from "@supabase/supabase-js";
import { preferredPlayerProfileId, readProfileRows, resolveLinkedPlayerProfile } from "./player-profiles";

type ClubMemberRow = {
  player_profile_id?: string | null;
  profile_id?: string | null;
};

type PlayerProfileRow = {
  id: string;
  display_name?: string | null;
  is_active?: boolean | null;
};

type AccountProfileRow = {
  id: string;
  display_name?: string | null;
};

type ActiveClubMemberParticipant = {
  playerProfileId: string;
  displayName: string | null;
  membershipId?: string;
};

export async function fetchActiveClubMemberParticipants(supabase: SupabaseClient, clubId: string, eventId?:string): Promise<ActiveClubMemberParticipant[]> {
 const rows=eventId?await readEventCandidates(supabase,eventId,clubId):await readClubCandidates(supabase,clubId);
 return [...new Map(rows.map(r=>[r.player_profile_id,{playerProfileId:r.player_profile_id,displayName:r.display_name}])).values()];
}

export async function addMissingClubMembersToEvent(supabase: SupabaseClient, eventId: string, clubId: string) {
  const { data: existingParticipants, error: existingError } = await supabase
    .from("event_participants")
    .select("profile_id,player_profile_id")
    .eq("event_id", eventId);
  if (existingError) throw existingError;

  const existingProfileIds = new Set(
    (existingParticipants ?? [])
      .flatMap((participant: any) => [participant.player_profile_id, participant.profile_id])
      .filter(Boolean)
  );

  const activeMembers = await fetchActiveClubMemberParticipants(supabase, clubId,eventId);
  const inserts = activeMembers
    .filter((member) => !existingProfileIds.has(member.playerProfileId))
    .map((member) => ({
      event_id: eventId,
      player_profile_id: member.playerProfileId,
      guest_name: member.displayName,
      status: "active",
      participant_type: "member"
    }));

  if (!inserts.length) return { insertedCount: 0 };

  const { error: insertError } = await supabase.from("event_participants").insert(inserts);
  if (insertError) throw insertError;
  return { insertedCount: inserts.length };
}

export async function addCreatorToNoGroupEvent(supabase: SupabaseClient, eventId: string, creatorAuthUserId: string) {
  const playerProfile = await resolveLinkedPlayerProfile(supabase, creatorAuthUserId, preferredPlayerProfileId(creatorAuthUserId));
  if (playerProfile?.is_active === false) throw new Error("選手プロフィールが無効になっています。連携を確認してください");

  const { data: accountProfile, error: accountProfileError } = await supabase
    .from("profiles")
    .select("id,display_name")
    .eq("id", creatorAuthUserId)
    .maybeSingle();
  if (accountProfileError) throw accountProfileError;

  const playerProfileRow = playerProfile as PlayerProfileRow | null;
  const accountProfileRow = accountProfile as AccountProfileRow | null;
  const playerProfileId = playerProfileRow?.id ?? null;
  const profileId = playerProfileId ? null : accountProfileRow?.id ?? creatorAuthUserId;

  const { data: existingParticipants, error: existingError } = await supabase
    .from("event_participants")
    .select("id,profile_id,player_profile_id")
    .eq("event_id", eventId);
  if (existingError) throw existingError;

  const alreadyParticipant = (existingParticipants ?? []).some((participant: any) => (
    (playerProfileId && participant.player_profile_id === playerProfileId) ||
    (profileId && participant.profile_id === profileId)
  ));
  if (alreadyParticipant) return { insertedCount: 0 };

  const displayName =
    accountProfileRow?.display_name?.trim() ||
    playerProfileRow?.display_name?.trim() ||
    "名称未設定";

  const { error: insertError } = await supabase.from("event_participants").insert({
    event_id: eventId,
    profile_id: profileId,
    player_profile_id: playerProfileId,
    guest_name: displayName,
    status: "active",
    participant_type: "member"
  });
  if (insertError) throw insertError;

  return { insertedCount: 1 };
}

// 過去の試合の名前は在籍候補とは別に読む。退会者を新規候補へ戻さない。
export async function fetchHistoricalPlayerNames(supabase: SupabaseClient, profileIds: (string | null)[], context:{eventId:string;official?:boolean}) {
 const allowed=new Set(profileIds.filter(Boolean));
 const rows=context.official?await readOfficialNames(supabase,context.eventId):(await readEventNames(supabase,context.eventId)).filter(r=>r.kind==="player");
 return new Map(rows.filter(r=>allowed.has(r.id)).map(r=>[r.id,r.display_name]));
}

export function historicalPlayerName(profileId: string | null, guestName: string | null, names: ReadonlyMap<string, string>, currentName?: string | null) {
  return profileId ? names.get(profileId) || currentName || guestName || "名称未設定" : guestName || "未入力";
}
