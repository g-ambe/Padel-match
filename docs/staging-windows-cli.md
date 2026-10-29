# Windows PCから既存の検証Workerへ直接デプロイする

対象は既存Worker `padel-match-staging` と `https://padel-match-staging.ranbo-ga.workers.dev` だけです。GitHub自動ビルド・TinyFish・新規APIトークンは使いません。`wrangler.jsonc` と本番Workerは変更しません。SQLも再適用しません。

Codexで作業開始時に確認したHEADは `763ba35` でした。Cloudflare認証情報とOAuth保存設定はなく、Cloudflare APIへの接続は実行環境のプロキシが403で拒否しました。Wranglerの端末用OAuth `login --device` は存在しますが、この通信制限下では完了できないため実行していません。新しいAPIトークン・Worker・Supabaseプロジェクトは作成していません。

## 前提

- WindowsにGit for WindowsとWSL2 Ubuntuがあり、Ubuntu側にNode.js 22または24・npmがあること。OpenNext 1.14.0自身がWindowsの完全互換性を保証せずWSLを推奨するため、ビルド・デプロイはUbuntu内に統一します。
- 通常のブラウザで、既存の検証WorkerがあるCloudflareアカウントと対象GitHubリポジトリへアクセスできること。課金プランを変更せず、無料枠内であることをCloudflareで確認してください。
- 検証Workerの実行時URL・anon keyは設定済みであること。公開キーは検証SupabaseのProject Settings → API Keysからコピーし、下の非表示入力へ貼ります。チャット・ファイル・コマンドの引数にキーを書きません。

不足する前提があれば、そこで停止してください。以下はCodex内で実デプロイを確認した結果ではなく、Windows PCで実行する手順です。

| Codexでの確認 | 結果 |
| --- | --- |
| リモートHEAD・既存ブランチ・Draft PR・検証設定 | 確認済み |
| Wrangler認証 | 未認証。`whoami --json` は `loggedIn: false` |
| Cloudflare API通信 | 環境プロキシがCONNECTを403で拒否 |
| 検証Supabaseの公開キー | 接続ツールで取得可。値は出力・保存していない |
| GET検証スクリプト | ローカルの架空HTTP応答9ケースPASS。実HTTP試験とは区別 |
| TypeScript | PASS |
| アップロードしないdry-run | 既存のダミーキー検証ビルドでPASS。実キーで再ビルドが必要 |
| 実アップロード・公開URL・実行時変数の保持 | 未実施／未確認 |
| AuthのSite URL・Redirect URLs、実JWT・ブラウザ試験 | 未実施／未確認 |

## 1. PowerShellでソースを取得してUbuntuを開く

次は新しい作業フォルダーを使います。同名フォルダーがあれば停止するので、既存作業を上書きしません。GitHubログインを求められたら、通常のブラウザでGit for Windowsの認証を完了します。

```powershell
$ErrorActionPreference = 'Stop'
$PadelSource = Join-Path $env:USERPROFILE "Padel-match-staging-cli"
if (Test-Path $PadelSource) { throw "同名フォルダーが存在します。既存作業を確認してください。" }
git clone --single-branch --branch codex/minimal-security-replacement https://github.com/g-ambe/Padel-match.git $PadelSource
if ($LASTEXITCODE -ne 0) { throw "GitHubからの取得に失敗しました。デプロイへ進まないでください。" }
wsl --list --verbose
wsl -d Ubuntu
```

## 2. UbuntuでOAuthログインとビルド

以下はPowerShellではなく、開いたUbuntuのBashへ貼ります。Windowsで取得したソースをLinux側へコピーします。新しいGitブランチは作成しません。

