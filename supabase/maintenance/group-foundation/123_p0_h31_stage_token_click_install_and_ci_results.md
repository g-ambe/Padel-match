# TASK-08 / P0-H31：動画クリックtoken認可 — Stage追加適用・共有画面切替・実HTTP負例（2026-11-20）

**状態：Stageの新方式は実装・部分受入PASS／本番と旧RPC遮断は未実施。** 既存Issue #264 / Draft PR #265 / `codex/task-08-group-foundation`。本番DB・Cloudflare本番・mainは無変更。新規PR/ブランチなし。

## 1. DB追加と実際のStage受入

- [120 Stage追加専用SQL](120_p0_h31_stage_token_click_additive_apply.sql)：[118 H30のROLLBACK試作](118_p0_h30_token_bound_video_click_rollback_probe.sql)で検証した3関数のみ新設。旧`record_*_click`、イベント・結果・RLS/GRANT/基底表・履歴行は変更しない。実行前に既存関数/対象表/クリック表RLSを照合。`SECURITY DEFINER`、空`search_path`、関数EXECUTEの`PUBLIC`剥奪・`anon/authenticated`明示GRANT、token親イベント一致・closed/共有有効・非削除・動画URL有効の条件。
- **事前ROLLBACK試験**：初回、テスト専用postflightの`pg_proc.proconfig`空pathの文字列表記が異なり例外→**トランザクション全体失敗・未適用**。関数本文には触れず、実Postgres表記`search_path=""`に修正。2回目の原本SQL `COMMIT`→`ROLLBACK`差替えで`new_rpcs=true/anon_execute=true/authenticated_execute=true/rollback_only=true`、PASS。
- **Stage確定適用**：`mcp Supabase apply_migration` で2026-11-20 `task08_h31_stage_token_scoped_video_click_rpc`、DB Migration version **`20261120091138`** を適用成功。履歴 **71→72件**。これは新規関数の非破壊追加のみ。**固定ペア0040〜0043正式適用とは無関係**。
- 適用後READ ONLY：新3RPCすべて`prosecdef=true`・`search_path=""`・anon/authenticated EXECUTE=true。既存3旧関数は存在・anon EXECUTE可能のまま。`clubs3 / club_members12 / player_profiles12 / events0 / official_events0 / click3表すべて0`、匿名clubs SELECT=false。
- [121 Stageインストール済みRPCのROLLBACK試験](121_p0_h31_installed_token_click_rollback_probe.sql)：合成通常イベント・開催動画リンク・公式動画を一時作成し、`SET LOCAL ROLE anon`から**無効/種別違い/NULL/空token=クリック0件、正規token=3種類各1件、共有OFF後=増分0**。5判定 **すべてtrue**。末尾ROLLBACK、実SQLの恒久fixture/履歴行は0。

## 2. アプリは共有画面3箇所だけ変更

対象 `app/share/events/[token]/page.tsx` の通常試合動画／開催動画、`app/share/official-events/[token]/page.tsx` の公式戦動画。旧`getSupabaseClient()`と旧`record_*_click`から、閲覧と同じ`getSharedEventClient(token)`と新`record_*_click_by_token`に変更。

- RPC引数：`p_match_id`または`p_video_link_id`、`p_share_token:token`、`p_user_agent`、`p_referrer`。匿名トークンをクリック履歴テーブルに保存しない。旧RPCへのfallbackなし。
- エラー出力は`error.code`だけとし、エラー本文・details・hintから共有tokenがログに現れる余地を減らした。クリック後のYouTube遷移・見た目・スコア・混合表示・タブ・GP・既存共有データDTOは変更しない。UI文言/ヘルプ内容変更不要。
- 恒常静的回帰 [`tests/h31-token-video-click-gate.test.cjs`](../../../tests/h31-token-video-click-gate.test.cjs) で新関数3つのtoken/非公開条件、GRANT/SECURITY DEFINER、3箇所すべての新RPC化、旧RPC使用なし、エラーログ抑制を検査。

## 3. GitHub Actions Stage Auth+HTTP実行結果

