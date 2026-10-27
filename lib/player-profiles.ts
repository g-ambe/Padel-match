import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { canManageTargetMember } from "./permissions";

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
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || auth.user?.id !== userId) fail("本人のログイン情報を確認できません", authError);
  return readProfileRows<PlayerProfile>((start, end) => supabase.rpc("get_my_player_profiles", {}, { get: true }).order("id").range(start, end));
}

// 旧所属のprofile_idはアカウントID。選手の主キーとの同値比較では結び付けない。
export async function fetchLegacyMemberProfiles(supabase: SupabaseClient, accountIds: (string | null)[]) {
  const ids = [...new Set(accountIds.filter((id): id is string => !!id))];
  const profiles = new Map<string, Pick<PlayerProfile, "id" | "display_name" | "linked_auth_user_id" | "is_active">>();
  for (let index = 0; index < ids.length; index += 40) {
    const rows = await readProfileRows<Pick<PlayerProfile, "id" | "display_name" | "linked_auth_user_id" | "is_active">>((start, end) => supabase.from("player_profiles")
      .select("id,display_name,linked_auth_user_id,is_active").in("linked_auth_user_id", ids.slice(index, index + 40)).eq("is_active", true).order("id").range(start, end));
    for (const row of rows) if (row.linked_auth_user_id) profiles.set(row.linked_auth_user_id, row);
  }
  return profiles;
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
  const expectedFields = Object.fromEntries((Object.keys(values) as (keyof ProfileValues)[]).map(field => [field, expected[field]]));
  const { data, error } = await supabase.rpc("save_my_player_profile", { p_id: profileId, p_values: values, p_expected: expectedFields });
  if (error) fail(error.code === "P0001" ? error.message : "プロフィールの更新に失敗しました", error);
  const updated = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!updated || updated.id !== profileId || updated.linked_auth_user_id !== userId) fail("更新対象を確認できませんでした。別の画面で変更された可能性があります");
  const { data: savedData, error: readError } = await supabase.rpc("get_my_player_profiles", {}, { get: true }).eq("id", profileId).single();
  const saved = savedData as PlayerProfile | null;
  if (readError || !saved || saved.id !== profileId || saved.linked_auth_user_id !== userId) fail("保存後のプロフィールを確認できませんでした。再読み込みして確認してください", readError);
  if ((Object.keys(values) as (keyof ProfileValues)[]).some((field) => (saved[field] ?? "") !== (values[field] ?? ""))) {
    fail("保存後の内容が一致しません。再読み込みして確認してください");
  }
  return saved as PlayerProfile;
}

export type ClubMemberSnapshot = {
  id: string; club_id: string; player_profile_id: string | null;
  role: "main_admin" | "sub_admin" | "member"; is_active: boolean;
};
type ManagedClubMember = ClubMemberSnapshot & {
  profile_id: string | null;
  player_profiles: { display_name: string; linked_auth_user_id: string | null; is_active: boolean } | { display_name: string; linked_auth_user_id: string | null; is_active: boolean }[] | null;
};

async function readManagedMember(supabase: SupabaseClient, expected: ClubMemberSnapshot) {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) fail("ログイン情報を確認できません", authError);
  const { data: admin, error: adminError } = await supabase.from("app_admins").select("id")
    .eq("profile_id", auth.user.id).eq("is_active", true).maybeSingle();
  if (adminError) fail("管理権限を確認できません", adminError);
  const rows = await readProfileRows<ManagedClubMember>((start, end) => supabase.from("club_members")
    .select("id,club_id,profile_id,player_profile_id,role,is_active,player_profiles(display_name,linked_auth_user_id,is_active)")
    .eq("club_id", expected.club_id).order("id").range(start, end))
    .catch(cause => fail("メンバーと管理権限の取得に失敗しました", cause instanceof Error ? cause.cause ?? cause : cause));
  const legacy = await fetchLegacyMemberProfiles(supabase, rows.filter(row => !row.player_profile_id).map(row => row.profile_id));
  const profileOf = (row: ManagedClubMember) => (Array.isArray(row.player_profiles) ? row.player_profiles[0] : row.player_profiles) ?? (row.profile_id ? legacy.get(row.profile_id) : null);
  const mine = rows.filter(row => row.is_active && (row.profile_id === auth.user!.id || (profileOf(row)?.is_active && profileOf(row)?.linked_auth_user_id === auth.user!.id)));
  const myRole = mine.some(row => row.role === "main_admin") ? "main_admin" : mine.some(row => row.role === "sub_admin") ? "sub_admin" : "member";
  const context = { isSuperUser: !!admin || auth.user.email?.toLowerCase() === "testuser01@example.com", myRole } as const;
  const member = rows.find(row => row.id === expected.id);
  if (!member || member.player_profile_id !== expected.player_profile_id || member.role !== expected.role || member.is_active !== expected.is_active) {
    fail("対象メンバーの所属・役職・状態が変更されています。再読み込みしてください");
  }
  if (!canManageTargetMember(context, member.role)) fail("このメンバーを操作する権限がありません");
  return { member, profile: profileOf(member), rows, context };
}

