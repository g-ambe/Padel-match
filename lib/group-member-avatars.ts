import { validAvatarPosition, type AvatarPosition } from "./profile-media/position";
import { IMAGE_LIMIT } from "./profile-media/shared";

export type GroupAvatar = { url: string; position: AvatarPosition };
type Entry = { listeners: Set<(image: GroupAvatar | null) => void>; controller: AbortController;
  status: "queued" | "loading" | "ready" | "failed"; image: GroupAvatar | null };

export async function fetchGroupAvatar(club: string, member: string, token: string, signal: AbortSignal) {
  const response = await fetch(`/api/groups/${encodeURIComponent(club)}/members/${encodeURIComponent(member)}/avatar`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", credentials: "omit", signal });
  const names = ["X-Avatar-Focus-X", "X-Avatar-Focus-Y", "X-Avatar-Zoom"];
  const raw = names.map(name => response.headers.get(name));
  const position = { x: Number(raw[0]), y: Number(raw[1]), zoom: Number(raw[2]) };
  if (!response.ok || response.headers.get("Content-Type")?.split(";")[0] !== "image/webp"
    || raw.some(value => value === null || value.trim() === "") || !validAvatarPosition(position)) throw new Error("画像を取得できません");
  const blob = await response.blob();
  if (!blob.size || blob.size > IMAGE_LIMIT) throw new Error("画像を取得できません");
  return { blob, position };
}

// One instance belongs to one visible member-tab visit, never a global/account cache.
export class GroupAvatarSession {
  private entries = new Map<string, Entry>();
  private running = 0;
  private closed = false;
  private load: (member: string, signal: AbortSignal) => Promise<{ blob: Blob; position: AvatarPosition }>;
  private urls: { create: (blob: Blob) => string; revoke: (url: string) => void };
  private concurrency: number;
  constructor(load: (member: string, signal: AbortSignal) => Promise<{ blob: Blob; position: AvatarPosition }>,
    urls = { create: (blob: Blob) => URL.createObjectURL(blob), revoke: (url: string) => URL.revokeObjectURL(url) },
    concurrency = 3) { this.load = load; this.urls = urls; this.concurrency = concurrency; }

  watch(member: string, listener: (image: GroupAvatar | null) => void) {
    if (this.closed) return () => {};
    let entry = this.entries.get(member);
    if (!entry) {
      entry = { listeners: new Set(), controller: new AbortController(), status: "queued", image: null };
      this.entries.set(member, entry);
    }
    entry.listeners.add(listener);
    listener(entry.image);
    this.pump();
    return () => {
      entry!.listeners.delete(listener);
      if (!entry!.listeners.size && ["queued", "loading"].includes(entry!.status)) {
        entry!.controller.abort(); this.entries.delete(member);
      }
    };
  }
  dispose() {
    this.closed = true;
    for (const entry of this.entries.values()) {
      entry.controller.abort();
      if (entry.image) this.urls.revoke(entry.image.url);
      for (const listener of entry.listeners) listener(null);
    }
    this.entries.clear();
  }
  private pump() {
    if (this.closed) return;
    for (const [member, entry] of this.entries) {
      if (this.running >= this.concurrency) break;
      if (entry.status !== "queued" || !entry.listeners.size) continue;
      entry.status = "loading"; this.running++;
      void this.load(member, entry.controller.signal).then(({ blob, position }) => {
        if (this.closed || entry.controller.signal.aborted || this.entries.get(member) !== entry) return;
        entry.image = { url: this.urls.create(blob), position }; entry.status = "ready";
        for (const listener of entry.listeners) listener(entry.image);
      }).catch(() => {
        if (this.entries.get(member) === entry) entry.status = "failed";
      }).finally(() => { this.running--; this.pump(); });
    }
  }
}
