// CLI用。アプリ／DBへの書き込みや認証情報の出力は行わない。
const { readFileSync, readdirSync } = require("node:fs");
const { join, relative, resolve } = require("node:path");
const { createHash } = require("node:crypto");

const root = resolve(__dirname, "..");
const assets = join(root, ".open-next/assets");
const worker = "https://padel-match-staging.ranbo-ga.workers.dev";
const supabase = "https://zzjwpresqkefnyjyisgd.supabase.co";
const productionRef = "ntczrmvffmpjzilfebyi";
const fail = message => { throw new Error(message); };
const digest = text => createHash("sha256").update(text).digest("hex");

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? javascriptFiles(path) : entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
  });
}

async function get(url, headers) {
  const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) fail("検証先のGETに失敗しました。HTTP状態: " + response.status);
  return response;
}

(async () => {
  const config = JSON.parse(readFileSync(join(root, "wrangler.staging.jsonc"), "utf8"));
  if (config.name !== "padel-match-staging" || config.keep_vars !== true || config.vars?.NEXT_PUBLIC_SUPABASE_URL !== supabase
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== supabase) fail("検証用設定・接続先を確認してください");
  const matching = [];
  for (const path of javascriptFiles(assets)) {
    const source = readFileSync(path, "utf8");
    if (source.includes(productionRef)) fail("生成JSに本番Supabase参照が含まれています。アップロードしないでください");
    if (source.includes(supabase)) matching.push({ path: relative(assets, path).split(require("node:path").sep).join("/"), hash: digest(source) });
  }
  if (!matching.length) fail("生成JSで検証用Supabase URLを確認できません");
  process.stdout.write("設定・生成JSの接続先: PASS\n");
  if (process.argv.includes("--local")) return;

  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) fail("検証用の公開キーが未設定です");
  const html = await (await get(worker + "/")).text();
  if (html.includes("Hello World") || html.includes(productionRef) || !html.includes("/_next/")) fail("検証URLでパデルアプリを確認できません");
  process.stdout.write("検証URLのアプリ表示用HTML: PASS\n");
  // 手元で検査したJSと、配信されているJSが同一であることを確認する。
  for (let offset = 0; offset < matching.length; offset += 4) {
    await Promise.all(matching.slice(offset, offset + 4).map(async file => {
      const body = await (await get(worker + "/" + file.path)).text();
      if (body.includes(productionRef) || digest(body) !== file.hash) fail("配信JSが手元の検証ビルドと一致しません");
    }));
  }
  process.stdout.write("配信JSと検証ビルドの一致: PASS\n");
  // 公開Auth設定のGETだけ。ユーザー作成・ログイン・SQL適用は行わない。
  const auth = await get(supabase + "/auth/v1/settings", { apikey: key });
  if (!auth.headers.get("content-type")?.includes("application/json")) fail("検証用Supabaseの応答を確認できません");
  process.stdout.write("検証用Supabase公開Auth設定GET: PASS\n");
  process.stdout.write("実ブラウザ通信・実ログイン・戦績試験: 未実施（Workで継続）\n");
})().catch(error => {
  const safe = ["検証用設定・接続先を確認してください", "生成JSに本番Supabase参照が含まれています。アップロードしないでください", "生成JSで検証用Supabase URLを確認できません", "検証用の公開キーが未設定です", "検証URLでパデルアプリを確認できません", "配信JSが手元の検証ビルドと一致しません", "検証用Supabaseの応答を確認できません"];
  const message = safe.includes(error.message) || /^検証先のGETに失敗しました。HTTP状態: \d{3}$/.test(error.message)
    ? error.message : "検証に失敗しました。ファイル・通信・接続先を確認してください";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
