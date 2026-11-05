export type MatchFormKind = "ordinary" | "friendly_team" | "official_team";
export type GroupSlot = "group" | "team_a" | "team_b";
export type MatchFormValues = Record<string, string | number>;
type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export type GroupCreationDraft = {
  version: 1; owner: string; token: string; kind: MatchFormKind; slot: GroupSlot;
  values: MatchFormValues; expiresAt: number; status: "pending" | "created" | "cancelled"; groupId: string | null;
};
const PREFIX = "padel_match_group_draft_v1:";
const GUEST_KEY = `${PREFIX}guest:ordinary`;
const TTL = 2 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const routes = { ordinary: "/events/new", friendly_team: "/team-matches/new", official_team: "/official-matches/new" } as const;
const fields = {
  ordinary: ["name", "eventMode", "selectedGroupId"],
  friendly_team: ["name", "description", "memo", "teamAMode", "teamBMode", "teamAClubId", "teamBClubId", "teamAName", "teamBName"],
  official_team: ["title", "eventDate", "description", "memo", "clubId"]
} as const;
const activeKey = (owner: string, kind: MatchFormKind) => `${PREFIX}active:${owner}:${kind}`;
const flowKey = (owner: string, token: string) => `${PREFIX}${owner}:${token}`;
export const matchFormReturnPath = (draft: GroupCreationDraft) => `${routes[draft.kind]}?groupReturn=${draft.token}`;

function valuesFor(kind: MatchFormKind, value: unknown): MatchFormValues | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>, result: MatchFormValues = {};
  for (const field of fields[kind]) {
    if (typeof raw[field] !== "string") return null;
    result[field] = raw[field];
  }
  if (kind === "ordinary") {
    if (!Number.isInteger(raw.courtCount) || Number(raw.courtCount) < 1 || Number(raw.courtCount) > 5 || !["auto", "manual"].includes(String(raw.eventMode))) return null;
    result.courtCount = Number(raw.courtCount);
  }
  if (kind === "friendly_team" && (!["group", "free"].includes(String(raw.teamAMode)) || !["group", "free"].includes(String(raw.teamBMode)))) return null;
  return result;
}

function write(store: DraftStore, key: string, value: unknown) {
  const json = JSON.stringify(value);
  if (json.length > 256 * 1024) throw new Error("入力内容が大きいため一時保存できません。入力画面に留まっています。");
  store.setItem(key, json);
  if (store.getItem(key) !== json) throw new Error("入力内容の一時保存を確認できませんでした");
}

export function cleanExpiredMatchDrafts(store: DraftStore, now = Date.now()) {
  const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter((key): key is string => !!key && key.startsWith(PREFIX) && !key.startsWith(`${PREFIX}active:`));
  for (const key of keys) {
    try {
      const value = JSON.parse(store.getItem(key) ?? "null");
      if (!value || typeof value.expiresAt !== "number" || value.expiresAt <= now) store.removeItem(key);
    } catch { store.removeItem(key); }
  }
  const pointers = Array.from({ length: store.length }, (_, index) => store.key(index)).filter((key): key is string => !!key && key.startsWith(`${PREFIX}active:`));
  for (const key of pointers) {
    try {
      const owner = key.slice(`${PREFIX}active:`.length).split(":")[0], token = JSON.parse(store.getItem(key) ?? "null");
      if (!UUID.test(owner) || typeof token !== "string" || !UUID.test(token) || !store.getItem(flowKey(owner, token))) store.removeItem(key);
    } catch { store.removeItem(key); }
  }
}

export function startGroupCreation(store: DraftStore, owner: string, kind: MatchFormKind, slot: GroupSlot, values: MatchFormValues): string {
  const safe = valuesFor(kind, values);
  if (!UUID.test(owner) || !safe || (kind === "friendly_team" ? !["team_a", "team_b"].includes(slot) : slot !== "group")) throw new Error("入力内容とログイン状態を確認してください");
  cleanExpiredMatchDrafts(store);
  discardMatchDraft(store, owner, kind);
  const token = crypto.randomUUID();
  const draft: GroupCreationDraft = { version: 1, owner, token, kind, slot, values: safe, expiresAt: Date.now() + TTL, status: "pending", groupId: null };
  write(store, flowKey(owner, token), draft);
  try { write(store, activeKey(owner, kind), token); }
  catch (cause) { store.removeItem(flowKey(owner, token)); throw cause; }
  return `/groups/new?fromMatch=${token}`;
}

