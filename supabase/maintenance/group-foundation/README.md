# TASK-08-03 / P0：段階的な取得・権限分離

## 2026-11-19 更新：H13初期登録と並列2件の正規Auth HTTP結果

**H13をステージングのみ適用・検証。** [`22_h13_staging_owner_insert_apply.sql`](22_h13_staging_owner_insert_apply.sql)で、`clubs`/ `club_members`に必要な列だけのINSERTを許可し、本人owner・本人の連携済み選手・初回`main_admin`・既存所属なしをRLS/SECURITY DEFINER関数で制限。ownerクラブ行を`FOR UPDATE`してから重複を確認する。既存アプリの2段階グループ作成UIは変更なし。Stage Migration `task08_h13_staging_owner_bootstrap_insert`を適用し**履歴50件**。

[GitHub Actions #44498384116](https://github.com/g-ambe/Padel-match/actions/runs/44498384116)で、通常読み取り専用B0 **16判定PASS**に加え、専用の正規Auth/HTTP書き込み試験`23_h13_staging_http_write_smoke.mjs`で**10判定PASS**。本人グループ作成とmain管理者登録はHTTP201。誤role・他人の選手ID・重複・他actorの管理者登録は**仕様どおり拒否（PASS）**であり、予期しない不具合ではない。**並列2 POST**は1件201成功・1件403/42501、保存所属1件でPASS。高並列/他分離レベルまでを証明するものではない。

[24の安全な回収SQL](24_h13_stage_http_fixture_cleanup.sql)でテスト専用クラブ2件・所属2件だけを回収（残存0）。既存所属8件＋A/B fixture所属4件は維持。H13書き込み試験は**ワークフローから撤去済み**で、通常の読み取り専用B0へ復帰。本番SQL・Cloudflare・マージ・デプロイは未変更、PR #265 Draft継続。

**今後の結果の表記ルール：**「仕様どおり拒否・PASS」「想定外の拒否・FAIL」「想定外の許可・FAIL」「未確認」の区別を徹底し、可能な限りRLS/既存トリガーなどの根拠を示す。H13完了はP0全件完了を意味しない。次にH08本人最終承認/参照統合の隔離したROLLBACKテストを検討。詳細は[STAGING_HTTP_PLAN.md 0.10節](STAGING_HTTP_PLAN.md)を正とする。

## 2026-11-19 更新：旧申請RPC・連携詳細/一覧のステージング対策とH13候補

**ステージングのみの追加修正：** 旧`submit_profile_join_request`直接EXECUTEを拒否（新`submit_public_club_claim`は維持）、`get_player_profile_link_request`を管理者向け最小10項目に制限・受取人の`scoped_preview`/同意tokenは維持、`list_player_profile_link_requests`から不要な`target_auth_user_id`だけを除外（申請中表示に必要な`source_player_profile_id`は維持）。本番の既存関数/権限・アプリ機能は変更していない。

各対策は[14](14_legacy_join_submit_acl_rollback_probe.sql)→[15](15_legacy_join_submit_staging_apply.sql)、既存[06](06_staging_link_detail_candidate.sql)→[16](16_link_detail_staging_apply.sql)、[20](20_link_list_target_id_rollback_probe.sql)→[21](21_link_list_minimal_staging_apply.sql)を参照。実Auth/PostgREST HTTPは[run #44490847281](https://github.com/g-ambe/Padel-match/actions/runs/44490847281) **16 PASS**、[run #44492138197](https://github.com/g-ambe/Padel-match/actions/runs/44492138197) **19 PASS/1未解消観測**、最終[run #44494344175](https://github.com/g-ambe/Padel-match/actions/runs/44494344175) **21 PASS**。

HTTPに使ったテスト申請1件と通知1件は[17](17_link_detail_staging_http_fixture_setup.sql)と[18](18_link_detail_staging_http_fixture_cleanup.sql)によって識別し、**各試験後に回収済み**。パスワード・内部UUID・JWT/同意tokenの値は記録していない。現時点でステージングMigration **49件**、既存所属8件・fixture4件、検証用申請0件。

**H13は未適用：** `clubs`と`club_members`双方にauthenticatedのINSERT権限/ポリシーがない。[`19_h13_initial_owner_insert_rollback_candidate.sql`](19_h13_initial_owner_insert_rollback_candidate.sql)の最小列GRANT＋本人owner/main初期所属の正負例7判定はROLLBACKで成功。owner行のロックも加えたが、**別接続の同時実行や実JWTの作成/復旧が未検証**のため、正式ステージング適用を停止している。

今回の21判定はP0全体やH01〜H14全件の合格ではない。別の旧基底表SELECT/権限差・本人レビュー/統合・管理更新・共有/戦績/本番互換は未完了。本番DB/Cloudflare/マージ・デプロイなし。**PR #265 Draft維持**。詳細は[STAGING_HTTP_PLAN.md 0.9節](STAGING_HTTP_PLAN.md)へ。

## 2026-11-19 更新：H06/H03のステージング閉鎖・実JWT HTTP 15判定PASS

**ステージング専用のP0部分修正を実施。本番DB未変更、PR #265はDraft維持。** 既存検証用3Authアカウントと2グループを使用して、旧`preview_profile_join`（H06）と`public_player_profiles` View（H03）の公開経路を閉じた。

- H06：[`10_h06_legacy_preview_acl_candidate.sql`](10_h06_legacy_preview_acl_candidate.sql)でROLLBACK負例＋新限定公開プレビュー正例を検証し、[`11_h06_staging_apply.sql`](11_h06_staging_apply.sql)をステージングのみ確定適用。認証済みユーザーの**旧RPC直接EXECUTEのみをREVOKE**し、新`preview_public_club_claim`を内部経由で維持。
- H03：View自体や行/RLSを変更せず、[`12_h03_public_player_profiles_view_acl_candidate.sql`](12_h03_public_player_profiles_view_acl_candidate.sql)で匿名/認証利用者のSELECT拒否と新公開名簿の正常動作をROLLBACK検証。その後[`13_h03_staging_apply.sql`](13_h03_staging_apply.sql)で**ステージングのみView直接SELECTをREVOKE**。現行ブランチのapp/lib/components計136ファイルとDB関数群でこのView名の直接参照は見つからず、service_roleアクセスは維持。
- ステージングのSupabase Migration履歴は**46件**。既存8所属+fixture4所属を維持。H06の旧関数本体、H03のView定義、アプリのUIやデプロイ設定、既存`03`/`06`のROLLBACK候補は変更なし。
- 実Auth/JWT付きHTTP再試験：[run #44487713301](https://github.com/g-ambe/Padel-match/actions/runs/44487713301) は**15判定すべてPASS**。旧preview直接呼出し403、新限定preview200、匿名View401。H01/H02/H07/H11もPASS。これはH01〜H14全件でもP0完了でもない。
- 未完了：旧`submit_profile_join_request`等の認可経路、管理者詳細候補06の確定適用、他の旧表/列SELECTとRLS差、本番とステージングの相違、初期所属INSERT/管理UPDATE/本人同意・統合/共有・ランキング/実機の回帰。本番適用・マージ・デプロイは禁止。

詳細・停止条件：[STAGING_HTTP_PLAN.md 0.7/0.8節](STAGING_HTTP_PLAN.md)。過去の「H06/H03未解消」記録は作成当時の状態であり、**ステージング現状は本節を正とする**。

## 2026-11-19 更新：B0実HTTP検証をGitHub Actionsから実行可能にする準備

実Auth・PostgREST用の既存[`08_staging_auth_http_smoke.mjs`](08_staging_auth_http_smoke.mjs)をGitHub Actionsから**本番/マージ/デプロイを行わず**に実行するため、[`.github/workflows/task08-staging-b0-auth-http.yml`](../../../.github/workflows/task08-staging-b0-auth-http.yml)と非秘密の[`.task08-b0-trigger`](.task08-b0-trigger)を追加。

ワークフローは既存`codex/task-08-group-foundation`ブランチで**トリガーファイルが変更されたpushのみ**起動。現在`NOT_TRIGGERED`のままで**未実行**。Secretを設定するまでトリガーを変更しない。ユーザーはGitHub `Settings > Secrets and variables > Actions` に次の**テスト専用**4件を登録する（値をチャット・PR・Issueに送らない）。

`TASK08_STAGING_PUBLISHABLE_KEY`（ステージングの`sb_publishable_`形式に限定）、`TASK08_STAGING_MAIN_A_PASSWORD`、`TASK08_STAGING_RECIPIENT_PASSWORD`、`TASK08_STAGING_OUTSIDER_PASSWORD`。

登録後にトリガーのみ更新し、Actions結果の真偽/件数をIssueへ記録する。ジョブはSHA固定Action、GitHub token読取権限のみ、Secretsは準備チェックと本試験のステップにだけ供給する。スクリプトはアプリDBを読取のみ（正規Authサインイン履歴の更新はあり得る）、応答本文・パスワード・JWT・内部IDをログへ出さない。実HTTPのH01〜H14全件ではなくB0の一部観測。Actions利用分数が発生する点に注意。

匿名ViewのSQLロール負例は[`09_staging_view_invoker_rollback_probe.sql`](09_staging_view_invoker_rollback_probe.sql)をREAD/ROLLBACK試験済み：テスト表示名3件→`security_invoker=true`一時変更時42501拒否。ただし公開機能を壊す可能性があり、**Viewの永続変更は未実施**。詳しくは[`STAGING_HTTP_PLAN.md`](STAGING_HTTP_PLAN.md)0.5節へ。

## 2026-11-19 更新：候補06の実DB ROLLBACK検証とB0 HTTP実行器

ステージングの検証用A/B・Auth3名のfixtureに対し、既定ROLLBACKの`06_staging_link_detail_candidate.sql`を**同一トランザクションで一時的に有効化**し、旧連携RPCの管理者過剰返却の再現と候補DTOの限定、本人`review_token`の前後一致、無関係者拒否を実DBで確認。後続のREAD ONLY照合で旧関数MD5が元の値に戻り、申請レコードが0件であることを確認した。**候補06は正式適用していない**。

管理UPDATE RETURNINGはA管理者で成功し無関係者で0件、所属レコードの新規INSERTは現行ステージングで42501拒否。後者は本番との差分であり、権限を安易に緩めずにH13の検証前提として扱う。公開View`public.public_player_profiles`は合成の連携済み選手3名追加後に匿名SQLロールから3行可視となったため、HTTPでの公開影響調査が必要。

実Auth・PostgREST B0用の**書込みなしアプリデータ検証スクリプト**：[`08_staging_auth_http_smoke.mjs`](08_staging_auth_http_smoke.mjs)。既存の`@supabase/supabase-js`を使用し、**URLはステージング固定**。以下4つの環境変数を秘密管理された実行環境で用意する（値はチャット/GitHubに貼らない）。

`TASK08_STAGING_PUBLISHABLE_KEY`、`TASK08_STAGING_MAIN_A_PASSWORD`、`TASK08_STAGING_RECIPIENT_PASSWORD`、`TASK08_STAGING_OUTSIDER_PASSWORD`。

実行：`node supabase/maintenance/group-foundation/08_staging_auth_http_smoke.mjs`。必要値が欠ける場合は開始せず、認証/RESTレスポンス本文・個人ID・token/パスワードをログに出さない。**現時点では実Auth/HTTP試験未実施**で、スクリプトのNode実行検証も未実施。実施時の記録は[STAGING_HTTP_PLAN.md](STAGING_HTTP_PLAN.md)の0.4節へ。B0の観測をB1/B2やP0全体の合格と扱わず、PR Draftのまま本番マージ・デプロイ禁止。

## 2026-11-19 更新：scoped_preview維持のステージング専用候補

[`06_staging_link_detail_candidate.sql`](06_staging_link_detail_candidate.sql) を検証候補として追加。従来の`03_link_detail_candidate.sql`は変更せず、受取人のpreview取得だけをステージング固有の`profile_link_private.scoped_preview(source,user,club)`へ切替。旧関数の現物MD5/所有者、非公開helperの所有者/EXECUTEを事前検査し、**末尾ROLLBACK、ステージングDBにも未適用**とする。

[`07_staging_scoped_preview_preflight.sql`](07_staging_scoped_preview_preflight.sql)は、実ステージングへREAD ONLYで実行成功。既存の単一グループ所属の未連携プロフィール1件について、通常previewとscoped previewのトップレベル項目・`review_token`一致を、値を一切返さずに確認。**複数グループでの非漏えい、実Auth/HTTP、候補の修正確定は未検証**。元SQLと新候補の管理者限定DTO・ROLLBACK・ACL不変更の静的比較11項目もPASS。

既存のAuthユーザーはステージングに0件。管理連携にAuthユーザー作成操作はなく、`auth.users`直接INSERTは行わない。実Auth用の専用アカウントは承認された正規管理経路から別途準備する。P0の旧公開SELECT/旧RPC閉鎖や本番変更には進まない。

## 2026-11-19 更新：旧連携RPC・RLSの追加比較（READ ONLY）

新規 [`05_legacy_link_acl_semantics.sql`](05_legacy_link_acl_semantics.sql) は、両環境の旧連携関数とRLS/表・列権限の**メタデータだけ**をREAD ONLYで比較する。関数本文/RLS式/データ行は返さず、戻り値は関数ハッシュ・キーワード検出フラグ・ポリシー名/指紋等に限定。両実DBで同等SQLを実行成功（関数5件のハッシュは不一致、RLSも不一致）。詳細は [STAGING_HTTP_PLAN.md の0.1節](STAGING_HTTP_PLAN.md) を参照。

**重大な差分**：本番の旧`get_player_profile_link_request`は内部`preview`を呼ぶが、ステージングは独自の`scoped_preview`を呼ぶ。双方に`to_jsonb(request)`が残るため過剰返却の懸念はあるが、`03_link_detail_candidate.sql`をそのままステージングへ適用すると既存のpreview処理を置換する可能性がある。現状の修正候補は**既定ROLLBACKのまま、実環境への適用を停止**する。ステージングの初期所属INSERTポリシーも本番と一致しない。旧公開ACL/RLSを無差別にコピーしない。

この比較はSQL/メタデータ上の観測であり、実Auth/HTTP認可・既存動作の安全性証明ではない。本番SQL適用・マージ・デプロイは行わない。

## 2026-11-19 更新：既存ステージングへ0054/0055を適用

[STAGING_HTTP_PLAN.md](STAGING_HTTP_PLAN.md#0-2026-11-19chatgpt連携からの最新db照合ステージング追加migration適用後続更新) に最新の実測・適用結果を記録。GitHubでの最新ヘッドに含む0054/0055と同じ内容を、既存 `padel-hub-staging` **だけ**に追加適用した。履歴名は `task08_0054_group_read_interfaces_staging` / `task08_0055_group_read_consumer_support_staging`。本番DBは未適用。

既存ステージングの所属8件を保持し、非公開公開参照8件、用途別RPCのACL、匿名への非公開スキーマ拒否を読取で確認。実Auth/HTTPは未実施。旧連携関数・RLSの本番との差、旧公開SELECT、権限閉鎖、既定ROLLBACKの`03_link_detail_candidate.sql`、不足11表は未対応。**Draft・P0未完了を維持し、マージ・本番SQL・デプロイ禁止。**

以下の過去段階の「未適用」「接続不可」は、その作業時点での記録であり、最新のステージング状態は上記計画の追記を参照。

仕様：[#264](https://github.com/g-ambe/Padel-match/issues/264)、設計コメント6975098709、調査#229。
既存ブランチ `codex/task-08-group-foundation` / Draft PR #265を使用。PR #261は変更しない。

## 第3段階の状態

実Auth/HTTPに進むための[ステージング適用計画・架空データ構成・HTTP検証表](STAGING_HTTP_PLAN.md)を追加。
`04_http_preflight.sql`は関数本文をDB内でハッシュ化するREAD ONLYカタログ照合用。
今回の実DB再接続はできず、既存Issueの比較記録と最新確認済み事項を区別した。
計画・SQLは未適用で、ステージングMigration適用/Authユーザー作成もしていない。

[権限切替前の停止記録・依存棚卸し・適用/復旧手順案](STAGE3.md)を参照。
前回の最新監査Runは成功したが成果物取得が403、関数本文照合と実アカウントHTTP認可試験は未完了。
追加依頼により、実0039の旧RPC・GRANT・RLSを架空データで再現し、連携詳細RPCの本人用/管理者用DTOを
分ける修正案とアプリ側を追加した。`03_link_detail_candidate.sql`は既定ROLLBACKの隔離検証用で、
番号付きMigrationではない。旧公開SELECT/旧RPC全体の閉鎖は未実装で、0054/0055を変更せずDraftを維持する。

隔離検証のコマンド：

```sh
PADEL_GROUP_LINK_DETAIL_TEST=1 node tests/profile-linking-db.test.cjs
node --test tests/group-read-interfaces.test.cjs tests/group-read-client.test.cjs tests/player-profiles.test.cjs
node_modules/.bin/tsc --noEmit --incremental false
npm run cf:build
```

環境変数は**架空DBの既存連携テストへ修正案を適用するための試験用フラグ**であり、本番設定ではない。
新規8件は旧RPC/旧権限の再現と修正案の比較を含む。PostgREST・実Auth・本番定義との一致は未検証。
連携DB49件成功、最終SQL調整後のP0の8件再実行成功、関連3テストファイル・TypeScript・
最終アプリ差分のCloudflare互換ビルド成功。旧公開権限を閉じた後の認可試験は未実施。
Worker生成とNext/assets BUILD_ID一致も確認した。既存compatibility_date警告と、環境内のWranglerログ保存先
作成エラーは出たが、ビルド終了コードは0。Cloudflare上のプレビュー/実Auth検証や本番デプロイの成功を意味しない。

## 2026-11-19：通信制限解消、第1段階

環境の通信許可反映後、Run 44293556005のカタログartifactの取得が成功した。READ ONLY・列/表GRANT・RLS・関数所有者/search_path/ACL/定義ハッシュを確認。#229で報告された広いSELECTは残っている。関数本文はハッシュ化して保存しており、既存関数全文の完全一致照合を完了したという意味ではない。
監査結果・秘密値・生の接続エラーは公開ログ/リポジトリへ掲載しない。既存監査ツールのREAD ONLY/TLS verify-full/公式CA指紋/固定クライアントは維持する。

### Migration 0054（未適用）

`0054_group_read_interfaces.sql`は**追加のみ**。既存ポリシー/GRANT/関数・所属/プロフィール/イベントデータを変更しない。postgres実行を要求し、新関数はSECURITY DEFINER・空search_path・明示EXECUTE ACL。非公開schemaのhelperと公開名簿の参照変換表を追加する。参照表は元の所属IDと独立したランダムUUIDを使い、元IDの公開を避ける。既存の所属名コピー/編集/一括移行は行わない。

| RPC | 認可・返却範囲 |
| --- | --- |
| get_public_club_directory | ログイン＋有効な公開グループ。在籍者の最小表示名・未連携状態・独立参照のみ。役職/auth ID/プロフィールID等を返さない |
| get_club_roster | 同グループ在籍者、または既存スーパー管理者。管理者の退会行参照を維持。内部用の必要な所属・選手情報のみ |
| get_my_club_memberships | 本人の所属行のみ。退会行も状態付きで返す |
| get_event_club_candidates | 閲覧可能な指定イベントとその対象グループに限定した在籍選手ID/名前。相手側グループの役職やauth IDは返さない |
| get_event_player_names | 許可されたイベントに記録された選手/旧account名のみ |
| get_shared_event_player_names | 有効・終了済み・非削除イベントのトークン限定。通常/手動/チームを同じ入口で扱う |
| get_shared_official_player_names | 有効・終了済み・非削除の公式イベントに記録された選手名のみ |
| get_club_stats_player_names | 同グループ在籍者/既存スーパー管理者。退会者を含む当該グループの履歴名だけ返す。集計式は変更しない |

現行には連携済みメンバーの独立したグループ名保存先がない。本人プロフィール名を公開名へ自動コピーせず、新公開RPCでは未連携の仮選手名、連携済みは「メンバー」とする。所属別名の登録/編集や公開名初期化は別工程。新しい所属列も追加せず、既存連携同意の所属行snapshotを変えない。
独立参照から本人申請へ進む安全なAPI接続も今後の利用側移行に含む。参照を認証/本人同意の代替にはしない。

### 利用側

`lib/group-read.ts`に取得型とRPCラッパーを追加。失敗時に旧公開表へフォールバックしない。
通常/チーム戦・公式戦の共有画面の名前解決を新RPCへ移行。トークンが無効/停止中や取得失敗ならエラーとして扱い、他の選手名を補完して成功扱いにしない。

**これだけではP0は完了しない。** 旧表SELECTと旧連携RPCの公開経路はまだ残っており、情報流出の解消済みとは扱わない。Migration未適用の本番へこのアプリ変更を先行リリースしない。Draftのまま保持する。

## 検証

- `python -B -m unittest discover -s supabase/maintenance/group-foundation -p 'test_*.py' -v`：監査ツール5件成功（前段）。DB認可試験ではない。
- `node --test tests/group-read-interfaces.test.cjs tests/shared-event-client.test.cjs tests/shared-event-participants.test.cjs`：3ファイル成功。
- PGlite（隔離PostgreSQL）の追加Migration適用、新RPCの匿名/未所属/別グループ/退会者拒否、内部helper拒否、同所属/管理者取得、独立参照、共有トークン範囲/失効、退会者履歴名、関数所有者/search_pathを確認。
- TypeScript `tsc --noEmit --incremental false`：成功。
- `npm run cf:build`：成功。環境にBunがなく最初は起動失敗したため、指定版1.2.15を/tmpへ準備して再実行した。依存宣言/ロック/Cloudflare設定は変更していない。
- 未実施：実アカウント/HTTPでの認可試験、旧SELECT切替後の直接SELECT/埋込/既存RPC負例、全利用側の互換性試験、実機確認。本番への変更SQL・既存データ更新・マージ・デプロイは行っていない。

## 残る利用側移行と切替ゲート

1. グループ詳細/検索/作成、マイページ所属、管理操作、本人連携プレビューを新しい用途別取得へ移行。公開側で役職/連携ID/プロフィール名を取得しない。紐づけ申請は独立参照をサーバーで解決し、既存本人同意・通常管理者承認を維持。
2. 通常/手動/チーム/公式のイベント候補・出欠・名前解決、統計/管理者の既存依存を移行。本人用の直接取得と他人の取得を区別する。
3. 既存プロフィール/所属/クラブ/イベントのRLS相互参照を非再帰helperへ移行してから、表/列SELECT権限を段階的に限定。権限の一括削除を先行させない。
4. 旧経路を含む匿名/未所属/別グループ/退会者の負例と、同所属/管理者の正例、共有リンク・既存スコア/編成/統計/プロフィール統合の互換性を試験。新RPCの負例成功だけで旧公開経路まで安全とは宣言しない。
5. 本番カタログ/採番と関数定義を適用直前に再照合。本番適用・マージ・デプロイはユーザーの別指示があるまで行わない。

グループ3タブ刷新、表示名編集/一括移行、自主退会、R2画像API、メール招待、10文字ID、集計式/スコア処理は本差分に含めない。

## 2026-11-19：第2段階（取得先移行）

### Cloudflareログからの原因特定と修正

対象Build `0e1fab2f-438b-4701-ac2e-f2c44aad947d`は、Next.jsコンパイル/型/静的生成に成功した後、`wrangler preview`のcustom buildで失敗している。`ensure-cloudflare-worker.cjs`が`.next/BUILD_ID`だけで`--skipNextBuild`を指定した結果、通常のNext出力にはない`.next/standalone/.next/server/pages-manifest.json`をOpenNextが読みENOENTとなった。ローカルの`cf:build`成功とは異なる経路だった。

修正は同スクリプトのみ。Worker/assetsとNextのBUILD_IDが一致する場合だけ再利用し、不一致ならOpenNext自身の設定でNextビルドから行う。Worker IDチェックを緩めない。Worker名・Wrangler設定・環境変数・DB接続先は変更していない。
CloudflareログAPIは現在の接続で12006 Invalid token、GitHubチェックにエラー注釈はなく、原因はユーザー提供ログから特定した。修正後のCloudflare側プレビュー成功とは別に報告する。

### 移行した取得経路

- `readMemberGroups`（マイページ含む）、グループ検索、通常/チーム/公式の作成先と閲覧権限判定：本人所属RPC。
- グループ詳細・管理者の対象メンバー検証：内部名簿RPC。未所属者は最小公開名簿RPCで独立参照だけを受け取る。公開ユーザーによる戦績ロードを停止。
- 公開仮選手の本人申請：0055の独立参照解決→既存0039本人同意/申請処理。件数・本人の連携先名・review_tokenだけをDTOで返す。プロフィール詳細・所属名/役職・内部IDを返さない。通常の管理者承認は既存処理のまま。
- 通常/手動/チームの参加候補と履歴名：イベント限定RPC。チーム候補の所属ID取得も同じ限定DTOに統合。
- 公式戦：所属者用候補RPC＋公式イベント限定の履歴名RPC。
- グループ戦績・バランスペア評価の元所属履歴：退会行を含む専用RPC。名簿の「在籍者だけ」という条件を集計履歴へ流用しない。式や試合対象は変更しない。
- 加入申請者名、スーパー管理者の所属人数/アカウント名：限定DTO。管理権限はDBで再検証し、メール/アカウント全行を返さない。

0055は追加関数/ACLのみ。本番未適用。既存表のSELECT/UPDATE権限と既存関数は変更しない。0054の在籍判定は既存実装の`is_active`を正本とし、古いstatus値が残る復帰行を読取候補から黙って除外しない。statusや既存データの一括補正は行わない。既存の管理/連携操作RPCの判断はそのまま維持する。

### 残す直接アクセスとリスク

- `lib/player-profiles.ts`：本人のプロフィール取得/編集/本人プロフィールの利用件数。所有者の画面のために残す。メンバーの管理UPDATEも操作仕様変更を避け維持。
- `lib/profile-media/server.ts`：本人専用画像APIの所有者照合。今回広げない。
- `lib/event-participants.ts`：グループなし作成者の本人アカウント名照合。
- `lib/friendly-balance-history.ts`：現行評価への入口で本人の連携/所属だけを確認する直接取得。履歴メンバー全体はRPCへ移行済み。
- `app/groups/new/page.tsx`：初期所属INSERT。SELECT移行とは別の保存処理として維持。

これらは旧公開SELECTへのフォールバックではない。今回のRPC失敗はエラーとして扱い、旧表へ取り直さない。ただし**旧公開SELECTと旧連携プレビューRPCへの直接呼出し経路はまだ閉じていないため、P0全体の漏えい対策は未完了**。次段階で既存RLSの再帰・表/列GRANT・旧RPCを含めた切替負例試験が必要。

### 比較検証の範囲

所属/退会/旧ID/重複、管理者の退会・復帰・役職・未連携名保存、30パターンの旧コードとの戦績一致、共有名前/トークン、過去の退会者、バランスペア評価、本人同意/プロフィール統合の既存テストを再利用。RESTのGETから読取RPCのPOSTへ変わる箇所はテストfixtureも契約に合わせ、書込禁止・失敗検知・値一致の検証は維持する。
追加SQL試験は0054+0055を隔離PGliteへ適用し、公開/内部/管理者の正例・負例、独立参照と元所属ID混同の拒否、限定previewの内部情報非返却、旧申請処理への正しい引渡しを確認する。既存SQLへの本番変更・実データ書込み・本番リリースはしない。

第2段階の最終検証結果：関連9ファイル（SQL読取/公開参照/管理者DTO、所属、プロフィール管理、旧戦績との比較、本人連携DB、共有、バランスペア履歴、Workerビルド補助）のテスト成功。追加の退会済みイベント作成者の負例も再実行成功。TypeScript成功。`npm run build`→修正後のWorker補助処理というCloudflare相当順序でローカル生成成功。最終差分での`npm run cf:build`も成功し、Worker/assetsのBUILD_ID一致を確認した。
Cloudflare側の修正コミットのプレビュー結果、実ユーザーでのHTTP/画面操作、未適用Migrationを使う実環境の保存・取得は別途未検証。本番データを試験に使用していない。旧SELECT/旧RPCの切替後試験は次段階であり、本試験の成功をP0全体の完了扱いにしない。

大量行の互換性：読取RPCは安定したORDER BYと500行単位のページングを使う。1,201行が欠落しないことと途中ページの失敗を部分成功にしないことを追加確認した。関連の所属/管理/戦績/SQLテストも再実行して成功。旧公開表へ取り直すフォールバックはない。

Cloudflare側の確認：コミット1191e4bのステージングプレビューBuild `3b36b12b-64a4-41f9-9208-34d9b7dd464f` がGitHubチェックでCOMPLETED/SUCCESS。提供ログで特定したstandalone manifest不足は、実際のCloudflare環境でも修正後成功を確認した。以後のページング追加分は別コミットとしてローカルの関連試験/型/Cloudflare互換ビルドを実行済み。最新headのCloudflareチェックは別途区別して確認する。