```bash
set -euo pipefail
PADEL_WIN_PROFILE="$(cmd.exe /c 'echo %USERPROFILE%' | tr -d '\r')"
PADEL_WIN_SOURCE="$(wslpath "$PADEL_WIN_PROFILE")/Padel-match-staging-cli"
PADEL_SOURCE="$HOME/Padel-match-staging-cli"
test ! -e "$PADEL_SOURCE" || { echo 'Linux側に同名フォルダーがあります。停止します。'; exit 1; }
cp -a "$PADEL_WIN_SOURCE" "$PADEL_SOURCE"
cd "$PADEL_SOURCE"
test "$(git branch --show-current)" = 'codex/minimal-security-replacement'
test -z "$(git status --porcelain)"
git log -1 --oneline
node --version
npm install --package-lock=false

# 既存のAPIキー／トークンを流用せず、公式OAuthを使う。
test -z "${CLOUDFLARE_API_TOKEN:-}${CLOUDFLARE_API_KEY:-}" || { echo '既存のCloudflare認証用環境変数があります。停止します。'; exit 1; }
export WRANGLER_LOG_SANITIZE=true
export WRANGLER_WRITE_LOGS=false
export WRANGLER_SEND_METRICS=false
npx --no-install wrangler login --help
npx --no-install wrangler deploy --help
npx --no-install wrangler deployments list --help
npx --no-install wrangler login --device --scopes account:read user:read workers:write workers_scripts:write
npx --no-install wrangler whoami

read -rp '検証Workerが存在するCloudflare Account ID: ' CLOUDFLARE_ACCOUNT_ID
export CLOUDFLARE_ACCOUNT_ID
[[ "$CLOUDFLARE_ACCOUNT_ID" =~ ^[a-fA-F0-9]{32}$ ]] || { echo 'Account IDの形式が違います。'; exit 1; }
export NEXT_PUBLIC_SUPABASE_URL='https://zzjwpresqkefnyjyisgd.supabase.co'
read -rsp '検証Supabaseの公開anon key（入力非表示）: ' NEXT_PUBLIC_SUPABASE_ANON_KEY
echo
export NEXT_PUBLIC_SUPABASE_ANON_KEY
node scripts/check-staging-build-env.cjs

# 既存Workerへのアクセス確認。失敗したら新規作成せず停止。
npx --no-install wrangler deployments list --config wrangler.staging.jsonc --name padel-match-staging --json >/dev/null

npm run cf:build:staging
npx --no-install tsc --noEmit --incremental false
node scripts/verify-staging-deployment.cjs --local
npx --no-install wrangler deploy --config wrangler.staging.jsonc --name padel-match-staging --keep-vars --dry-run --outdir /tmp/padel-match-staging-dryrun
```

OAuthの案内に従い、Windowsの通常ブラウザで認証します。コード・認証URL・資格情報をチャットへ貼る必要はありません。`--device` がhelpにない旧Wranglerなら、その場で止めてバージョンを報告してください。

キーの入力・確認・ビルド・dry-runのいずれかが失敗した場合は、次へ進みません。Workerの新規作成を提案された場合も停止します。`keep_vars: true` と `--keep-vars` で既存の実行時変数を保持します。設定ファイルに明記したURLだけは検証用の値を使います。標準の `npm run deploy` は実行しません。

## 3. 既存検証Workerへアップロードし、GETだけで確認

前の手順が成功した同じUbuntu端末で実行します。通常出力に公開キーの値が表示されないよう、アップロード時はログレベルをerrorにします。Wranglerの標準ログサニタイズは無効化せず、`WRANGLER_WRITE_LOGS=false` でデバッグログのファイル出力も停止します。

```bash
test "$(git branch --show-current)" = 'codex/minimal-security-replacement'
node scripts/check-staging-build-env.cjs
node scripts/verify-staging-deployment.cjs --local
npx --no-install wrangler deployments list --config wrangler.staging.jsonc --name padel-match-staging --json >/dev/null
WRANGLER_LOG=error npx --no-install wrangler deploy --config wrangler.staging.jsonc --name padel-match-staging --keep-vars
node scripts/verify-staging-deployment.cjs
unset NEXT_PUBLIC_SUPABASE_ANON_KEY
```

検証スクリプトは、生成JSに本番refがないこと、検証URLがHello WorldではなくNext.jsのHTMLを返すこと、接続先を含む配信JSと手元のビルドのハッシュ一致、検証Supabaseの公開Auth設定へのGETを確認します。キーやレスポンス本文は出力せず、アプリ・DBへの書き込みはしません。ブラウザの通信先・実ログイン・戦績のPASSを意味するものではありません。

成功後、Cloudflare画面で検証Workerの実行時URL・anon keyの保持を確認します。値のスクリーンショットやログは共有しません。Windows上での実デプロイは未実施なので、失敗時はキーを含めず、どのコマンドで止まったかとエラーの概要を報告してください。

## Workへの引き継ぎ文

```text
AGENTS.mdに従い、g-ambe/Padel-matchの既存ブランチcodex/minimal-security-replacementとDraft PR #160を使用してください。新しいブランチ・PR、mainマージ、本番変更は禁止です。
既存Worker padel-match-staging（https://padel-match-staging.ranbo-ga.workers.dev）へWrangler CLIでデプロイした結果を確認してください。GitHub自動ビルドは使いません。
検証Supabaseは https://zzjwpresqkefnyjyisgd.supabase.co で、0001〜0039とPR #160のSQLは適用済みです。再適用しないでください。
最初にChrome拡張の接続を確認し、公開JSと実際の通信先が検証Supabaseだけであることを確認してください。それまではユーザー作成・ログイン・保存を試しません。
確認後、検証用AuthのSite URL・Redirect URLs（/login?confirmed=true）を確認し、架空ユーザーで本人連携2経路・履歴引継ぎ・Round・スコア・共有・他グループ拒否・人物ID直接変更拒否を検証してください。
本番Worker padel-matchやそのVersion URLは書き込み試験に使いません。追加課金、プラン変更、秘密情報の出力は禁止です。実施・未実施を分けて日本語で報告し、PR #160はDraft・未マージで維持してください。
```
