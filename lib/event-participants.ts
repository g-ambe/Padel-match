import type { SupabaseClient } from "@supabase/supabase-js";

type ClubMemberRow = {
  player_profile_id?: string | null;
  profile_id?: string | null;
  status?: string | null;
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
};

function isMissingColumnError(error: any, column: string) {
  const message = `${error?.message ?? ""} ${error?.details ?? ""}`;
  return error?.code === "42703" || message.includes(column);
}

async function fetchActiveClubMemberRows(supabase: SupabaseClient, clubId: string) {
  const fetchRows = async (withStatus: boolean) => {
    let query: any = supabase
      .from("club_members")
      .select(withStatus ? "player_profile_id,profile_id,status" : "player_profile_id,profile_id")
      .eq("club_id", clubId)
      .eq("is_active", true);
    if (withStatus) query = query.eq("status", "active");
    return await query;
  };

  let { data, error } = await fetchRows(true);
  if (error && isMissingColumnError(error, "status")) {
    const fallback = await fetchRows(false);
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;

  return ((data ?? []) as ClubMemberRow[]).filter((member) => !member.status || member.status === "active");
}

async function fetchActivePlayerProfiles(supabase: SupabaseClient, ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return new Map<string, PlayerProfileRow>();

  const { data, error } = await supabase
    .from("player_profiles")
    .select("id,display_name,is_active")
    .in("id", uniqueIds);
  if (error) throw error;

  return new Map(
    ((data ?? []) as PlayerProfileRow[])
      .filter((profile) => profile.is_active !== false)
      .map((profile) => [profile.id, profile])
  );
}

export async function fetchActiveClubMemberParticipants(supabase: SupabaseClient, clubId: string): Promise<ActiveClubMemberParticipant[]> {
  const members = await fetchActiveClubMemberRows(supabase, clubId);
  const primaryProfileIds = members.map((member) => member.player_profile_id).filter(Boolean) as string[];
  const primaryProfiles = await fetchActivePlayerProfiles(supabase, primaryProfileIds);

  const participants: ActiveClubMemberParticipant[] = [];
  const addedIds = new Set<string>();

  for (const member of members) {
    const playerProfileId = member.player_profile_id;
    if (!playerProfileId) continue;
    const profile = primaryProfiles.get(playerProfileId);
    if (!profile || addedIds.has(playerProfileId)) continue;
    participants.push({ playerProfileId, displayName: profile.display_name ?? null });
    addedIds.add(playerProfileId);
  }

  const fallbackProfileIds = members
    .filter((member) => !member.player_profile_id && member.profile_id)
    .map((member) => member.profile_id as string);
  const fallbackProfiles = await fetchActivePlayerProfiles(supabase, fallbackProfileIds);

  for (const member of members) {
    if (member.player_profile_id || !member.profile_id) continue;
    const profile = fallbackProfiles.get(member.profile_id);
    if (!profile || addedIds.has(member.profile_id)) continue;
    participants.push({ playerProfileId: member.profile_id, displayName: profile.display_name ?? null });
    addedIds.add(member.profile_id);
  }

  return participants;
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

  const activeMembers = await fetchActiveClubMemberParticipants(supabase, clubId);
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
  const { data: playerProfile, error: playerProfileError } = await supabase
    .from("player_profiles")
    .select("id,display_name,is_active")
    .eq("linked_auth_user_id", creatorAuthUserId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (playerProfileError) throw playerProfileError;

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
