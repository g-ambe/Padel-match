import type { FriendlyRoundMode } from "./friendly-rounds";

const key = (userId: string, eventId: string) => `padel_round_mode_v1:${userId}:${eventId}`;
const isMode = (value: unknown): value is FriendlyRoundMode => value === "normal" || value === "balance" || value === "rival";

// 同じタブ・同じユーザー・同じイベントだけに保持し、新しいイベントは従来の通常モードで開始する。
export function readRoundMode(userId: string, eventId: string): FriendlyRoundMode {
  if (!userId || !eventId || typeof window === "undefined") return "normal";
  try {
    const value = window.sessionStorage.getItem(key(userId, eventId));
    return isMode(value) ? value : "normal";
  } catch { return "normal"; }
}

export function rememberRoundMode(userId: string, eventId: string, mode: FriendlyRoundMode) {
  if (!userId || !eventId || !isMode(mode) || typeof window === "undefined") return;
  try { window.sessionStorage.setItem(key(userId, eventId), mode); } catch { /* 保存できなくても画面内の選択は維持する。 */ }
}
