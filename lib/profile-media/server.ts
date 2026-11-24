import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { emptyPrivateProfile, IMAGE_LIMIT, isUuid, type PrivateProfile } from "./shared";
import { MediaFailure, type Bucket, type Operation, type Rpc } from "./service";
export type MediaEnv = { PROFILE_IMAGES?: Bucket; PROFILE_MEDIA_COMMIT_SECRET?: string; PROFILE_MEDIA_RATE_LIMITER?: { limit(args: { key: string }): Promise<{ success: boolean }> } };
export async function authenticatedMediaClient(request: Request) {
  const token = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) throw new MediaFailure("ログインしてください", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new MediaFailure("接続設定を確認してください", 503);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new MediaFailure("ログイン情報を確認してください", 401);
  return { db, user: data.user };
}
export async function mediaContext(request: Request, profile: string, mutation = false) {
  let env: MediaEnv = {}, waitUntil: (p: Promise<unknown>) => void = () => {};
  try { const cf = await getCloudflareContext({ async: true }); env = cf.env as MediaEnv; waitUntil = p => cf.ctx.waitUntil(p); } catch { /* 設定のない通常Next開発では画像更新だけを閉じる。 */ }
  if (mutation) {
    if (!env.PROFILE_MEDIA_RATE_LIMITER) throw new MediaFailure("プロフィール画像APIは準備中です", 503);
    const limited = await env.PROFILE_MEDIA_RATE_LIMITER.limit({ key: `profile-media:${request.headers.get("cf-connecting-ip") ?? "unknown"}` });
    if (!limited.success) throw new MediaFailure("操作が続いています。時間をおいてください", 429);
  }
  const { db, user } = await authenticatedMediaClient(request);
  const rpc: Rpc = async <T>(name: string, args?: Record<string, unknown>) => {
    const result = await db.rpc(name, args);
    if (result.error) {
      const code = result.error.code;
      const status = code === "PT429" ? 429 : code === "42501" ? 403 : code === "40001" || code === "23505" ? 409 : code === "22023" ? 400 : 503;
      const messages: Record<number,string> = { 429: "操作回数の上限です。時間をおいてください",403:"本人の有効な正規プロフィールだけ変更できます",409:"別の操作と競合しました。再確認してください",400:"入力内容を確認してください",503:"変更結果を確認できませんでした。再確認してください" };
      throw new MediaFailure(messages[status], status, status === 503);
    }
    return result.data as T;
  };
  // 不正なID・本文も含め、認証アカウント全体の10分10回に計上する。
  const ticket = mutation ? await rpc<string | null>("profile_media_attempt") : null;
  if (mutation && !ticket) throw new MediaFailure("操作回数の上限です。10分ほどお待ちください", 429);
  if (!isUuid(profile)) throw new MediaFailure("プロフィールを確認してください", 400);
  const { data: owner, error: ownerError } = await db.from("player_profiles").select("id,linked_auth_user_id,is_active").eq("id", profile).eq("linked_auth_user_id", user.id).eq("is_active", true).maybeSingle();
  if (ownerError) throw new MediaFailure("プロフィールを取得できませんでした", 503);
  if (!owner) throw new MediaFailure("プロフィールを確認できません", 404);
  const read = async (operation?: string) => {
    const m = await db.from("player_profile_private").select("profile_id,owner_id,instagram_username,instagram_version,avatar_key,avatar_version,avatar_focus_x,avatar_focus_y,avatar_zoom,avatar_pose_version,home_court_name,home_court_version,home_facility_id,home_facility:padel_facilities!profile_home_facility_fkey(id,name,prefecture,aliases,availability,usage_note),updated_at").eq("profile_id", profile).maybeSingle();
    if (m.error) throw new MediaFailure("プロフィール拡張は準備中です", 503);
    let op: Operation | null = null;
    if (operation) {
      const result = await db.from("profile_media_operations").select("request_id,status,object_key,old_key").eq("request_id", operation).eq("profile_id", profile).eq("actor_id", user.id).maybeSingle();
      if (result.error) throw new MediaFailure("画像の操作状態を確認できませんでした", 503, true);
      op = result.data as Operation | null;
    }
    return { profile: (m.data as PrivateProfile | null) ?? emptyPrivateProfile(profile, user.id), operation: op };
  };
  return { env, rpc, read, ticket, waitUntil };
}
export function jsonResponse(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
export function mediaError(error: unknown) {
  return jsonResponse({ error: error instanceof MediaFailure ? error.message : "処理できませんでした。再確認してください", uncertain: error instanceof MediaFailure && error.uncertain }, error instanceof MediaFailure ? error.status : 503);
}
export async function limitedBody(request: Request) {
  const size = Number(request.headers.get("content-length"));
  if (size > IMAGE_LIMIT || !request.body) throw new MediaFailure("画像は200KB以下にしてください", 413);
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > IMAGE_LIMIT) { await reader.cancel(); throw new MediaFailure("画像は200KB以下にしてください", 413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let at=0; for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;} return result;
}
