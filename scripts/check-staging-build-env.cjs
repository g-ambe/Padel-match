// ビルド前専用。Workerには含めず、キー・トークンの値を出力しない。
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const expectedRef = "zzjwpresqkefnyjyisgd";
const expectedUrl = `https://${expectedRef}.supabase.co`;
const reject = () => {
  process.stderr.write("検証用Worker名・Supabase URL・公開キーを確認してください。本番用設定では実行できません。\n");
  process.exit(1);
};
try {
  const config = JSON.parse(readFileSync(join(__dirname, "../wrangler.staging.jsonc"), "utf8"));
  if (config.name !== "padel-match-staging" || config.vars?.NEXT_PUBLIC_SUPABASE_URL !== expectedUrl
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== expectedUrl) reject();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  // JWTは署名検証ではなく、誤ったプロジェクト・秘密鍵の混入防止のため形式を確認する。
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    const parts = key.split(".");
    if (parts.length !== 3) reject();
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (payload.role !== "anon" || payload.ref !== expectedRef) reject();
  }
} catch { reject(); }
process.stdout.write("検証専用Worker・ビルド接続先の事前確認: PASS\n");