- 既存 `.github/workflows/task08-staging-b0-auth-http.yml` にH31静的5テストと [122 Stage匿名PostgREST無効token/no-op試験](122_h31_stage_real_http_negative.mjs) を追加。既存のH12/B0/H22/H29/TypeScriptチェックは維持。起動は従来の無害な `.task08-b0-trigger` だけ変更。Secretsをログに出さない。
- 初回のActions `#44709383867` は **FAIL**：静的5項目中1件がSQLの`FOREACH name`表記を`to_regprocedure('literal')`と誤認するテスト側の正規表現に起因。TypeScriptはPASS。テストだけ修正し、再起動。
- **最終 [Actions #44709553660](https://github.com/g-ambe/Padel-match/actions/runs/44709553660) — completed / SUCCESS、HEAD `4f33a57e76ee8e315ed60748c869f68bca76f284`**。TypeScript noEmit、H31静的 **5/5 PASS**、既存B0実Auth・H22・H29すべてSUCCESS。
- H31実匿名PostgREST：新3RPCへ存在しない予約UUID＋無効の合成tokenを渡し、各 **HTTP204・error=null、3/3 PASS**。**これは新RPCの公開APIルーティング/負例no-op受入であり、正規tokenの実HTTP成功を示さない**。実イベント0件なので業務行への追加は不可。
- Actions後に再度Stage READ ONLYで、Migration72、3RPC実装、クリック3表0行、グループ・所属・プロフィール3/12/12、イベント/公式0、旧3RPCのanon EXECUTE引き続きtrueを確認。

## 4. StageセキュリティAdvisor

H31追加後のStage監査で `anon_security_definer_function_executable` 警告 **12→15件**、`authenticated_security_definer_function_executable` **52→55件**。追加の3件は今回意図的に公開された**token照合付きのSECURITY DEFINER**。見かけ上の警告増加を安全性証明とせず、親eventのtoken一致・関数の絞ったEXECUTE・匿名RLS/SQL/RPC負例を保持し、実token正例/リプレイ・負荷対策の追加評価が必要。`rls_enabled_no_policy` INFO 1、`function_search_path_mutable` WARN 1、`auth_leaked_password_protection` WARN 1は今回の変更の直接対象外、別途設定確認。

## 5. 明確な未完了・本番NO-GO

- **正式なrepo migrationファイルは未作成**：Supabase CLI `npx supabase --version` が現在の実行環境でタイムアウトし、スキル指示の`supabase migration new`を実行できなかったため、手動で架空の`supabase/migrations/0066...`を作らなかった。Stage適用SQLの原本はメンテナンス配下の120、適用済みDBのMigration履歴には名称とversionを残した。**mainへの移行前にCLIで生成した正式Migrationへ正確に転記し、Stage/Prod履歴パリティをレビューする必要がある**。既存の`0065`を編集しない。
- 新方式の**有効token実HTTP・実ブラウザ/実機、共有token再発行・クリック数集計のUI**は未検証。Stageの正常イベントは0件。バックアップ/隔離復元ゲートを満たさない恒久合成fixture `51` は作らない。
- **旧3RPCのanon EXECUTEは依然残存**。これを遮断しない限り、呼出者のtoken所持なしで記録可能な旧経路は解消していない。新アプリの実Stage preview・正規token HTTP正例・旧ブラウザ残存の切替判断後、旧RPCの公開EXECUTEをStageから段階的に遮断する。**今回はREVOKEしない**。
- Prodの旧匿名base-table SELECTに関する**P0は未是正**。本番DB・Cloudflareデプロイ・mainマージ、固定ペア0040〜0043のStage正式導入は引き続き禁止。DB外バックアップと隔離復元は未確認、PR #265 Draft/OPEN、Issue #264 OPEN。
- 次の優先順：①CLI経由の正式migration作成と既存DB履歴整合 ②隔離fixture/復旧手段→Stage有効token実HTTP/ブラウザ/クリック正例 ③Stage旧RPC公開EXECUTE遮断 ④別承認後Prod安全切替 ⑤固定ペア・画像パリティ復元ゲート。
