import type { SupabaseClient } from "@supabase/supabase-js";

export type MatchKind = "ordinary" | "friendly_team" | "official_team" | "guest";
export type MatchTopEntry = {
  id: string; kind: MatchKind; title: string; status: string; createdAt: string;
  href: string; groupIds: string[]; groupLabel: string; formatLabel: string;
};
type Access = { uid: string; superUser: boolean; groups: { id: string; name: string }[] };
type EventRow = { id: string; name: string; status: string; created_at: string; club_id: string | null; created_by_auth_user_id: string | null; event_mode?: string; clubs?: { name: string } | null };
type SideRow = { event_id: string; side: string; club_id: string | null; team_name: string };
const PAGE_SIZE = 500;

// 開催中を最新20件の外へ落とさない。途中失敗は未登録と区別する。
async function readPages<T>(query: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const result = await query(start, start + PAGE_SIZE - 1);
    if (result.error) throw new Error("試合一覧を取得できませんでした。再読み込みしてください");
    if (!result.data) throw new Error("試合一覧の取得結果を確認できませんでした");
    rows.push(...result.data);
    if (result.data.length < PAGE_SIZE) return rows;
  }
}

export async function loadOrdinaryMatches(s: SupabaseClient, access: Access): Promise<MatchTopEntry[]> {
  const ids = access.groups.map(group => group.id);
  const rows = await readPages<EventRow>((start, end) => {
    let query = s.from("events").select("id,name,status,created_at,club_id,event_mode,created_by_auth_user_id,clubs(name)")
      .eq("is_deleted", false).in("event_mode", ["auto", "manual"]);
    if (!access.superUser) query = ids.length
      ? query.or(`club_id.in.(${ids.join(",")}),and(club_id.is.null,created_by_auth_user_id.eq.${access.uid})`)
      : query.is("club_id", null).eq("created_by_auth_user_id", access.uid);
    return query.order("created_at", { ascending: false }).order("id").range(start, end).returns<EventRow[]>();
  });
  return rows.map(row => ({ id: row.id, kind: "ordinary", title: row.name, status: row.status, createdAt: row.created_at,
    href: `/events/${row.id}`, groupIds: row.club_id ? [row.club_id] : [],
    groupLabel: row.clubs?.name ?? access.groups.find(group => group.id === row.club_id)?.name ?? (row.club_id ? "名称未設定" : "グループなし"),
    formatLabel: `フレンドリー・組み合わせ戦（${row.event_mode === "manual" ? "手動" : "自動"}）` }));
}

export async function loadFriendlyTeamMatches(s: SupabaseClient, access: Access): Promise<MatchTopEntry[]> {
  // 代表club_idで先に絞らず、既存一覧と同じA/B双方の所属を確認する。
  const rows = await readPages<EventRow>((start, end) => s.from("events")
    .select("id,name,status,created_at,club_id,created_by_auth_user_id").eq("event_mode", "team").eq("is_deleted", false)
    .order("created_at", { ascending: false }).order("id").range(start, end).returns<EventRow[]>());
  const sides: SideRow[] = [];
  for (let offset = 0; offset < rows.length; offset += 100) {
    sides.push(...await readPages<SideRow>((start, end) => s.from("event_team_sides")
      .select("event_id,side,club_id,team_name").in("event_id", rows.slice(offset, offset + 100).map(row => row.id))
      .order("id").range(start, end).returns<SideRow[]>()));
  }
  return rows.flatMap(row => {
    const eventSides = sides.filter(side => side.event_id === row.id);
    const groupIds = [...new Set(eventSides.map(side => side.club_id).filter((id): id is string => !!id))];
    if (!access.superUser && !(!row.club_id && row.created_by_auth_user_id === access.uid) && !groupIds.some(id => access.groups.some(group => group.id === id))) return [];
    const a = eventSides.find(side => side.side === "team_a")?.team_name || "チームA";
    const b = eventSides.find(side => side.side === "team_b")?.team_name || "チームB";
    return [{ id: row.id, kind: "friendly_team" as const, title: row.name, status: row.status, createdAt: row.created_at,
      href: `/team-matches/${row.id}`, groupIds, groupLabel: `${a} / ${b}`, formatLabel: "フレンドリー・チーム戦" }];
  });
}

export async function loadOfficialTeamMatches(s: SupabaseClient, access: Access): Promise<MatchTopEntry[]> {
  const ids = access.groups.map(group => group.id);
  const rows = await readPages<{ id: string; title: string; status: string; created_at: string; club_id: string | null }>((start, end) => {
    let query = s.from("official_events").select("id,title,status,created_at,club_id").eq("is_deleted", false);
    if (!access.superUser) query = ids.length
      ? query.or(`club_id.in.(${ids.join(",")}),and(club_id.is.null,created_by_auth_user_id.eq.${access.uid})`)
      : query.is("club_id", null).eq("created_by_auth_user_id", access.uid);
    return query.order("created_at", { ascending: false }).order("id").range(start, end);
  });
  return rows.map(row => ({ id: row.id, kind: "official_team", title: row.title, status: row.status, createdAt: row.created_at,
    href: `/official-matches/${row.id}`, groupIds: row.club_id ? [row.club_id] : [],
    groupLabel: access.groups.find(group => group.id === row.club_id)?.name ?? (row.club_id ? "名称未設定" : "グループなし"), formatLabel: "オフィシャル・チーム戦" }));
}

export function matchTopEntries(entries: readonly MatchTopEntry[], group: string, pastFilter: "all" | "friendly" | "official") {
  const unique = [...new Map(entries.map(entry => [`${entry.kind}:${entry.id}`, entry])).values()];
  const visible = unique.filter(entry => group === "all" || (group === "none" ? !entry.groupIds.length : entry.groupIds.includes(group)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return {
    active: visible.filter(entry => entry.status === "active"),
    past: visible.filter(entry => entry.status === "closed" && (pastFilter === "all" || (pastFilter === "official" ? entry.kind === "official_team" : entry.kind !== "official_team")))
  };
}
