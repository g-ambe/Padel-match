# TASK-08 / P0-H26：Stage固定ペア0040〜0043のDB外バックアップ・復旧ゲート

記録日：2026-11-20 JST。関連：Issue #264 / Draft PR #265 / AGENTS.md / `104_p0_compatible_cutover_sequence.md` / `106_p0_historical_migration_preflight_readonly.sql` / `107_p0_stage_legacy_migration_gates.md` / `108_p0_0040_0043_shadow_security_rollback_result.md` / `109_p0_codex_consumer_inventory.md`。

**判定：NO-GO（正式Stage Migrationの確定適用は不可）。** 今回は既存Stageの読み取り専用照合と復旧ゲートの明文化だけ。本番プロジェクト `padel-hub`、Stageのデータ・認可・Migration履歴、Cloudflare/R2、アプリ本体は変更していない。

## 1. 今回の実Stage READ ONLY照合

対象は **`padel-hub-staging`**（Supabase project ref `zzjwpresqkefnyjyisgd`）。Supabase SQL APIに**SELECTだけ**を送り、実データの個人名、ID、認証トークン、R2キー、パスワードを取得していない。

| 項目 | 実測 | 判定 |
| --- | --- | --- |
| プロジェクト状態 | ACTIVE_HEALTHY | 接続可 |
| `clubs / club_members / player_profiles / events` | 3 / 12 / 12 / 0行 | 前回H25基準と一致 |
| `supabase_migrations.schema_migrations` | 70行 | 前回H25基準と一致 |
| `fixed_pair_private`・`lineup_private`・`profile_media_private` | すべて不存在 | 未導入 |
| `event_fixed_pair_state`・`event_fixed_pairs`・`event_fixed_pair_rounds` | 対象3表の現存数0 | 未導入 |
| `events` の更新ポリシー | `security_minimal_events_update` / PERMISSIVE | 本番旧ポリシーとは異なる |
| 旧ID保護の必須名称4種・有効トリガー | 0件（原本0040は7件必要） | 原本0040を単体適用不可 |
| `match_results.match_id` 重複グループ | 0件 | 0043の重複前提を満たす |
| `anon` の `events` / `club_members` 表SELECT | false / false | 少なくとも対象2表の表レベル権限なし |

**注**：これはDBメタデータ/件数の現状確認。実JWTや全イベント系RLSの正負例を再実行したものではない。また`has_table_privilege`だけで全列/関数/APIの非公開を証明するものではない。前回H25の8/8ロールバック試験を今回「再実行済み」とは扱わない。

## 2. 原本の適用条件・依存関係

1. `0040_event_fixed_pairs.sql`：5つの主要表にSHARE ROW EXCLUSIVEロックを取り、6表RLS / 旧更新ポリシー名 / ID保護7トリガーを確認。DB外バックアップと復元確認が前提。
2. `0041_atomic_round_lineups.sql`：0040の導入済み環境に依存し、通常イベント/試合/結果の主要表へSHARE ROW EXCLUSIVEロック。ラインアップ関数とDB側直接書込みガードを追加。
3. `0042_round_lineup_safety.sql`：0041導入後、`lineup_private.release_control.editing_enabled = false` を厳格確認し、安全対策・専用削除/結果操作を追加。
4. `0043_match_results_one_per_match.sql`：結果重複0件、専用削除関数存在を前提に UNIQUE(match_id) を追加し、既存結果の自動削除・統合はしない。
5. H25で「本番ID保護トリガー4関数/7トリガーを検証中だけStageに再現し、`rls10_events_update_members`を現Stageと同じ条件のRESTRICTIVEで追加」したトランザクション内の0040→0043試験はPASS、全体ROLLBACK済み。ただし **Stageの恒久互換設計は未承認**。同名PERMISSIVE追加によるOR合成や原本の前提回避は禁止。

## 3. 正式Stage導入の前に必要な「DB外バックアップ」証跡

