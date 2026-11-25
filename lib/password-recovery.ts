import { createClient } from "@supabase/supabase-js";

// Redirects are constructed from an operator-configured origin, never a query parameter.
export function recoveryRedirect(origin: string): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_ORIGIN || "https://padel-match.ranbo-ga.workers.dev";
  try {
    const expected = new URL(configured);
    if (expected.origin !== configured || expected.username || expected.password || expected.pathname !== "/"
      || (expected.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && expected.hostname === "127.0.0.1" && expected.protocol === "http:"))
      || origin !== expected.origin) return null;
    return `${expected.origin}/auth/reset-password`;
  } catch { return null; }
}
export function takeRecoveryToken(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const all = params.getAll("token_hash");
  return all.length === 1 && /^(?:[a-f0-9]{56}|[a-f0-9]{64})$/i.test(all[0]) && [...params.keys()].every(k => k === "token_hash") ? all[0] : null;
}
export function createRecoveryClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "padel-password-recovery-memory" } });
}
export function recoveryPasswordError(code?: string) {
  return code === "same_password" ? "現在と同じパスワードは設定できません。別のパスワードを入力してください。"
    : "パスワードを変更できませんでした。条件を確認して再入力してください。";
}
