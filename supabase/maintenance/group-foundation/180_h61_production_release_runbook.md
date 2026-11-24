# H61 / TASK-08-03 本番適用パッケージ・作業手順（承認前）

対象: Issue #264 / 親 #215 / Draft PR #265 / codex/task-08-group-foundation。
2026-11-24 JST。**本書・生成SQL・CI SUCCESSは本番作業の承認ではない。** H62の最新バックアップ、独立レビュー、配信制御確認、ユーザーの明示承認が必須。

## 1. 正式適用候補の構成

`178_h61_release_package.py` はオフライン専用コンパイラ。検証済み6 SQLのGit blobを固定して、UTF-8の3本のSQLとSHA-256 manifestを新規ディレクトリに出力。生成処理はDB・Cloudflareへ接続しない。

```powershell
python supabase/maintenance/group-foundation/178_h61_release_package.py render task08-release-sql
```

| 順序 | version / name | 内容 |
|---|---|---|
| 1 | 20261124044001 / task08_prod_phase1_additive | 147 H41の6工程、追加RPC/共有取得・動画click/名簿・退会・最後の管理者保護。旧名簿匿名SELECTはここでは維持 |
| 2 | 20261124044002 / task08_prod_phase2_atomic | 145 H40の11工程、H51旧承認遮断、H52 media FK安全ガード。匿名club_members SELECTを別名列追加前に遮断。同一トランザクション |
| 3 | 20261124044003 / task08_prod_share_anon_close | 新Workerと正規共有リンク確認後のみ、H12の7表・H35の旧匿名click RPC遮断。認証済み権限維持 |

これは既存の番号が重複した履歴、Stage専用Migration、Prodで既に適用済みの手動SQLが混在するための**管理された手動適用パッケージ**。通常の `supabase/migrations` の過去ファイルを改名・削除・再適用しない。CLI `db push`、`db reset`、Stage履歴のコピー、`migration repair` での見せかけの一致は禁止。将来のCLI移行は別タスクとする。

各SQLはBEGIN/COMMIT 1組、履歴表をSHARE ROW EXCLUSIVEでロック、既存のversion/name 22件と追加済み順序を完全照合。DDL/DMLと当該履歴1件を同一トランザクションで確定。statementsには実行順のSQLセグメントを格納（自己参照する履歴INSERTと外側BEGIN/COMMITを除く）。登録のみを別途実行しない。Phase2の履歴INSERTはH51/H52の履歴preflightのため途中で実行するが、失敗時に全体ROLLBACKされる。

H52の隔離marker条件のみを実H51契約・匿名ACL・named内部呼出の検査へ置換。既存3FK形状・unknown FK fail-closed・source private/media拒否を維持。H12の合成token SELECTだけ除去し、実リンク確認は独立した実行ゲートとする。2099履歴、marker表、合成fixtureは生成SQLに含めない。元SQLはそのまま保管。

## 2. 読み取り専用確認（2026-11-24）

- Prod padel-hub: 履歴22件、version/nameはコンパイラBASELINEと同じ。履歴列はversion text PK、statements text[]、name text、created_by text、idempotency_key text UNIQUE、rollback text[]。後5列はnullable。現在postgres、Phase1/2未適用、last-main guard存在、匿名名簿SELECT有効、旧click anon EXECUTE3件有効、player_profilesへのFK17件。
- Worker padel-match: active #389 / version 051e062c-05ba-40a8-a015-690038832b52 / 2026-11-20 01:51 UTC、直前 #388 / 8455ee9b-fd5e-4f43-8503-4746764e1953。これは復帰候補の記録であり新DBとの旧アプリ互換を保証しない。
- Cloudflare builds worker trigger APIは成功・0件。以前のmain自動デプロイ記録と差がある。ダッシュボード上のGit連携/production branch、GitHub Actionsのmain起動・保護、実デプロイ担当と経路をH62で明示確認。main mergeは本番配信の可能性があるため承認前禁止。

## 3. H62/H63の実行順（現時点は未承認）

| 順 | 実施 | 通過条件 |
|---|---|---|
| 0 | 独立レビュー（Codex等） | 生成3本、元6 SQL差分、履歴・RLS/ACL/RPC、app contract、既存データ・復旧の限界。レビュー結果を#264に記録 |
| 1 | 対象・固定SHA・配信制御 | 最新main/PR/DB history/catalog、Worker version/自動配信、R2 binding。対象がProdと一致。ビルドを先行し配信可能性を確認。H61生成SHA256一致 |
| 2 | メンテナンス・バックアップ | 利用者へ短時間停止/編集停止を告知し、全件外部暗号化DBバックアップ＋独立復元成功、R2現ファイル別バックアップ/照合、認証/秘密値の維持を確認。バックアップ時刻とRPO、担当者、停止条件確定 |
| 3 | ユーザーの本番適用・配信承認 | 対象SQL/範囲、停止窓、データ喪失リスク、配信経路、復旧方針を明記して明示承認 |
| 4 | SQL1 | 固定SQLを1本のみ、postgres管理接続/SQL Editorで実行。エラー時停止。history 23件・追加RPC/ACLをREAD ONLY照合 |
| 5 | SQL2 | history 24件・H51/H52・匿名名簿遮断・名前同意境界を照合。失敗なら次へ進まない |
| 6 | 新Workerを直ちに配信 | 事前固定ビルドを承認済み経路で配信。実version/build/DBの組合せ・通常ログイン/グループ/連携/共有/スコア/画像の代表スモーク |
| 7 | SQL3 | 新Worker正規共有（通常/チーム/公式）・clickが実際に成功したことを確認後にのみ実行。history 25件・正規共有維持/旧匿名API拒否を照合 |
| 8 | 利用再開 | DB旧データ/履歴・Worker version・権限・UIの限定受入確認、ユーザー確認。対象Issueに証跡。未実装機能は別タスク |