function checkMemberUpdate(data: unknown, error: PostgrestError | null, count: number | null, expected: ClubMemberSnapshot) {
  const rows = data as ClubMemberSnapshot[] | null;
  if (error) fail("所属の更新に失敗しました", error);
  if (!Array.isArray(rows) || rows.length !== 1 || (count !== null && count !== 1)
    || (["id","club_id","player_profile_id","role","is_active"] as const).some(key => rows[0][key] !== expected[key])) {
    fail("更新件数または対象を確認できません。メンバーを再読み込みしてください");
  }
  return rows[0];
}

export async function setClubMemberActive(supabase: SupabaseClient, expected: ClubMemberSnapshot, active: boolean) {
  const { member, profile, rows } = await readManagedMember(supabase, expected);
  if (active && (!profile || !profile.is_active)) fail("選手プロフィールを確認できないため復帰できません");
  if (!active && member.role === "main_admin" && rows.filter(row => row.is_active && row.role === "main_admin").length <= 1) fail("メイン管理者は最低1人必要です");
  const { data, error, count } = await supabase.from("club_members").update({ is_active: active }, { count: "exact" })
    .eq("id", member.id).eq("club_id", member.club_id).eq("role", member.role).eq("is_active", member.is_active)
    .filter("player_profile_id", member.player_profile_id === null ? "is" : "eq", member.player_profile_id)
    .select("id,club_id,player_profile_id,role,is_active");
  return checkMemberUpdate(data, error, count, { ...expected, is_active: active });
}

export async function saveUnlinkedClubMemberName(supabase: SupabaseClient, expected: ClubMemberSnapshot, name: string) {
  const { member, profile } = await readManagedMember(supabase, expected);
  if (!profile || !profile.is_active || profile.linked_auth_user_id !== null) fail("アカウント連携済みの選手名は、本人のプロフィール画面から変更できます");
  if (!name.trim()) fail("メンバー名を入力してください");
  const { data, error, count } = await supabase.from("player_profiles").update({ display_name: name.trim() }, { count: "exact" })
    .eq("id", member.player_profile_id).is("linked_auth_user_id", null).eq("is_active", true).eq("display_name", profile.display_name)
    .select("id,display_name,linked_auth_user_id");
  if (error || data?.length !== 1 || (count !== null && count !== 1) || data[0].id !== member.player_profile_id || data[0].display_name !== name.trim() || data[0].linked_auth_user_id !== null) {
    fail("選手名の更新を確認できません。連携状態や表示名を再読み込みしてください", error);
  }
}

export async function saveClubMemberRole(supabase: SupabaseClient, expected: ClubMemberSnapshot, role: ClubMemberSnapshot["role"]) {
  const { member, rows, context } = await readManagedMember(supabase, expected);
  if (!canManageTargetMember(context, role)) fail("この役職を設定する権限がありません");
  if (member.is_active && member.role === "main_admin" && role !== "main_admin" && rows.filter(row => row.is_active && row.role === "main_admin").length <= 1) fail("メイン管理者は最低1人必要です");
  const { data, error, count } = await supabase.from("club_members").update({ role }, { count: "exact" })
    .eq("id", member.id).eq("club_id", member.club_id).eq("role", member.role).eq("is_active", member.is_active)
    .filter("player_profile_id", member.player_profile_id === null ? "is" : "eq", member.player_profile_id)
    .select("id,club_id,player_profile_id,role,is_active");
  return checkMemberUpdate(data, error, count, { ...expected, role });
}
