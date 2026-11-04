# 一部ペア固定の手動適用・検証・復旧

PR #176の2026年11月4日版。Draftでレビューする。本番SQL・マージ・デプロイはユーザーの明示承認後に行う。Codexから自動実行しない。

## 適用順序

1. [実装・判断報告](../../../docs/event-fixed-pairs.md)、[連続生成結果](../../../docs/event-fixed-pairs-results.md)、[本番定義確認記録](preflight-review.md)を確認し、ユーザーがSQL適用を承認する。
2. 管理ロールのSQL Editorで [01_preflight.sql](01_preflight.sql) を再実行する。11月4日の確認では11表のRLS・49ポリシー・権限・12保護トリガー等を確認済みだが、適用直前に変更がないことを再照合する。`fixed_pair_private` が既に存在すれば0040を上書き適用しない。今回の0040は未適用を前提に改修している。適用済みなら現状を調査し、別途承認した差分移行を用意する。
3. [02_backup.sql](02_backup.sql) を手動実行し、非公開のバックアップ表・件数・captured日時を保持する。Freeプランの自動日次バックアップには依存しない。書込み停止を確保してから実行する。同名バックアップは上書きしない。同名が既にある場合は停止して、現在のバックアップを別名で取得し、検証SQLの参照先も同じ名前へ揃えてから進める。名前の日付を取得日時と誤認せずcapturedを確認する。実データをGitHubやチャットへ貼らない。
4. 下記のDB外論理バックアップを取得し、暗号化した一式を別保管先に保持する。ロール・スキーマ・行データ・認証データ・照合情報の不足がないことを確認する。
5. 別保管先の実ファイルを隔離環境へ復元し、エラー・件数・定義・権限・参照・動作を照合する。**この確認が完了するまで0040を適用しない。**
6. [0040_event_fixed_pairs.sql](../../migrations/0040_event_fixed_pairs.sql) を全体で手動適用する。3表・参照用インデックス・専用RPC・追加ガードを作る。既存行の一括更新や既存RLS・GRANTの置き換えはない。前提違い・タイムアウト・失敗は全体ROLLBACKし、続行しない。
7. [03_verify.sql](03_verify.sql) を手動実行する。既存定義差分0件、不整合4項目すべて0件、3表の直接書込み不可、専用RPCは認証限定、search_pathは空であることを確認する。適用直後の新3表は0件。既存のstats_mode・プロフィール・スコアは変化しない。
8. ユーザーがSQL適用結果を確認し、マージの条件を満たすことを確認する。既に得ている条件付きのマージ承認は引き継ぎ、未完了のDB作業をマージで代用しない。既存Cloudflare自動デプロイを利用し、手動で二重デプロイしない。SQLがCloudflareデプロイで適用されるとは扱わない。
9. 安全なテスト用アカウント・イベントで、5人の分割、6人1面3組、8人2面3組、9人2面、設定保存・別端末・終了未選択・記録用・通算・再開を確認する。本番の実試合に対する試験変更は禁止。リリース前のmain SHA／Worker版を記録し、重大エラー・切り戻し先を確認する。

0040の末尾はCOMMIT。本番でのリハーサルとして途中だけ実行しない。リハーサルは複製DBで行う。複製DBで末尾をROLLBACKに置き換えればDDL・前後ガードを確認できるが、別接続の同時実行試験はCOMMITした使い捨てDBで行う。

## Freeプランで必須となるDB外バックアップ

Freeプランでは自動日次バックアップを前提にしない。[02_backup.sql](02_backup.sql) のコピーは同じDB内にあり、DB・プロジェクト自体の喪失には対応できない。0040の適用条件を、**同一DB内のコピー＋DB外の論理バックアップ＋別保管先からの復元確認**の3点とする。ファイルができただけでは完了としない。

### 事前準備・接続・整合性

