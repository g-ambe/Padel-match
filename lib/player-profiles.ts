import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export const PLAYER_PROFILE_COLUMNS = "id,linked_auth_user_id,display_name,bio,play_level,dominant_hand,preferred_position,activity_area,is_active,created_at";
export const PROFILE_DETAIL_FIELDS = ["bio", "play_level", "dominant_hand", "preferred_position", "activity_area"] as const;

export type PlayerProfile = {
  id: string;
  linked_auth_user_id: string | null;
  display_name: string;
  bio: string | null;
  play_level: string | null;
  dominant_hand: string | null;
  preferred_position: string | null;
  activity_area: string | null;
  is_active: boolean;
  created_at: string;
};

export type ProfileValues = Pick<PlayerProfile, "display_name" | typeof PROFILE_DETAIL_FIELDS[number]>;
export type ProfileUsage = { groups: string[]; memberships: number; participants: number; teamMatches: number; officialMatches: number; joinRequests: number };

export class PlayerProfileError extends Error {}

function fail(message: string, cause?: unknown): never {
  throw new PlayerProfileError(message, { cause });
}

export function profileErrorMessage(error: unknown) {
  return error instanceof PlayerProfileError ? error.message : "プロフィールの処理に失敗しました。時間をおいて再度お試しください";
}

// 複数件を正常な結果として扱い、取得失敗と0件を混同しない。
export async function readProfileRows<T>(query: (start: number, end: number) => PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await query(start, start + pageSize - 1);
    if (error || !Array.isArray(data)) fail("プロフィールと関連情報の取得に失敗しました。新規作成は行っていません", error);
    rows.push(...data as T[]);
    if (data.length < pageSize) return rows;
  }
}

export async function fetchLinkedPlayerProfiles(supabase: SupabaseClient, userId: string): Promise<PlayerProfile[]> {
  return readProfileRows<PlayerProfile>((start, end) => supabase.from("player_profiles")
    .select(PLAYER_PROFILE_COLUMNS).eq("linked_auth_user_id", userId).eq("is_active", true).order("id").range(start, end));
}

export function profileDetailCount(profile: PlayerProfile) {
  return PROFILE_DETAIL_FIELDS.filter((field) => profile[field]?.trim()).length;
}

export async function fetchProfileUsage(supabase: SupabaseClient, profiles: PlayerProfile[]): Promise<Map<string, ProfileUsage>> {
  const usage = new Map(profiles.map((profile) => [profile.id, { groups: [], memberships: 0, participants: 0, teamMatches: 0, officialMatches: 0, joinRequests: 0 } as ProfileUsage]));
  // URLが長くなりすぎないよう、参照列ごとに小分けに取得する。
  for (let offset = 0; offset < profiles.length; offset += 40) {
    const ids = profiles.slice(offset, offset + 40).map((profile) => profile.id);
    const [memberships, participants, requests, ...matches] = await Promise.all([
      readProfileRows<{ player_profile_id: string; is_active: boolean; clubs: { name: string; is_active: boolean } | null }>((start, end) => supabase.from("club_members").select("id,player_profile_id,is_active,clubs(name,is_active)").in("player_profile_id", ids).order("id").range(start, end)),
      readProfileRows<{ player_profile_id: string }>((start, end) => supabase.from("event_participants").select("id,player_profile_id").in("player_profile_id", ids).order("id").range(start, end)),
      readProfileRows<{ requester_player_profile_id: string }>((start, end) => supabase.from("join_requests").select("id,requester_player_profile_id").in("requester_player_profile_id", ids).order("id").range(start, end)),
      ...["team_a_player1_profile_id", "team_a_player2_profile_id", "team_b_player1_profile_id", "team_b_player2_profile_id"].map((column) =>
        readProfileRows<Record<string, string>>((start, end) => supabase.from("event_team_matches").select(`id,${column}`).in(column, ids).order("id").range(start, end))),
      ...["our_player1_profile_id", "our_player2_profile_id"].map((column) =>
        readProfileRows<Record<string, string>>((start, end) => supabase.from("official_matches").select(`id,${column}`).in(column, ids).order("id").range(start, end)))
    ]);
    for (const membership of memberships) {
      const entry = usage.get(membership.player_profile_id)!;
      entry.memberships += 1;
      if (membership.is_active && membership.clubs?.is_active !== false && membership.clubs?.name) entry.groups.push(membership.clubs.name);
    }
    for (const participant of participants) usage.get(participant.player_profile_id)!.participants += 1;
    for (const request of requests) usage.get(request.requester_player_profile_id)!.joinRequests += 1;
    const columns = ["team_a_player1_profile_id", "team_a_player2_profile_id", "team_b_player1_profile_id", "team_b_player2_profile_id", "our_player1_profile_id", "our_player2_profile_id"];
    matches.forEach((rows, index) => {
      for (const row of rows) usage.get(row[columns[index]])![index < 4 ? "teamMatches" : "officialMatches"] += 1;
    });
  }
  return usage;
}

