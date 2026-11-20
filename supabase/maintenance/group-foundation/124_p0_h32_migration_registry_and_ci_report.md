# TASK-08 / P0-H32：H31 Stage適用済みRPCを正式Supabase CLI Migrationへ登録

記録：2026-11-20 JST。対象：既存Issue #264、Draft PR #265、ブランチ `codex/task-08-group-foundation`。**Stage DBの再適用なし、本番DB/Cloudflare/main変更なし。PRはDraft継続。**

## 1. 二重適用を避けるMigrationファイル整備

H31時点でStageの`supabase_migrations.schema_migrations`に記録されている内容：
- `version=20261120091138`
- `name=task08_h31_stage_token_scoped_video_click_rpc`
- 対象は通常試合動画／開催動画リンク／公式戦動画のtoken結合クリック記録RPC3つ。H31でStageだけへ`apply_migration`済み。

リポジトリ`supabase/migrations`の過去ファイルは`0001`〜`0065`という**既存連番形式**。一方Supabase CLI公式`migration new`は`<timestamp>_<name>.sql`を生成する（<https://supabase.com/docs/reference/cli/supabase-migration-new>）。既存のStageの`version`と異なる`0066`を無造作に作ると二重適用/履歴不整合の原因となるため、今回はCLIで生成したファイル名のtimestampを**既に適用したStage versionに正確に整合**させる。

1. 直接接続できるローカル環境ではnpm registryへのDNSが利用できなかったため、既存の**Stage専用GitHub Actions**にCLI生成専用の**一時ステップ**を追加。Actions [#44711177066](https://github.com/g-ambe/Padel-match/actions/runs/44711177066) **completed/SUCCESS**。Node22/公式npm package `supabase@2.81.3`、`supabase migration new --help`確認後に実際に`migration new task08_h31_stage_token_scoped_video_click_rpc`を実行。CLIの生成原名は`20261120093011_task08_h31_stage_token_scoped_video_click_rpc.sql`。
2. 同じActionsの使い捨て領域内で、生成した空Migrationを**Stageの記録済みversionへrename**し、[120 Stage適用原本](120_p0_h31_stage_token_click_additive_apply.sql)をコピーし、`cmp`で**完全一致**を確認。SHA256：`a4d406a6ae559f79be1a55e32a54157c3689d1dcd83f69f553beb0b850a58445`。ローカルrunnerからDBへ接続/SQL実行なし。
3. 上記と同じ内容を既存ブランチの [**`supabase/migrations/20261120091138_task08_h31_stage_token_scoped_video_click_rpc.sql`**](../../migrations/20261120091138_task08_h31_stage_token_scoped_video_click_rpc.sql) に追加。GitHubのblob SHAが原本120と**完全一致**（`8cf9feae5b4d09d7e09b1550db563dc8c0fdcab2`）。
4. 一時的なCLI/npmインストールステップはActionsから**撤去**。恒常CIには、新規 [`tests/h32-token-click-migration-parity.test.cjs`](../../../tests/h32-token-click-migration-parity.test.cjs) の3件を追加し、①原本120との内容一致、②Stage履歴versionの唯一のrepo Migration、③旧RPCに対する破壊的変更/解除がないことを検証。既存のH31 5件と一緒に実行する。

## 2. Stage実DBとCIの最終検証

Stage READ ONLY照合：`migrations=72`、`version=20261120091138`と`name=task08_h31_stage_token_scoped_video_click_rpc`が**各1件**。新しい3RPCは存在・`SECURITY DEFINER`・anon/authenticated EXECUTE、旧3RPCの匿名EXECUTEも残存。業務データは`clubs=3 / club_members=12 / player_profiles=12 / events=0 / official_events=0 / video clicks=0,0,0`。**Stage DBへの追加Migrationや二重DDLは実行していない**。

最終の [GitHub Actions **#44711568566**](https://github.com/g-ambe/Padel-match/actions/runs/44711568566) は **completed/SUCCESS**。
- H31静的5件＋H32 migration parity3件＝**8/8 PASS**
- 既存Stage real Auth/HTTP、公開名簿/人数、共有無効token、クリック新RPCの匿名HTTP無効token/no-op、TypeScript noEmitは全ステップSUCCESS
- GitHub CLI rehearsalを行ったActions #44711177066もSUCCESS。最終Workflowには一時CLIコマンドを残していない。

## 3. なお残る導入・セキュリティゲート

- **正式ファイル作成≠CLI `db push`の安全性承認**。既存repoには`0001`〜`0065`という古い連番Migrationが存在する一方、Stage migration ledgerには`task08_stage_00xx`等の別versionがあり、全履歴の完全パリティは未確認。**Stage/Prodへ一括`supabase db push`しない**。本番導入は必要機能/RLS/共有/画像/固定ペアを含めた歴史的パリティ確認と個別承認が必要。
- H31の**有効tokenによるPostgRESTクリック書込み正例／実ブラウザ・プレビューのクリック遷移とカウント**は未実施。Stageに実イベント0件、DB外バックアップと隔離復元証拠がなく、永続fixture（51）を作っていない。ROLLBACK＋SET ROLE正例はH31で5/5確認済み。H31の実HTTPは無効token no-opのみ。
- **旧クリックRPC3件は匿名EXECUTEのまま**。token所持確認なしの旧経路を閉じる最終修正は新画面/正例受入と切替確認後に実施。ここで先にREVOKEすると古いStage/本番ブラウザがクリックを記録できなくなる。
- **追加のプライバシー確認候補**：共有画面の`p_referrer`は`document.referrer`から渡され、DB関数は最大500文字を保存できる。参照元URLに共有tokenが含まれていればログに入る可能性がある。新RPCの`p_share_token`を直接INSERTしていないことと、`referrer`内経由の非露出は別。Stage公開前にraw referrerの取り扱いを再検証し、不要なら送信しない/安全なoriginのみ保存する対策を評価。旧RPCにも同様の懸念がある。
- Stage固定ペア0040〜0043正式導入はDB外バックアップ/隔離復元未通過で**NO-GO**。Prodの重要表匿名SELECT対策もP0継続。main/Prod SQL/Cloudflare本番デプロイは別承認まで実施しない。

**H32判定：Migration履歴・原本SQLの登録とCI検証はPASS。サービス全体の安全性・本番リリースはNO-GO。**