- 管理者の信頼できる端末にSupabase CLI、必要なDocker、PostgreSQLの`psql`を用意する。`supabase --version`、`supabase db dump --help`、`psql --version`と接続元のPostgreSQL版を記録する。復元先は互換のPostgreSQLメジャー版・拡張・Supabase管理スキーマを備えた、破棄可能な隔離環境を先に準備する。
- 接続元はDashboardのConnectで**既存の**Direct接続、IPv6不可ならSession poolerの5432番を確認する。Transaction poolerの6543番、REST URL、anon/service_role APIキーは使用しない。TLS設定を維持し、接続エラーをSSL検証無効化で回避しない。新規APIトークンの作成や認証設定変更は不要。
- 02実行前から外部dump・復元確認・0040・03の完了まで、開催操作・他端末・連携スクリプト等による書込みとDDL変更を運用上停止する。3回のdumpは別トランザクションのため、実行中に更新があれば同一時点の一式とは扱えない。停止を確保できない場合は、管理者が一貫したスナップショットによる別手順を用意するまで0040を延期する。
- リポジトリ外のアクセス制限・ディスク暗号化された保存先を使う。接続URL・パスワード・authデータ・dump・ログ・暗号鍵を、Gitの履歴・GitHubのファイル・PR添付・チャット・共有CIログへ出さない。`set -x`を使わない。URLは子プロセスの引数に現れることがあるため、共有端末では実行しない。

### Windowsを使わずGitHub Actionsで進める場合

Codexの現在の実行環境にはDB用TCPの利用許可がないため、GitHub Actionsのクラウドランナーを使用する。既存PR #176・既存ブランチで進め、バックアップのためにmainへマージしない。2026年11月4日の[接続確認](https://github.com/g-ambe/Padel-match/actions/runs/41800427302)で、修正後のURLによる**PostgreSQL 17・読み取り専用・TLS verify-full**の接続に成功した。

