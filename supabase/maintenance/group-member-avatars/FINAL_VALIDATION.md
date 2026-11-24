# TASK-08-03 / #241：写真表示の最終限定検証（2026-11-24 JST）

> **2026-11-25 本番DB適用済み（最新）**：ユーザー承認により通信制限のあるCodexの固定採番方式からChatGPTのSupabase自動採番方式へ変更。実登録は `20261124230702_group_member_avatar_read` の1件（履歴26→27件）。正式Migrationは `supabase/migrations/20261124230702_group_member_avatar_read.sql` へ改名しSQL本体は02と同一（Git blob 38f9059ef05251312025db7f4b29b39f8ce6d38c、検証済みSHA256 c58d8b7de3e4540486f578b295a705609797a41c2dadd0708a6fbde6a93f4dc6）。既存RLS/ACL/関数4指紋不変、対象RPC定義・権限確認済み。旧番号20261124104619および旧手動適用パッケージは**本番適用禁止**。以下は以前の試験時点の記録で、現行の実行手順ではない。04 rendererは隔離試験での旧パッケージ再現専用、CLI出力停止。新規バックアップ省略はユーザー承認済み。PR #268 Draft・アプリ未配信、クラウドR2/実機受入未実施。詳細：[適用承認・実績](https://github.com/g-ambe/Padel-match/issues/264#issuecomment-7147041462)。

