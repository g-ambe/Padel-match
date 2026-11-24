# H54 新アプリ × 新DB 実Auth/HTTP・画面受入計画（2026-11-24）

TASK-08 / #264 / Draft PR #265。台帳142 §22のユーザー方針が正。DB先行・直後に新アプリ配信。旧/新4組合せ完全互換、旧画面の継続利用、互換専用実装は対象外。切替中の認可・公開同意・データ保全、失敗時の安全停止は対象内。

## 1. 現時点の証跡と限界

- H52 #45306362432：27/27、H53 #45307148744：16/16。Prod相当DB構造＋24表4,430行の限定snapshotで SQL ROLE/claim模擬。実Auth発行JWT/HTTP/Workerではない。
- H54 #45308564260（tested HEAD 1cd17708fc17822f4ebc76013edb88779126462e）：170 driverでPhase2＋H51＋H52＋隔離用履歴を同一transactionに連結。COMMIT直前故障を注入しPhase1の契約・行・履歴が元に戻ること、正常COMMIT、二重適用拒否、H52/H53を再試験。結果はActions完了ログで判定。試験用履歴2099…とマーカーテーブルは正式Migrationへ持ち込まない。
- H54 #45308698957（tested HEAD def66b2b258077f6acfda649905e6d6785682aae）：既存16 test files、TypeScript、OpenNext WorkerとBUILD_ID照合。ダミーlocalhost環境のみ、実Auth/DB/WorkerのHTTPは未実施。結果はActions完了ログで判定。
- Stageの既存08 B0、100/102、116、122、128の実Auth/HTTP/Chromiumは部分的な先行証跡。81/84のH18は一時fixtureが必要で、正常承認COMMITは未実施。StageにはProdの0048関連3表がない。今回のStage再実行・DDL/DML・fixture作成はしない。古いStageのPASSを本番相当と扱わない。

## 2. 次の検証環境：合成データ専用ローカルSupabase

1. 実データのネットワーク切断LocalRestoreはこれまでどおり維持する。HTTPのためにネットワーク接続・公開ポート追加を絶対にしない。新しい独立の合成データ専用DB/サービスを無料runnerまたはローカルPC内で構築する。
2. 既存の検証済みCLI/コンテナ版を確認し、ローカルSupabase Auth + PostgREST + gatewayを固定バージョンで準備。実データ・Prod/StageのURL/鍵/secret/passwordは渡さない。loopback/private networkのみ、外部向け公開なし。ローカルのAuthはローカル発行の鍵・パスワードのみ。schema-only取得を利用する場合は業務行や秘密値を含めず、schema dumpの定義と権限をレビューし、管理サービスのauth/storage等の互換性を先に確認。サービス管理schemaを無条件に上書きしない。Prodと差がある部分は差分を列挙し、未検証として残す。
3. 本番相当のapp schema（0048画像/固定ペア/試合/戦績含む）を再構築し、Phase1/Phase2＋H51/H52の正式候補を適用。schema/関数/ACL/RLS/FKの比較を先にPASSさせる。2099履歴・H51試験マーカーを用いる場合は隔離専用として明示。Supabase CLIでの全履歴db pushやStageへの追随適用はしない。
4. 既存167/169 SQL・79/80 H18 fixture・73/74 H17 fixture・129/130共有fixtureから必要最小限の合成グループ、選手、イベントとスコア、画像メタデータを作成。本人・管理者・第三者・匿名の実ローカルAuthセッションを分離。管理者SQLはfixture準備/事後照合に限定し、通常操作のHTTPはpublishable/anon keyと実Auth access tokenで実行。手製署名JWTだけの検証はPostgREST JWT検証として別記し、実Authログインと同一扱いしない。
5. 新アプリを同一合成DBのURLへ接続して、実際のSDK helperと画面を操作する。Next localとOpenNext/Wrangler local previewは区別。外部APIや本番R2へ到達させない。R2は合成バイナリのlocal bindingのみ。モックは外部YouTubeなどのみとし、Auth/DB応答のmockテストは別集計。CIログにID・token・メール・生responseを出さない。実際の成功/失敗/未実施を記録し、終了時コンテナ/データ/credentialを消去。

## 3. 必須受入（新アプリと新DBのみ）

| ID | 操作と期待値 | 証跡 |
| --- | --- | --- |
| A1 | 本人/管理者/第三者が実Authログイン、getUser一致、匿名/期限切れtokenの境界 | 実Auth/HTTP |
| A2 | 公開/非公開グループの名簿、人数、非公開設定、管理者のみ申請表示。第三者/匿名の不要なデータ取得を拒否 | SDK＋HTTP＋375px画面 |
| A3 | 管理者の連携申請→本人表示名/引継ぎ/公開同意→正常承認（公開・非公開）→管理者/本人画面で状態一致 | HTTP COMMIT＋DB監査 |
| A4 | 同意不足/第三者/匿名/旧approved直呼び/古いtoken/表示名CASで拒否。旧reject/cancelだけ許可、pending維持・不要なmergeなし | HTTP status/SQLSTATE＋DB照合 |
| A5 | 通常加入・仮選手引継ぎ・拒否/取消、プロフィール画像/非公開設定と統合監査を保持 | SDK＋HTTP＋DB照合 |
| A6 | H53手動復元で対象のみ復元、統合後に対象行を編集した場合は安全中止。並行承認/同じリクエスト再送は重複mergeなし | 合成隔離DB multi-connection |
| A7 | 通常/チーム/公式イベント、共有token、動画クリックの正負ケース。共有外の情報を返さない。旧click anon停止は新共有導線確認後 | HTTP＋ブラウザ |
| A8 | 既存の固定ペア・得点/GP・戦績/順位・画像/施設に退行なし、DB対象行と実UIを照合 | 実HTTP＋対象回帰 |
| A9 | 最新HEADのTypeScript/OpenNext build、375px light/darkで代表導線、エラー時成功表示しない | CI＋ブラウザ＋Worker local |
| A10 | SQL順序・履歴・停止条件・配信後検証・最新外部バックアップ/R2取扱・復元/forward-fix | リリース審査 |

## 4. Codexへの引継ぎ（アプリ側の実行時）

AGENTS.mdに従い、#264と既存Draft #265、台帳142 §22と本計画を読む。新しいPR/branchを作らない。最新HEADと他agent担当を確認。ChatGPT担当SQL（145/147/164/168/170等）を勝手に変更しない。新アプリの実Auth/HTTP・画面試験を合成データ専用ローカル環境で実装・実行し、必要なアプリ不具合のみ修正。旧アプリ互換目的の実装は禁止。Prod/Stageへの書込み、実Cloudflare deploy/main merge、追加有料環境は禁止。検証環境や認証・DB契約に不足があればGitHubでBLOCKEDとし、実行した結果と未実施を明記する。証跡/HEAD/差分/次工程をIssueへ記録。

**本番NO-GO。** H54の実Auth/HTTP・ブラウザ受入はまだ未完了。正式Migration作成/履歴整合、最新バックアップと復元、公開承認は別工程。
