import { IMAGE_LIMIT, type PrivateProfile } from "./shared";
export type Rpc = <T>(name: string, args?: Record<string, unknown>) => Promise<T>;
export type Operation = { request_id: string; status: "pending" | "committed" | "aborted" | "unchanged"; object_key: string | null; old_key: string | null };
export type Bucket = {
  put(key: string, body: ArrayBuffer, options: { onlyIf: { etagDoesNotMatch: string }; httpMetadata: { contentType: string }; customMetadata: { sha256: string } }): Promise<{ key: string; size: number } | null>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  head(key: string): Promise<{ key: string; size: number; customMetadata?: Record<string,string> } | null>;
  delete(key: string): Promise<void>;
};
export class MediaFailure extends Error { status: number; uncertain: boolean; constructor(message: string, status = 500, uncertain = false) { super(message); this.status=status; this.uncertain=uncertain; } }
export async function collectGarbage(rpc: Rpc, bucket: Bucket, proof: string, priority?: string | null) {
  const keys = await rpc<string[]>("profile_media_gc_candidates", { p_proof: proof });
  for (const key of [...new Set([...(priority ? [priority] : []), ...keys])].slice(0, 3)) {
    if (!await rpc<boolean>("claim_profile_media_gc", { p_key: key, p_proof: proof })) continue;
    try { await bucket.delete(key); await rpc("finish_profile_media_gc", { p_key: key, p_proof: proof }); }
    catch { /* 削除確定を推測しない。5分後から同じキーを安全に再試行できる。 */ }
  }
}
export async function changeImage(args: {
  profile: string; request: string; version: number; kind: "upload" | "delete"; ticket: string;
  bytes?: Uint8Array; proof: string; bucket: Bucket; rpc: Rpc;
  read: () => Promise<{ profile: PrivateProfile; operation: Operation | null }>; onCommitted?: (oldKey: string | null) => void;
}) {
  const { profile, request, version, kind, ticket, rpc, bucket, proof } = args;
  const digest = args.bytes ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", args.bytes.slice().buffer as ArrayBuffer))).map(x=>x.toString(16).padStart(2,"0")).join("") : null;
  const prepared = await rpc<{ profile: PrivateProfile; operation: Operation }>("prepare_profile_image", { p_profile: profile, p_request: request, p_expected: version, p_kind: kind, p_ticket: ticket, p_content_hash: digest });
  const complete=(value:PrivateProfile)=>{try{args.onCommitted?.(prepared.operation.old_key);}catch{/* GCの予約失敗で確定済みの参照を取り消さない。 */}return value;};
  if (prepared.operation.status === "committed" || prepared.operation.status === "unchanged") return complete(prepared.profile);
  if (prepared.operation.status !== "pending") throw new MediaFailure("この操作は終了しています。画像を再選択してください", 409);
  try {
    if (kind === "upload") {
      if (!args.bytes || !args.bytes.length || args.bytes.length > IMAGE_LIMIT || !prepared.operation.object_key) throw new MediaFailure("画像を確認してください", 400);
      // リトライでも上書きしない。既存キーがあれば完了状態を問い合わせる。
      const key = prepared.operation.object_key;
      let stored = await bucket.put(key, args.bytes.slice().buffer as ArrayBuffer, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "image/webp" }, customMetadata: { sha256: digest! } });
      if (!stored) { const existing = await bucket.head(key); if (existing?.customMetadata?.sha256 === digest) stored = existing; }
      if (!stored || stored.key !== key || stored.size !== args.bytes.length) throw new MediaFailure("画像の保存結果を確認できませんでした", 502);
    }
    return complete(await rpc<PrivateProfile>("commit_profile_image", { p_profile: profile, p_request: request, p_proof: proof }));
  } catch (error) {
    // PUT/DBの応答喪失も含め、DBの実際の操作状態と参照で確定を確認する。
    let actual;
    try { actual = await args.read(); }
    catch { throw new MediaFailure("変更結果を確認できませんでした。再確認してください。画像は削除していません。", 503, true); }
    if (actual.operation?.status === "committed") return complete(actual.profile);
    try {
      const aborted = await rpc<boolean>("abort_profile_image", { p_profile: profile, p_request: request, p_proof: proof });
      if (!aborted) {
        const recheck = await args.read();
        if (recheck.operation?.status === "committed") return complete(recheck.profile);
        if (recheck.operation?.status !== "aborted") throw new Error();
      }
    } catch { throw new MediaFailure("変更結果を確認できませんでした。再確認してください。画像は削除していません。", 503, true); }
    throw new MediaFailure("画像を変更できませんでした。以前の画像はそのまま保存されています。", error instanceof MediaFailure ? error.status : 502);
  }
}