- [ ] **保存方式を確定**：Supabase Dashboardの実バックアップ有無/世代/対象と、必要ならPostgreSQL論理バックアップ（Supabase CLI `db dump` / `pg_dump` 等）を運用担当が確認。プランから自動バックアップを推測しない。MCPの現行接続には取得済みバックアップ一覧・ダウンロード/復元試験の証跡がない。
- [ ] **正しい範囲を明示**：Stageの業務テーブル・定義、policy・function・trigger、Migration履歴、カスタムスキーマ、Auth/Storageメタデータ、拡張機能・ロール等について、バックアップツールの対象/除外を実際の生成物で点検。デフォルト`db dump`に何でも含まれると思わない。
- [ ] **機密の保護**：エクスポートを暗号化しDB/Repo外の限定保管場所へ格納。バックアップ本文・service_roleキー・connection URL・JWT・secret・利用者データをGitHub Issue/PR/ログへ貼らない。GitHubには取得時刻・対象範囲・暗号化/検証済みフラグ・ハッシュ等の機密でない証跡だけ記録。
- [ ] **同一バックアップの復元実証**：本番/既存Stageを上書きせず**隔離した復元先**で実施。使い捨て環境への復元許可・追加コストの有無を確認し、復元先のID/権限/列・RLS/trigger/必要RPC/データ件数/Migration履歴が期待と一致することを検証。復元先と本番サービスを接続しない。
- [ ] **復旧時操作の手順化**：どの段階でアプリアクセスを停止し、いつ移行を打ち切り、どのバックアップから、どの環境へ、どの手順で戻し、実Auth/共有リンク/固定ペア/スコアをどの順で再確認するかを記録。通常の`ROLLBACK`や過去のGitコミットに戻すことだけではDB外の復旧ができた証拠にはならない。
- [ ] **旧データ/外部媒体保護**：現Stageの既存12所属・12プロファイル・テストAuthを消去/初期化しない。本番固定ペア実データや画像、Production secretをStageにコピーしない。R2オブジェクトの復旧はDBバックアップとは別。

Supabase公式資料：<https://supabase.com/docs/guides/platform/backups>（プランにより利用可能な自動バックアップが異なる。DatabaseバックアップはStorageの実オブジェクトを含まない）。論理バックアップ案内：<https://supabase.com/docs/reference/cli/supabase-db-dump>。

## 4. バックアップ確認後も残るステージング導入ゲート

- [ ] **認可互換の恒久設計承認**：原本ガードを満たすための7トリガー/4関数とStage最小RLSの二重執行、RESTRICTIVE追加の実作用をレビュー。既存PERMISSIVE/匿名遮断を拡張しない。
- [ ] **正式投入前ROLLBACK試験**：その時点のHEADとStage状態に対して`0040→0041→0042→0043`原本順の同一トランザクション試験。ロック上限を保持し、必ずROLLBACK・事後差分ゼロ。既存H25試験の結果を今回実施分と誤認しない。
- [ ] **真のJWT/API E2E**：一般メンバー/管理者/別クラブ/未ログインの読書きと拒否、イベント名/作成者/所属ID保護、固定ペア設定/入替、1〜5面ラウンド生成、結果保存/編集/削除、ScoreInput、GP、競合・再送を確認。DB内の`SET ROLE`模擬は補助試験であり、実HTTP JWT試験の代替ではない。
- [ ] **差分ゼロ判定の証跡**：適用前後のpolicy/trigger/ACL、計数、Migration履歴、Stage匿名base-table拒否を比較。異常・不明状態なら正式導入禁止。
- [ ] **Stage確定適用の別判断**：上記条件と運用上の復元準備が成立して初めて実施日時と担当を決める。変更前の再照合なしにMigrationを流さない。

## 5. 今回の作業と次の安全な手順

- **実施**：最新GitHub PR/AGENTS、原本0040〜0043、既存106〜109の内容確認。Stage projectの移行数・メタデータをSELECTで照合。本記録のみ既存ブランチ/PR #265へ追加。
- **未実施**：バックアップ取得/ダウンロード、隔離先への復元、Stage Migration確定適用、0040〜0043トランザクション試験の再実行、実JWT/ブラウザ、DB/Cloudflare/R2の変更。
- **次に進む条件**：DB外バックアップおよび隔離先への復元実証の事実を取得後、Stage専用恒久認可互換案・総合正負例・事前ROLLBACKを再評価する。画像0048〜0051はStage専用R2/secretゲートとして別管理。

**正式判定：NO-GO**。Prodの匿名base-table SELECTに関するP0は別途未修正。Draft PR #265をReadyにしない、mainへマージしない、本番SQL・Cloudflare本番デプロイは行わない。
