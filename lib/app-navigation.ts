export type AppSection = "matches" | "ranking" | "my";

export function appSection(path: string): AppSection | null {
  if (path === "/ranking") return "ranking";
  if (["/profile", "/groups", "/notifications", "/settings", "/help", "/about", "/super-admin"].some(base => path === base || path.startsWith(`${base}/`))) return "my";
  if (["/home", "/events", "/matches", "/team-matches", "/official-matches"].some(base => path === base || path.startsWith(`${base}/`))) return "matches";
  return null;
}

export const isGuestAppPath = (path: string) => path === "/home" || path === "/matches/new" || path === "/events/new" || path.startsWith("/events/guest_");
