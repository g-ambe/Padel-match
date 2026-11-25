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

export function classifyRecoveryUpdateError(error: {code?:string; status?:number; name?:string}): "retry"|"expired"|"uncertain" {
  if (error.name === "AuthSessionMissingError" || ["session_not_found","session_expired","refresh_token_not_found","refresh_token_already_used","bad_jwt","user_not_found"].includes(error.code ?? "") || error.status === 401 || error.status === 403) return "expired";
  if (["same_password","weak_password","validation_failed"].includes(error.code ?? "") && typeof error.status === "number" && error.status >= 400 && error.status < 500) return "retry";
  return "uncertain";
}

export async function finishRecoverySignOut(recovery: { auth: Pick<import('@supabase/supabase-js').SupabaseClient['auth'], 'signOut'> }, shared: { auth: Pick<import('@supabase/supabase-js').SupabaseClient['auth'], 'getSession'|'signOut'> } | null, id: string): Promise<boolean> {
  let failed=false;
  try { const {error}=await recovery.auth.signOut({scope:"global"});if(error)failed=true; } catch { failed=true; }
  try { if(shared){const {data,error}=await shared.auth.getSession();if(error)failed=true;if(data.session?.user.id===id){const result=await shared.auth.signOut({scope:"local"});if(result.error)failed=true;}} } catch {failed=true;}
  return !failed;
}