H61はSQL適用リハーサルのみ。H63は本番の対象・秘密情報・実利用リンクをCI/Issueに出さず、専用テスト対象を使う。ユーザーはDB適用後に即新アプリを配信する方針を選択済み。旧/新の長期併用は対象外だが、旧タブや配信遅延時のセキュリティは維持する。

## 4. 失敗時の停止・復旧

- SQLのCOMMIT前: 同一トランザクションをROLLBACK。応答喪失時は結果不明として停止し、別接続READ ONLYでhistoryとカタログを確認。未適用と確定しない限り再実行しない。履歴とDDLが矛盾する場合は独立調査し、履歴だけ追加・削除しない。
- SQL1のみ確定: 旧Workerを維持し、追加SQLを強制DROPせず旧導線・データ/ACLを確認。停止のまま再計画。
- SQL2確定後: 新Worker配信を優先。配信失敗時は停止を維持し、検証済み新Workerの再配信・対象を限定した前進修正を独立検証。旧Worker単体の切戻しを安全とは扱わない。匿名club_members SELECT再付与、旧承認の復活、RLS無効化は禁止。
- SQL3失敗: 新WorkerとSQL2を維持、履歴/ACLを再検査して停止。共有のセキュリティを弱めて復旧しない。
- 過去の全DB復元はバックアップ以降の正常データを消す可能性があるため自動実行禁止。別DBで復元/差分確認、R2実ファイルと秘密値組合せ確認、ユーザーの明示承認。通常運用中の無損失切戻し保証なし。
- リリース完了はWorkerの実配信/実DB状態/受入を根拠に判定する。H47既存スコア例外5+1件を自動修復しない。メール招待・同グループ画像公開等の別タスクは未完了のまま。

## 5. H61検証

179 driverはH56の本番schema-only captureと合成Authを再利用し、**生成した3本そのもの**を隔離DBに適用。順序違い拒否、各SQL末尾への失敗注入と履歴/スキーマ/ACL不変、正常commit/同版再実行拒否、H56実SDK、H58実Worker共有をSQL3前後に検証。生成ファイルSHA256をログに記録し、データは記録しない。実業務行を使った移行保全はH54証跡（24表4430行）、H57–60は別の合成E2E証跡。H61実行結果は台帳へ追記する。独立レビュー・H62の最新バックアップ/R2保全/配信経路確認は引き続き必須。

## 6. H62-1/2 更新（2026-11-24、検証中）

- 独立レビュー181のC1について、ユーザーは過剰な権限制限を望まないため、今回の新alias公開同意・非公開名簿を迂回する `club_members` のSELECTポリシーだけ修正する。183 candidateを178 generatorのPhase2内（H51/H52後、COMMIT前）へ追加。既存group_read_private.member判定を使用、同グループ所属/本人過去所属/superを維持。既存の公開player_profiles、他表のRLS、書き込みACL、アプリは変更しない。Phase1/3はH61のバイト一致をテスト、旧Phase2ハッシュは履歴証跡のみで本番候補として使用しない。184の実Auth/REST・正規共有リハーサル結果と新Phase2 SHA256が確定するまで適用しない。H62の独立再レビューはこの限定差分のみ。
- **配信経路確認済み**：Cloudflare OpenAPI上 `external_script_id` はWorker名ではなくsystem-generated tag。従来の名前指定0件は誤った識別子によるもの。正しいWorker tag 721e16eab9964bb88725f379ad9eb542 で GET 成功、trigger 1件 `Deploy default branch`（c3ce5a69-770a-4e50-a46c-477d31fb824e、削除なし）、GitHub g-ambe/Padel-match、branch main、paths * / 除外なし、root /、build `npm run cf:build`、deploy `npx wrangler deploy`。build token設定存在、NEXT_PUBLIC_SUPABASE_URL/ANON_KEY存在、URLは本番projectに一致（値は記録しない）。現役389、ASSETS/PROFILE_IMAGES/PROFILE_MEDIA_COMMIT_SECRET/PROFILE_MEDIA_RATE_LIMITER存在。設定変更なし、実配信成功やtokenの書込権限は未実測。
- H63は承認・最新バックアップ/簡易R2保全・固定SHA確認後、SQL1→SQL2→既存PRのmainマージで自動配信→対象merge SHAのCloudflare build成功と実Worker version確認→新アプリ/共有の代表確認→SQL3の順。配信失敗時は新DBの安全な状態を維持し、同じ新コードのCloudflare再ビルド/再配信（必要なら承認済みWrangler経路）で前進修正。旧Worker単独復帰や権限緩和はしない。main mergeをSQLより先に行わない。