// 既存の明示選択は表示用に尊重する。複数件を設定・日時・参照数で自動選択しない。
export function choosePlayerProfile(profiles: PlayerProfile[], _usage: Map<string, ProfileUsage>, preferredId?: string | null): PlayerProfile | null {
  const active = profiles.filter((profile) => profile.is_active);
  const preferred = active.find((profile) => profile.id === preferredId);
  if (preferred) return preferred;
  return active.length === 1 ? active[0] : null;
}

export function preferredPlayerProfileId(userId: string): string | null {
  try { return window.localStorage.getItem(`padel_player_profile:${userId}`); } catch { return null; }
}

export function rememberPlayerProfile(userId: string, profileId: string) {
  try { window.localStorage.setItem(`padel_player_profile:${userId}`, profileId); } catch { /* 保存不可でもプロフィール自体は変更しない。 */ }
}

export async function ensureAccountProfile(supabase: SupabaseClient, userId: string, displayName: string, email: string | null) {
  const { error } = await supabase.from("profiles").upsert(
    { id: userId, display_name: displayName.trim() || "名称未設定", email }, { onConflict: "id", ignoreDuplicates: true }
  );
  if (error) fail("認証は完了しましたが、アカウント情報の準備に失敗しました", error);
}

export async function resolveLinkedPlayerProfile(supabase: SupabaseClient, userId: string, preferredId?: string | null): Promise<PlayerProfile | null> {
  const profiles = await fetchLinkedPlayerProfiles(supabase, userId);
  if (preferredId && !profiles.some((profile) => profile.id === preferredId)) fail("選択した選手との連携が変わっています。プロフィール画面で選び直してください");
  if (!profiles.length) return null;
  if (profiles.length !== 1) fail("正規プロフィールを一意に特定できません。既存の連携と本人の選択を管理者に確認してください");
  return profiles[0];
}

// 登録・プロフィール作成など本人の明示操作でのみ呼ぶ。DB内の直列化と一意制約で再試行を保護する。
export async function ensureLinkedPlayerProfile(supabase: SupabaseClient, userId: string, displayName: string, preferredId?: string | null): Promise<PlayerProfile> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || auth.user?.id !== userId) fail("本人のログイン情報を確認できません", authError);
  const existing = await resolveLinkedPlayerProfile(supabase, userId, preferredId);
  if (existing) return existing;
  const { data, error } = await supabase.rpc("ensure_my_player_profile", {
    p_display_name: displayName.trim(), p_expected_profile_id: preferredId ?? null
  });
  const created = Array.isArray(data) ? data[0] : data;
  if (error || !created || created.linked_auth_user_id !== userId || !created.is_active) {
    fail("プロフィールの作成に失敗しました。既存データは上書きしていません。DBの適用状態を確認してください", error);
  }
  return created as PlayerProfile;
}

export async function saveLinkedPlayerProfile(supabase: SupabaseClient, userId: string, profileId: string, values: ProfileValues, expected: ProfileValues): Promise<PlayerProfile> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || auth.user?.id !== userId) fail("ログイン情報が変わりました。プロフィールを再読み込みしてください", authError);
  let query = supabase.from("player_profiles").update(values, { count: "exact" }).eq("id", profileId).eq("linked_auth_user_id", userId);
  // 編集開始後に別の画面で保存された値も、古いフォームで上書きしない。
  for (const field of Object.keys(values) as (keyof ProfileValues)[]) {
    query = expected[field] === null ? query.is(field, null) : query.eq(field, expected[field]);
  }
  const { data, error, count } = await query.select(PLAYER_PROFILE_COLUMNS);
  if (error) fail("プロフィールの更新に失敗しました", error);
  if (!data || data.length !== 1 || (count !== null && count !== 1) || data[0].id !== profileId || data[0].linked_auth_user_id !== userId) {
    fail("更新対象を確認できませんでした。別の画面で変更された可能性があります。プロフィールを再読み込みしてください");
  }
  const { data: saved, error: readError } = await supabase.from("player_profiles").select(PLAYER_PROFILE_COLUMNS)
    .eq("id", profileId).eq("linked_auth_user_id", userId).single();
  if (readError || !saved || saved.id !== profileId || saved.linked_auth_user_id !== userId) fail("保存後のプロフィールを確認できませんでした。再読み込みして確認してください", readError);
  if ((Object.keys(values) as (keyof ProfileValues)[]).some((field) => (saved[field] ?? "") !== (values[field] ?? ""))) {
    fail("保存後の内容が一致しません。再読み込みして確認してください");
  }
  return saved as PlayerProfile;
}