export function readGroupCreation(store: DraftStore, owner: string, token: string, now = Date.now()): GroupCreationDraft | null {
  if (!UUID.test(owner) || !UUID.test(token)) return null;
  try {
    const value = JSON.parse(store.getItem(flowKey(owner, token)) ?? "null") as GroupCreationDraft | null;
    if (!value || value.version !== 1 || value.owner !== owner || value.token !== token || !Object.hasOwn(routes, value.kind)
      || (value.kind === "friendly_team" ? !["team_a", "team_b"].includes(value.slot) : value.slot !== "group")
      || !["pending", "created", "cancelled"].includes(value.status) || typeof value.expiresAt !== "number" || value.expiresAt <= now
      || (value.status === "created" && (!value.groupId || !UUID.test(value.groupId)))) return null;
    const values = valuesFor(value.kind, value.values);
    return values ? { ...value, values } : null;
  } catch { return null; }
}

export function finishGroupCreation(store: DraftStore, owner: string, token: string, groupId: string | null): string | null {
  const draft = readGroupCreation(store, owner, token);
  if (!draft || (groupId !== null && !UUID.test(groupId))) return null;
  if (draft.status === "pending") {
    draft.status = groupId ? "created" : "cancelled"; draft.groupId = groupId;
    write(store, flowKey(owner, token), draft);
  }
  return matchFormReturnPath(draft);
}

export function takeMatchDraft(store: DraftStore, owner: string, kind: MatchFormKind, queryToken: string | null): GroupCreationDraft | null {
  cleanExpiredMatchDrafts(store);
  let token = queryToken;
  if (!token) { try { token = JSON.parse(store.getItem(activeKey(owner, kind)) ?? "null"); } catch { token = null; } }
  if (!token || typeof token !== "string") return null;
  const draft = readGroupCreation(store, owner, token);
  if (!draft || draft.kind !== kind) return null;
  store.removeItem(flowKey(owner, token));
  if (store.getItem(activeKey(owner, kind)) === JSON.stringify(token)) store.removeItem(activeKey(owner, kind));
  return draft;
}

export function discardMatchDraft(store: DraftStore, owner: string, kind: MatchFormKind) {
  try {
    const token = JSON.parse(store.getItem(activeKey(owner, kind)) ?? "null");
    if (typeof token === "string" && UUID.test(token)) store.removeItem(flowKey(owner, token));
  } finally { store.removeItem(activeKey(owner, kind)); }
}

export function saveGuestCreationDraft(store: DraftStore, values: MatchFormValues) {
  const safe = valuesFor("ordinary", values);
  if (safe) write(store, GUEST_KEY, { values: safe, expiresAt: Date.now() + TTL });
}
export function readGuestCreationDraft(store: DraftStore): MatchFormValues | null {
  cleanExpiredMatchDrafts(store);
  try { return valuesFor("ordinary", JSON.parse(store.getItem(GUEST_KEY) ?? "null")?.values); } catch { return null; }
}
export function discardGuestCreationDraft(store: DraftStore) { store.removeItem(GUEST_KEY); }

const filterKey = (owner: string) => `padel_match_group_filter_v1:${owner}`;
export function readMatchGroupFilter(store: DraftStore, owner: string, available: readonly string[]) {
  try {
    const value = store.getItem(filterKey(owner));
    return value && (value === "all" || value === "none" || available.includes(value)) ? value : "all";
  } catch { return "all"; }
}
export function saveMatchGroupFilter(store: DraftStore, owner: string, value: string) {
  try { store.setItem(filterKey(owner), value); } catch { /* 一覧フィルターの保存失敗は画面操作を妨げない。 */ }
}