対象：既存Draft [PR #268](https://github.com/g-ambe/Padel-match/pull/268)、`codex/group-member-avatars`。
アプリの検証対象HEAD：`219000319ddbeddbd102810d4355ef9b486c111e`。
正本：[承認仕様](https://github.com/g-ambe/Padel-match/issues/264#issuecomment-7127560349)、[DB/API契約](https://github.com/g-ambe/Padel-match/issues/264#issuecomment-7127764270)、[ChatGPTレビュー](https://github.com/g-ambe/Padel-match/issues/264#issuecomment-7128561465)。

## 判定

- **SQL 02のCodexによる独立DB契約確認：PASS（下記範囲）**。原案の作成者はGPT。今回のCodex確認と、原案作成者による静的再点検を区別する。
- **実Auth・PostgREST・OpenNext Worker・ローカルR2バインディングの統合確認：PASS、17項目＋DB事後確認。** API応答やJWT検証をモックしていない。
- **クラウドR2・本番実画像・実機：未検証**。今回のR2はWranglerローカル実装であり、クラウドでの取得成功とは主張しない。
- **本番適用／マージ／配信：未実施・承認待ち。Draft維持。** 正式Migrationファイルと手動適用パッケージは用意したが、実行承認ではない。

## 1. 正式Migrationと独立DB契約確認

正式ファイル：`supabase/migrations/20261124104619_group_member_avatar_read.sql`。
SQL 02と**バイト単位で同一**、SHA256：

`c58d8b7de3e4540486f578b295a705609797a41c2dadd0708a6fbde6a93f4dc6`

01は原文記録として残すが適用しない。承認済みの正規表現1箇所修正以外、02とAPI契約を変更していない。

| 確認 | 結果と根拠 |
|---|---|
| 所有者・SECURITY DEFINER | PostgreSQL実カタログでpostgres所有、SECURITY DEFINER、STABLE、空search_pathを確認 |
| 呼出権限 | 実カタログでauthenticated EXECUTEあり、anon/service_roleなし。PUBLIC由来の継承を含めたhas_function_privilege検査 |
| 本人と信頼済みWorker | auth.uid()と既存proof関数を先に検証。閲覧者IDの入力なし。実JWTでproofなし・不正proofのRPC直呼びは42501、匿名も拒否 |
| 在籍境界 | 既存member helperを使用し、当該グループ在籍だけを許可。admin/superの非所属例外を追加しない。実HTTPで一般在籍者の成功と未所属・別グループ・退会/復帰・対象者除名/復帰を確認 |
| 対象画像 | 有効な連携プロフィール、private所有者一致、現在のactive object/profile_id一致、正しいキーprefix/UUID/WebPのみ。SQL 02の条件を静的照合。既存の未連携・所有者不一致等のPGlite成功証跡は再利用 |
| 行数と型 | PK/UNIQUE結合で最大1行。実PostgRESTの戻り値が配列1行、bigintの版がJavaScriptの安全な整数として扱えること、位置ヘッダが数値で反映されることを確認 |
| 既存構造の保全 | 手動パッケージ適用前後で既存の表ACL/RLS・policy・既存関数定義/ACLのカタログ値一致。新RPC以外は変化なし |

新たなCritical/HighのSQL契約指摘はなし。ただし今回の依存スキーマは合成の最小構成であり、**本番の全スキーマ/RLSを複製した試験ではない**。0048/0049、member helperはリポジトリの実SQLを使い、周辺Auth・施設・空履歴テーブル等をローカルfixtureで補った。本番の最新カタログとの一致確認は適用直前のゲートとして残す。

## 2. 実通信の17項目

`tests/integration/group-member-avatars-real.cjs`で、実際のローカルGoTrueが発行したJWTとPostgRESTを使用。Workerは既存のOpenNext成果物を`wrangler dev --local`で実行し、合成WebPを**既存本人用API**からローカルR2へ保存した。新規APIの応答を差し替えるモックはなし。

1. 合成4アカウントの実ログイン/JWT取得。
2. proofなし/不正proofの直接RPCと匿名の拒否。
3. 写真未登録の404。
4. 本人画像の初回アップロード。
5. 同一グループの一般在籍者・画像本人による画像バイト完全一致。
6. PostgRESTのbigint/位置版契約。
7. 未認証/不正JWT/未所属/別club-member組合せの拒否。
8. 既存本人画像GET成功、他人からの本人用GET拒否、従来のprivate max-age/ETag維持。
9. 本人用位置編集APIと、グループ画像応答への位置・ズーム反映。
10. 新APIがIf-None-Matchで304を返さず再認可すること。
11. 公開グループでも在籍者だけ成功し、未所属者は拒否。
12. 閲覧者の在籍解除後の404。
13. 閲覧者復帰後の取得成功。
14. 対象メンバーの在籍解除後の404。
15. 対象復帰後の取得成功。
16. 本人用画像差替えAPI、新画像バイト一致、旧本人画像版の拒否。
17. 本人用削除API、新API/旧本人画像URLの404。

独立したSQL事後確認：画像変更成功はupload2＋delete1の3件、閲覧者のmutation試行枠は0、本人画像参照は削除済み・版3。位置編集が画像変更成功枠を消費しないこともこの結果と整合。

### 試験中の失敗と切り分け

- Docker内Authヘルスプローブは403だった。CLIの`--ignore-health-check`による終了コードをPASSとは扱わず、ループバックのAuth `/health` HTTP 200、実signup/password login、JWT/PostgRESTの実処理を必須ゲートとして確認した。すべての公開ポートがloopbackであることをDocker inspectで確認。
- 最初の実HTTP試験は404応答のヘッダ検査で停止。Next.jsが`Cache-Control`を`private, no-cache, no-store, max-age=0, must-revalidate`に、Varyをルータ項目＋Authorizationへ正規化していた。JSONの業務404であることを直接確認した。テストは文字列の完全一致から**private/no-store必須・public/正のs-maxage禁止・Authorizationを含む・ETagなし**へ修正した。必要なキャッシュ境界は緩めていない。アプリの修正はなし。
- 試験用チェックポイント保存のPythonエラーも修正した。SQL・型・権限・原子性と既存ビルドの成功済み部分は再利用し、同じ隔離DBでローカル合成アカウントの資格情報だけを再準備してHTTP試験を完走した。失敗した試行をPASS扱いしない。

## 3. 実行基盤・証跡の区別

- 固定Supabase CLI 3.0.0を既存checksum検証手順で取得。Docker上の使い捨てproject `group-avatar-final`、合成4ユーザーのみ。Prod/Stageのschema・行・認証情報はコピーせず、ホストのDB URL/Cloudflare token等を子プロセスへ渡さない。
- `03_real_local_integration.py`が実SQL・公開/非公開の依存fixture・正式Migrationを組み立てる。`tests/fixtures/group-avatar-local-schema.sql`は**テスト専用**で、正式適用ファイルには含めない。
- 実Authキーを埋め込むためローカル用OpenNextを1回ビルド。後の試行では公開設定のハッシュ・アプリソース・BUILD_IDの一致を確認して成果物を再利用。375px UI試験、既存の6関連テストファイル、無関係な全件テストは再実行しない。
- 17項目成功後、Worker停止、専用DB/Auth/REST容器・volume・network、ローカルR2状態、合成資格情報と生ログを削除。初期化時の汎用名stackは自動承認が一度削除を拒否したが、今回のworkdirラベルと作成日時で所有を証明した後に削除。既存`padel_backup_restore`は変更しない。
- クラウドのバケット一覧はGETのみ。存在したのは本番用途の1バケットで、承認済みの隔離クラウドR2/Worker/Auth組合せは確保できなかった。新規バケット・Binding・有料環境を無理に作らず、**クラウドR2そのもののGETと実機画面は未検証**とする。

## 4. 正式適用手順（承認前・今回実行しない）

1. 対象PR/HEADとSQLハッシュを固定。最新main/他作業のMigration採番、実本番`padel-hub`の履歴、同名RPC未存在、member/proof関数の所有者・定義・権限、参照列/型・FKをREAD ONLYで照合する。不一致なら停止。既存のバックアップ/復元保護を維持し、本番の承認と停止/RPOを確認する。
2. `04_render_manual_release.py NEW_OUTPUT_FILE`で**オフライン生成だけ**を行う。本Migrationと履歴1行を同じtransactionに含め、履歴表ロック・version/name二重登録拒否を行う。生成パッケージSHA256：`4f9bafefeba050cb2319d75ec53a417b1c3e2a41706b8d5c9ce99d5811279976`。実行許可を与えるプログラムではない。
3. 承認された管理接続で生成パッケージを1本だけ適用。Migration本体と生成版を両方実行しない。`supabase db push`、過去Migration全量適用、履歴だけの追加/修正はしない。
4. version `20261124104619` / name `group_member_avatar_read` の履歴1行、RPC・所有者・search_path・EXECUTE、既存ACL/RLS不変をREAD ONLYで確認する。隔離試験では末尾障害注入時に新RPCと履歴が両方戻ること、正常時に同時登録されることを確認済み。
5. SQL適用確認後、別途承認された既存main自動配信経路でアプリを配信する。本番での代表画像取得は許可済み専用テスト対象だけで確認する。今回mainマージ・配信はしない。

停止/復旧：COMMIT前は同transactionのrollback。応答喪失時は別接続のREAD ONLYで履歴/RPCの確定状態を確認し、未適用と確認するまで再送しない。片側だけ存在する等の不整合は停止して調査。アプリ配信失敗時もRLS/ACLやR2公開設定を緩めない。新APIは未適用/不整合時に標準アイコンへ戻る。撤回が必要なら新APIの停止/未使用を確認し、別途承認された補償Migrationで新RPCのみDROPする。CASCADEや元履歴の削除、画像/他機能の変更はしない。

**残件**：最新本番カタログ/履歴と配信対象の事前照合、適用パッケージの最終承認、安全なクラウドR2/実機確認、本番SQL・マージ・配信の明示承認。これらが未完了の間はDraftを維持する。
