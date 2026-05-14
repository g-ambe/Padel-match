import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function readPublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return { url, anonKey };
}

export function getSupabaseEnvErrorMessage(): string | null {
  const { url, anonKey } = readPublicEnv();
  if (!url && !anonKey) return "環境変数が未設定です（NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY）";
  if (!url) return "環境変数 NEXT_PUBLIC_SUPABASE_URL が未設定です";
  if (!anonKey) return "環境変数 NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です";
  return null;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (client) return client;

  const { url, anonKey } = readPublicEnv();
  if (!url || !anonKey) return null;

  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  return client;
}
