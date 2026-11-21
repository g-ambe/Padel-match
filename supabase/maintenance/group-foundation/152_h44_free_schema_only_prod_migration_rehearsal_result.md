# TASK-08 / H44：追加費用なし・本番スキーマに対する17工程の連続Migration検証

実施日：**2026-11-22 JST**。対象は既存Draft [PR #265](https://github.com/g-ambe/Padel-match/pull/265) / [Issue #264](https://github.com/g-ambe/Padel-match/issues/264)。本報告は[Actions #44952613293](https://github.com/g-ambe/Padel-match/actions/runs/44952613293)の実ログと、終了後のStage/Prod READ ONLY検証に基づく。

## 結論

**PASS：本番DBのschema、権限/RLS、関数、trigger、Migration名/versionを読み取って再現した隔離Postgresで、Phase1の6工程とPhase2の11工程を連続実行した。** それぞれのPostgres SQLと事前・事後ガード、Phase間の履歴依存、Phase2後の二重再適用不可判定が成功。

**ただし本番GOは未承認。** 本検証では**利用者レコードを一切取得・複製していない**ので、移行時のデータバックフィル・実際のオーナーや公開名簿での振る舞い、全画面の実Auth・HTTPやCloudflare動作まではPASSしていない。

## 4回の実行記録

| 実行 | 結果・停止点 | 対応 |
| --- | --- | --- |
| [#44915274585](https://github.com/g-ambe/Padel-match/actions/runs/44915274585) | FAIL：暗号化の全件バックアップ取得中、約11分後に例外。SQL未到達 | 全件バックアップ方式を廃止。既存リードオンリー接続を使う**schema-only**方式へ変更 |
| [#44952103384](https://github.com/g-ambe/Padel-match/actions/runs/44952103384) | FAIL：本番schema-only取得PASS（約55秒）、隔離DB復元時にSQLSTATE `2BP01`（依存オブジェクト） | 既存の検証済み `cloud_backup.restore_files()` と同じ隔離スキーマ初期化の順序を再利用 |
| [#44952370833](https://github.com/g-ambe/Padel-match/actions/runs/44952370833) | FAIL：schema-only取得PASS／隔離復元と本番構造メタデータ一致PASS。結果処理のPython `KeyError` でSQL未到達 | psqlのJSONB出力を直接JSON値として読むよう修正 |
| **[#44952613293](https://github.com/g-ambe/Padel-match/actions/runs/44952613293)** | **SUCCESS：schema取得→隔離DB復元→Phase1→履歴チェック→Phase2→履歴チェック→削除まで全部PASS** | 採用結果 |

### 成功runの実ログ

- 21:38:56Z：Prod schema-only snapshot開始（データ行を取得しない）
- 21:39:52Z：schema/roles/migration names PASS
- 21:41:03Z：PostgreSQL17ネットワーク隔離コンテナへの復元とProd schema fingerprint照合PASS
- 21:41:04Z：Phase1 **6工程**を適用、`task08_prod_phase1_additive`履歴登録シミュレーションとPhase2実行資格PASS
- 21:41:04Z：Phase2 **11工程**を連続適用、`task08_prod_phase2_atomic`履歴登録シミュレーションと再実行不可フラグをPASS
- その後：一時ファイル・DBコンテナ削除PASS

※時刻はGitHub ActionsログのUTC。履歴登録のversionは**隔離DBだけに挿入した2099年の試験用値**。実本番の履歴やMigration versionへは一切挿入していない。

## 安全対策

- **本番**：read-only `REPEATABLE READ` snapshot、`pg_dump --schema-only --format=custom`。DBのschema・権限・ロール構成・Migrationバージョン/名称のみ。イベント/所属/メール/ユーザー等**行データは収集しない**。
- **隔離DB**：GitHub公開repoの通常GitHub-hosted runner上の一時Supabase/PostgreSQL17 Docker。既存 `cloud_backup.start_isolated_database()`でネットワークを全切断してからテストSQLを実行。
- **対象コード**：`151_h43_cost_free_isolated_rehearsal.py`（H44 schema-onlyに更新）、既存 `.github/workflows/task08-staging-b0-auth-http.yml` のH43専用ジョブ、`.task08-free-rehearsal-trigger`。独立の重複workflowを作らない。
- **対象SQL**：`147_h41_prod_phase1_additive_candidate.sql`（6工程）→`145_h40_prod_phase2_atomic_cutover_candidate.sql`（11工程）を改変せず実行。事前／事後に`149_h42_prod_migration_replay_gate_readonly.sql`相当の履歴チェックを実行。
- 完了時には`if: always()`で一時ファイル・隔離コンテナを消去。Cloudflare Worker、Supabase Stage、Prod DB、main、PR mergeに変更なし。Supabase有料Preview Branchは未作成。

## 実本番の別接続による事後確認

本番READ ONLY：`clubs=13`、`events=91`、`official_events=4`、Migration履歴**22件**、新 `get_shared_event`なし、owner-transfer tableなし。**Wytel Bule Owlsのownerは指示どおり「あんべ」に設定済み**。

Stage READ ONLY：`clubs=3`、`events=0`、Migration履歴**74件**、新 `get_shared_event`あり。

PR #265はOpen/Draft/未マージ。今回のH44では本番・StageにDDL/DMLを適用していない。

## 検証の限界・次の優先作業

1. **データを持つ移行の検証**：本番の本人・クラブ・スコアをコピーせず、ネットワーク隔離DBに**完全な架空データ**を用意して、公開名簿の本人同意・旧Owner/現役main管理者・alias/backfill・トリガー等のdata-dependent条件をPhase1/2の前後で検証する。現H44は構造・SQL実行レベルのPASS。
2. **Stage実Auth／PostgREST／画面**：既存Stageに対し、H34を必要なfixture時だけ明示して、匿名・所属・未所属・オーナー・共有・動画クリック・375pxの代表動線を検証する。
3. **本番切替手順**：候補2本のMigration history実登録方法、Cloudflare `main` auto-deploy順、COMMIT後の旧UI互換・復旧手順、旧基底SELECTの残件、PR #265の大きな変更範囲の回帰を確認する。
4. **TASK-08全体の残件**：同グループメンバー向けプロフィール写真、未所属者への公開開催情報、子タスク#262メール招待は未完了。今回のH44成功だけでTASK-08完了とはしない。

**判定：H44 schema-only 17SQL連続実行PASS、TASK-08本番GOは引き続きNO-GO。**
