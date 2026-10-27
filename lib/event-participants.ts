import type { SupabaseClient } from "@supabase/supabase-js";
import { preferredPlayerProfileId, resolveLinkedPlayerProfile } from "./player-profiles";

type PlayerProfileRow = { id: string; display_name?: string | null; is_active?: boolean | null };
type AccountProfileRow = { id: string; display_name?: string | null };
type ActiveClubMemberParticipant = { playerProfileId: string; displayName: string | null };

export async function fetchActiveClubMemberParticipants(supabase: SupabaseClient, clubId: string): Promise<ActiveClubMemberParticipant[]> {
  const { data, error } = await supabase.rpc("get_club_players", { p_club: clubId });
  if (error) throw error;
  return (data ?? []).map((row: { player_profile_id: string; display_name: string | null }) => ({ playerProfileId: row.player_profile_id, displayName: row.display_name }));
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
export async function fetchHistoricalPlayerNames(supabase: SupabaseClient, profileIds: (string | null)[]) {
  const ids = [...new Set(profileIds.filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  for (let index = 0; index < ids.length; index += 40) {
    const { data: rows, error } = await supabase.rpc("get_player_names", { p_ids: ids.slice(index, index + 40) }, { get: true });
    if (error) throw error;
    for (const row of rows ?? []) if (row.display_name?.trim()) names.set(row.id, row.display_name);
  }
  return names;
}

export function historicalPlayerName(profileId: string | null, guestName: string | null, names: ReadonlyMap<string, string>, currentName?: string | null) {
  return profileId ? names.get(profileId) || currentName || guestName || "名称未設定" : guestName || "未入力";
}
