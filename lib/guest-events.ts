"use client";

export type GuestParticipant = {
  id: string;
  guest_name: string;
  status: "active" | "resting" | "absent";
  participant_type: "guest";
};

export type GuestMatch = {
  id: string;
  court_number: number;
  round_number: number;
  created_at: string;
  completed: boolean;
  youtube_url: string | null;
  players: { participant_id: string; team: "A" | "B" }[];
  result: { score_a: number; score_b: number; winner_team: "A" | "B" } | null;
};

export type GuestEvent = {
  id: string;
  name: string;
  court_count: number;
  status: "active" | "closed";
  participants: GuestParticipant[];
  matches: GuestMatch[];
  created_at: string;
};

const KEY = "padel_guest_events_v1";
const MODE_KEY = "padel_guest_mode_v1";

const readAll = (): GuestEvent[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GuestEvent[]) : [];
  } catch {
    return [];
  }
};

const writeAll = (events: GuestEvent[]) => {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(KEY, JSON.stringify(events));
};

export const setGuestMode = (enabled: boolean) => {
  if (typeof window === "undefined") return;
  if (enabled) window.sessionStorage.setItem(MODE_KEY, "1");
  else window.sessionStorage.removeItem(MODE_KEY);
};

export const isGuestModeEnabled = () => typeof window !== "undefined" && window.sessionStorage.getItem(MODE_KEY) === "1";
export const listGuestEvents = () => readAll();
export const getGuestEvent = (id: string) => readAll().find((e) => e.id === id) ?? null;
export const upsertGuestEvent = (event: GuestEvent) => {
  const all = readAll();
  const idx = all.findIndex((e) => e.id === event.id);
  if (idx >= 0) all[idx] = event;
  else all.unshift(event);
  writeAll(all);
};

export const removeGuestEvent = (id: string) => {
  const all = readAll().filter((e) => e.id !== id);
  if (typeof window === "undefined") return;
  if (all.length === 0) {
    window.sessionStorage.removeItem(KEY);
    return;
  }
  writeAll(all);
};