1. リポジトリの[Settings → Secrets and variables → Actions](https://github.com/g-ambe/Padel-match/settings/secrets/actions)に、Repository secretsを用意する。`PADEL_BACKUP_DB_URL`は確認済みのDB接続URL。**`PADEL_BACKUP_PASSPHRASE`** は別の暗号化用秘密値で、パスワードマネージャー等で生成した**ランダムな32文字以上**（異なる文字12種類以上、改行なし）とする。暗号鍵はバックアップと別の安全な保管先にも保存する。GitHub Secretsは後から値を読み戻せない。Codexの環境変数とは別設定。現在のGitHub連携はSecrets管理APIが403のため、Secretの登録だけは所有者がGitHub画面で行う。既存のアプリ用Secretは変更せず、値をGit・PR・チャットへ貼らない。
2. 接続だけ再確認する場合は、PR #176へ **`クラウドDB接続確認`** ラベルを付ける。実バックアップと復元確認は **`クラウドDBバックアップ検証`** ラベルで開始する。再試行はラベルを外して付け直す。権限を持つCodexからも操作できる。workflowがmainにない段階では`workflow_dispatch`を前提にしない。同一リポジトリ・対象PR・ブランチを限定し、フォークからは実行しない。
3. [cloud-db-backup.yml](../../../.github/workflows/cloud-db-backup.yml)は、暗号鍵・接続先の事前検査を行う。不足や弱い鍵では**本番の行データを取得する前に停止**する。CLI 3.0.0・PostgreSQL 17クライアント・公式CAを照合し、合成データでの回帰・同時更新・復元試験を通してから取得する。公式CAのSHA-256は`700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`。配布元は[Supabase Studioの公式設定](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json)に照合済み。変更時は自動更新せず再確認する。SSL・ホスト名検証を無効にしない。
4. 本番では読み取り専用のREPEATABLE READトランザクションからスナップショットをexportし、各dump・行照合へ同じスナップショットを指定する。通常DMLが並行しても取得時点を混在させない。取得中のDDL・ロール・権限変更は停止する。ロールは標準CLI、行はCOPY形式、スキーマは標準CLIと管理スキーマを含む依存順付き`schema.dump`の両方を保存する。authの認証行、旧修復用スキーマ、独自の権限関数・ACL・RLS・参照・マイグレーション履歴を含める。large object／外部表があれば別計画が必要として停止する。
5. 件数・全行の値のSHA-256・カタログ・ロール・取得日時と内部チェックサムを収録し、**GPG AES-256で暗号化したファイルだけ**をDB外に保管する。保管先はこのリポジトリの**未公開Draft Release**。公開リポジトリでもDraftは書込み権限者のみが参照でき、GitのコミットやPR添付には含めない。保管処理だけcontents:writeを使い、Releaseは必ず`draft: true`に固定する。**このDraftをPublishしない。** アプリのリリース・デプロイではない。Artifactの保存期限や一時ランナーのディスクを長期保管先とみなさず、バックアップの自動削除はしない。
6. **別の新規ジョブ**がDraft Releaseから実ファイルを取得し、外側SHA-256 → 復号 → 内側SHA-256を確認する。復元ジョブには本番DB URLを渡さない。空のSupabase互換DBを用意し、サービス停止・DBのDockerネットワーク切断を確認してから、コンテナ内Unix socketだけで復元する。ローカル初期化・`--clean`・トリガー抑制はこの使い捨てDBだけで行い、本番や既存DBを復元先に取る引数は用意しない。元のdumpは変更しない。
7. 全対象表の件数・値、列・FK・インデックス・RLS・表／列ACL・トリガー・スキーマ／関数・アプリロールを照合し、全FKの孤立参照がなくトリガーが通常状態であることを確認する。失敗時はバックアップを消さず、Draftの状態を「要確認」にする。成功した場合もDraftを公開しない。Actionsの結果と保管先・SHA-256・取得日時を非公開台帳へ記録する。バックアップには認証データが含まれるため、ダウンロード後も暗号鍵と分けて厳重管理する。

接続確認の成功はバックアップ完了ではない。合成データでの復元成功も、本番実ファイルの復元成功と区別する。クラウドジョブは02・0040・03を本番へ実行せず、マージ・Cloudflareデプロイも行わない。クラウドでの事前リハーサルを02より先に行った場合も、実際の適用時は上記の順序で書込み停止・02・新しい外部バックアップ・復元確認を揃える。運営再開後の古い復元点で代用しない。

このDB検証ではアプリを起動せず、実アカウントのログイン・メール送信・Storage実オブジェクトは試験しない。プロジェクト全体の復旧完了とは扱わない。下記の対象外情報も別に管理する。暗号鍵の紛失やGitHubアカウント自体の喪失に備え、所有者は必要に応じて暗号化済みファイルを別の管理ストレージにも複製し、保持期限・復旧担当者を決める。

### 取得例（管理端末のBash、手動実行）

使用するCLI版のhelpを確認する。下例は現行CLIの`--remote=URL`指定。v2など`--db-url`指定の版では、配列の定義だけをコメントの代替例へ変更する。ターゲットを省略してローカルDBやリンク済みの別プロジェクトをdumpしない。

```bash
set -euo pipefail
set +x
umask 077
read -r -p 'Gitリポジトリ外の保管ルート（絶対パス）: ' PADEL_BACKUP_ROOT
[[ "$PADEL_BACKUP_ROOT" = /* ]]
mkdir -p "$PADEL_BACKUP_ROOT"
if git -C "$PADEL_BACKUP_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo 'リポジトリ外の保存先を指定してください' >&2
  exit 1
fi
PADEL_BACKUP_DIR="$PADEL_BACKUP_ROOT/padel-pre0040-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$PADEL_BACKUP_DIR"
read -r -s -p '接続元のDB接続URL（画面非表示）: ' PADEL_SOURCE_DB_URL
printf '\n'
[[ "$PADEL_SOURCE_DB_URL" = postgresql://* || "$PADEL_SOURCE_DB_URL" = postgres://* ]]
PADEL_DUMP_TARGET=(--remote="$PADEL_SOURCE_DB_URL")
# --db-url対応版では上の定義の代わりに次を使う:
# PADEL_DUMP_TARGET=(--db-url "$PADEL_SOURCE_DB_URL")

supabase --version > "$PADEL_BACKUP_DIR/versions.txt"
psql --version >> "$PADEL_BACKUP_DIR/versions.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$PADEL_BACKUP_DIR/started-at.txt"
psql -X --set ON_ERROR_STOP=1 --dbname "$PADEL_SOURCE_DB_URL" \
  --tuples-only --no-align --command 'SHOW server_version;' \
  >> "$PADEL_BACKUP_DIR/versions.txt" 2> "$PADEL_BACKUP_DIR/source-version.log"

supabase db dump "${PADEL_DUMP_TARGET[@]}" --role-only \
  --file "$PADEL_BACKUP_DIR/roles.sql" > "$PADEL_BACKUP_DIR/roles.log" 2>&1
supabase db dump "${PADEL_DUMP_TARGET[@]}" \
  --file "$PADEL_BACKUP_DIR/schema.sql" > "$PADEL_BACKUP_DIR/schema.log" 2>&1
supabase db dump "${PADEL_DUMP_TARGET[@]}" --data-only --use-copy \
  --file "$PADEL_BACKUP_DIR/data.sql" > "$PADEL_BACKUP_DIR/data.log" 2>&1
```

`schema.sql`だけではデータもロールも保全できない。3コマンドすべての終了コード0、ログの接続先、ファイル内容・サイズを確認する。失敗・中断時の部分ファイルを成功扱いせず、新しい保存先で取り直す。`--schema public`だけに絞らず、アプリの独自スキーマ・関数・RLS・GRANT・制約も収録する。

CLIのスキーマdumpはauth/storage等の管理スキーマを除外する一方、対応版のdata-only dumpにはauth.users・auth.identities等のデータが含まれる。利用版の挙動と実ファイルで収録範囲を確認し、認証データや必要な表が欠けていれば補完・復元試験が完了するまで先へ進まない。auth/storageに独自のトリガーやポリシーがある場合は、そのDDLも別途非公開で保存・復元する。マイグレーション履歴を利用している場合は`supabase_migrations`も公式手順に従い別途保存する。

同じ書込み停止期間中に、次のSQLを`$PADEL_BACKUP_DIR/counts.sql`として保存し、接続元で実行する。これは主要表の照合例であり、使用している他のアプリ表・独自スキーマ表も台帳へ追加する。01の結果は`source-preflight.json`として同じ保存先へ保管する。

```sql
begin read only;
select 'auth.identities' as relation, count(*) as rows from auth.identities
union all select 'auth.users', count(*) from auth.users
union all select 'public.profiles', count(*) from public.profiles
union all select 'public.player_profiles', count(*) from public.player_profiles
union all select 'public.player_profiles(active)', count(*) from public.player_profiles where is_active
union all select 'public.clubs', count(*) from public.clubs
union all select 'public.club_members', count(*) from public.club_members
union all select 'public.events', count(*) from public.events
union all select 'public.event_participants', count(*) from public.event_participants
union all select 'public.rounds', count(*) from public.rounds
union all select 'public.matches', count(*) from public.matches
union all select 'public.match_players', count(*) from public.match_players
union all select 'public.match_results', count(*) from public.match_results
union all select 'public.join_requests', count(*) from public.join_requests
union all select 'public.player_profile_link_requests', count(*) from public.player_profile_link_requests
union all select 'public.player_profile_merges', count(*) from public.player_profile_merges
union all select 'storage.buckets', count(*) from storage.buckets
union all select 'storage.objects', count(*) from storage.objects
order by relation;
rollback;
```

```bash
psql -X --quiet --csv --set ON_ERROR_STOP=1 --dbname "$PADEL_SOURCE_DB_URL" \
  --file "$PADEL_BACKUP_DIR/counts.sql" \
  > "$PADEL_BACKUP_DIR/source-counts.csv" 2> "$PADEL_BACKUP_DIR/counts.log"
unset PADEL_SOURCE_DB_URL PADEL_DUMP_TARGET
for PADEL_BACKUP_FILE in roles.sql schema.sql data.sql counts.sql source-counts.csv source-preflight.json; do
  test -s "$PADEL_BACKUP_DIR/$PADEL_BACKUP_FILE"
done
(
  cd "$PADEL_BACKUP_DIR"
  shasum -a 256 roles.sql schema.sql data.sql counts.sql source-counts.csv source-preflight.json versions.txt started-at.txt > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
)
```

### 暗号化・DB外での保管

この時点でも復元可能性は未確認。全ファイル・ログを含む一式を暗号化する。例えば`age`を利用する端末では次のようにし、パスフレーズは保管ファイルと別の安全な管理先に保持する。

```bash
tar -C "$PADEL_BACKUP_DIR" -cf - . | age -p -o "$PADEL_BACKUP_DIR.tar.age"
(
  cd "$PADEL_BACKUP_ROOT"
  shasum -a 256 "$(basename "$PADEL_BACKUP_DIR").tar.age" > "$(basename "$PADEL_BACKUP_DIR").tar.age.sha256"
)
```

暗号化アーカイブと外側のチェックサムを、DB・プロジェクト・作業端末の喪失から独立した別媒体／別管理ストレージにも保管する。別フォルダだけで完了としない。日時・接続元プロジェクト識別子・CLI／DB版・対象範囲・サイズ・SHA-256・担当者・保存先・保持期限を非公開台帳へ記録する。生SQLとログも機密データとして扱い、平文の保管期間を制限する。削除や保持期限変更は管理者判断で行い、自動削除しない。

### 保管したファイルからの復元確認（本番には実行しない）

1. **別保管先から取得した実際の暗号化アーカイブ**を使う。外側のチェックサムを確認し、空の権限制限したリポジトリ外ディレクトリへ復号・展開する。展開後も`SHA256SUMS`を照合する。新しくdumpし直した別ファイルによる試験で代用しない。
2. 復元先はSupabase CLIのローカル環境等、auth/storage・予約ロール・必要拡張が初期化済みで、アプリ表は空の互換環境を使う。リポジトリの全Migrationを先に適用すると0040や既存表と衝突するため、空の別作業ディレクトリで準備する。外部メール・Webhook・ジョブの送信を防ぐ隔離状態にし、実データのコピーへのアクセスを管理者に限定する。
3. 接続元と復元先のホスト・プロジェクト識別子・ポート・DB名を照合し、**復元先が本番でないことを確認する**。URLの文字列が違うだけでは確認済みとしない。次の例は、展開先を`PADEL_RESTORE_FILES`、隔離先URLを`PADEL_RESTORE_DB_URL`として安全に入力した管理端末でのみ実行する。

```bash
set -euo pipefail
set +x
umask 077
read -r -p '復号・展開したファイルの絶対パス: ' PADEL_RESTORE_FILES
[[ "$PADEL_RESTORE_FILES" = /* && -d "$PADEL_RESTORE_FILES" ]]
read -r -s -p '確認済みの隔離復元先DB URL（画面非表示）: ' PADEL_RESTORE_DB_URL
printf '\n'
[[ "$PADEL_RESTORE_DB_URL" = postgresql://* || "$PADEL_RESTORE_DB_URL" = postgres://* ]]
(
  cd "$PADEL_RESTORE_FILES"
  shasum -a 256 -c SHA256SUMS
)
psql -X --single-transaction --set ON_ERROR_STOP=1 --dbname "$PADEL_RESTORE_DB_URL" \
  --file "$PADEL_RESTORE_FILES/roles.sql" \
  --command 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;' \
  --file "$PADEL_RESTORE_FILES/schema.sql" \
  --command 'SET LOCAL session_replication_role = replica;' \
  --file "$PADEL_RESTORE_FILES/data.sql" \
  --command 'SET LOCAL session_replication_role = origin;' \
  > "$PADEL_RESTORE_FILES/restore.log" 2>&1
psql -X --quiet --csv --set ON_ERROR_STOP=1 --dbname "$PADEL_RESTORE_DB_URL" \
  --file "$PADEL_RESTORE_FILES/counts.sql" \
  > "$PADEL_RESTORE_FILES/restored-counts.csv" 2> "$PADEL_RESTORE_FILES/restored-counts.log"
diff -u "$PADEL_RESTORE_FILES/source-counts.csv" "$PADEL_RESTORE_FILES/restored-counts.csv"
unset PADEL_RESTORE_DB_URL
```

4. 復元コマンドの終了コード0、エラーなし、件数一致を確認する。`SET LOCAL ... replica`は隔離先の取込み時だけトリガー・FK検査を抑制するため、件数一致だけで終えず、復元後にFKの孤立参照がないことを確認する。特にプロフィールと認証ID、所属、イベント参加者、試合出場者・結果の参照を照合する。通常接続では`session_replication_role=origin`、保護トリガー有効、RLS・列単位GRANTが元どおりであることを検査する。復元先のデフォルト権限によるanon/authenticatedへの意図しない全権限付与も見逃さない。
5. 隔離先で01を実行し、接続元の保存結果と定義・RLS・ACL・トリガー・制約・関数を比較する（取得日時・並び順・SQL空白は正規化する）。プロフィール設定値・所属役職・ID・過去スコア・試合日時・動画URLを確認し、安全なテスト用アカウントで閲覧・ログイン・権限拒否を確認する。必要な独自managed-schema DDLもここで照合する。
6. 失敗時は0040を適用しない。ログを機密扱いで保管し、原因を修正して空の隔離先で最初から再試験する。原本dumpは改変せず、互換性調整が必要なら別コピーと差分・理由を保持する。エラーを無視した継続、RLS・GRANT削除、既存DBへの`--clean`や全行上書きで通さない。
7. 成功日時・使用アーカイブのSHA-256・件数／定義／参照／動作の照合結果・担当者・ログ保管先を台帳へ記録する。**取得・別保管・実ファイルの復元確認がすべて成功するまで、0040は適用不可。** 試験中に接続元の更新を再開した場合は、適用時点に対応する一式を取り直し、確認もやり直す。

### 論理dumpだけでは復旧しない範囲

StorageのDB行は実ファイルを含まない。アップロード画像等を復旧対象にする場合は実オブジェクトを別途保存・読戻し確認する。API鍵・JWT／認証設定・OAuth／メール設定・外部サービス設定、Vault／pgsodium等の復号鍵、カスタムLOGINロールのパスワードもdumpだけでは復旧できないため、利用しているものは安全な別管理先と復旧手順を確認する。鍵や秘密値をPRへ記載しない。DB復元確認をSupabaseプロジェクト全体の復旧完了と誤認しない。

参考：[Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)、[CLIによるバックアップ／復元](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)、[db dumpリファレンス](https://supabase.com/docs/reference/cli/supabase-db-dump)。使用CLI版の挙動と公式案内を確認し、版・対象範囲を台帳へ残す。

## ローカル試験

`npm test` に組み込みPostgreSQLの実SQL試験を含む。利用者提供の11月4日本番カタログに対して、49ポリシー・ACL・トリガー・ヘルパー・制約・インデックス等の正規化SHA-256を比較する。行データ・接続情報はテストに含めず、すべて合成データを作る。

`pg` を解決できる環境と空のPostgreSQL 17を用意し、`FIXED_PAIR_PG_URL=<ローカル試験専用接続> node --test tests/event-fixed-pairs-db.test.cjs` で同じ試験と2接続の競合試験を実行できる。**既存DB・本番接続を指定しない。** ユーザー・表・ロールを作成するため、使い捨ての隔離DBに限定する。

9構成×全3モード×20Roundの実生成出力をRPCへ保存する。設定競合、同時生成、生成中の設定変更、同一要求再送、部分保存のROLLBACK、旧画面互換、バックアップ・検証・停止・再開SQLも試験する。純粋な生成器の288条件・14,400Roundは `FIXED_PAIR_REPORT=/tmp/fixed-pair-results.json node --test tests/fixed-pair-operations.test.cjs` で再実行できる。

## SQL適用後・旧画面・停止時の互換性

|状態|生成|終了・再開|スコア・動画・既存削除|
|---|---|---|---|
|SQLだけ適用、固定未設定・未使用の旧画面|既存経路を許可|既存経路を許可|既存権限のまま|
|固定設定あり・未使用の旧画面|直接生成を拒否し再読込が必要|使用前の従来終了は可能|既存権限のまま|
|利用済みの旧画面（全固定解除後も含む）|専用RPCが必要|専用RPCと明示選択が必要|既存権限のまま|
|新画面・正常時|固定0組も原子的RPCで保存|利用済みは専用RPC、未使用の終了は従来official|既存権限のまま|
|04でRPCを停止した新画面|グループ自動生成は固定0組も停止|専用RPCを要する操作は停止|既存権限のまま|

固定の片方が欠席している場合、新画面の生成器・RPCはその固定を一時停止して通常編成へ戻す。固定行が残る旧画面の直接生成は拒否する。旧画面で固定条件を迂回させる例外は追加しない。匿名・別グループ・退会済みの運営は元のRLSと新RPCで拒否される。

## 復旧手順

- DB外の復元点は取得時点の状態であり、Freeプランで継続的なPITRがあるとは扱わない。運営再開後は別途定期的な外部バックアップも運用する。
- 適用途中で失敗：同一トランザクションをROLLBACK。バックアップは保持し、マージしない。
- リリース後に問題：運営者に周知し、[04_disable_mutations.sql](04_disable_mutations.sql) で新しい設定・生成・終了RPCを停止する。設定・監査・利用済みの印・既存スコアを削除しない。
- 必要なら記録した正常なWorkerへ既存のCloudflare管理手順で戻し、マージコミットをRevertする。今回はまだマージしないので、対象SHA・Worker版は実際のリリース前に記録する。
- **旧Workerへの復帰だけでは固定設定／利用済みの開催の全操作は戻らない。** ガードを削除すると条件無視の生成やofficialへの誤反映が起きるため、ガードを維持して該当開催の生成・終了を一時停止する。固定なし・未使用の旧画面の基本操作は継続できる。
- 修正版、03の検証、ユーザー承認後に [05_resume_mutations.sql](05_resume_mutations.sql) で元の認証限定EXECUTEを戻す。定義チェックが失敗したら再開しない。0040全体を再実行しない。
- DB自体の喪失・破損時は、保管した暗号化アーカイブから**まず隔離先へ復元**し、上記照合をやり直す。障害後に取得できる現状・監査・新規試合も別途保全し、差分を比較する。本番への復旧先切替や個別修復は、バックアップ以降のデータを失わない計画を作り、別途ユーザー承認を得て実施する。
- 実データのTRUNCATE・バックアップでの全行置換・監査表DROP・used_fixed_pairsの消去は提供しない。必要な個別復旧は現在のID・参加者・スコア・監査とバックアップを比較し、ユーザー承認を得る。バックアップの保存期間・削除も別途承認する。
