import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// A shared page reads only with its link token, independently of the viewer's login.
// Keep this client separate from the application's persistent authenticated client.
export function getSharedEventClient(token: string): SupabaseClient | null {
  if (typeof window === "undefined" || typeof token !== "string" || !/^[a-zA-Z0-9_-]+$/.test(token)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    global: { headers: { "x-padel-share-token": token } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "padel-shared-event"
    }
  });
}
