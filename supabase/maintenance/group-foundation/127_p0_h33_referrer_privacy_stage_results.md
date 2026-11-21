# TASK-08 / P0-H33：共有動画クリックでreferrer URLを保存しない（二重対策）

実施日：2026-11-20 JST。対象：既存Issue #264／Draft PR #265／作業ブランチ`codex/task-08-group-foundation`。変更対象はStage（Supabase project ref `zzjwpresqkefnyjyisgd`）と、既存PR中の共有画面2ファイルだけ。**Prod DB、main、Cloudflare本番には未反映。PRはDraft/OPEN・未マージ、新規PR/ブランチなし。**

## 1. 見つけた経路と対策

H31の新しい共有token必須クリックRPCは、`p_share_token`自体をクリックテーブルへINSERTしない。しかし、共有ページ3箇所は`p_referrer: document.referrer`を送信し、DB関数も`nullif(left(p_referrer,500),'')`をそのままclickテーブルへ書き込んでいた。このため、**参照元URLに共有tokenが含まれる経路では、クリック履歴のreferrer列にtokenが保存され得る**。実データで漏えいが確認されたわけではなく、ソースのデータフロー上の未遮断経路。

- `app/share/events/[token]/page.tsx`：通常試合動画／開催動画リンクの`p_referrer`を`null`に変更（2箇所）。
- `app/share/official-events/[token]/page.tsx`：公式戦動画の`p_referrer`を`null`に変更（1箇所）。
- アプリ側変更だけでは悪意のある直接RPC呼出しでreferrer欄を埋められるため、**DB側の新3関数も`p_referrer`を受け取っても必ずNULL保存する**よう変更。RPCの署名・引数名・匿名/認証済みEXECUTE・token照合・user_agent・既存カウントテーブルは不変。
- YouTubeへのクリック遷移／スコア／チームA緑・B青／混合結果の中立表示／GP／旧クリック集計SQLは変更していない。従来のreferrer分析列に新規値が入らなくなる意図した最小限の計測データ縮小。

## 2. Stage SQLの安全確認と適用

- [125 H33 Stage更新SQL](125_p0_h33_stage_click_referrer_minimization_apply.sql)：新RPC3つの`CREATE OR REPLACE FUNCTION`のみ。前提：Stage識別、既存`events`／`official_events`0、旧3関数の定義SHAを`pg_get_functiondef()`からmd5で照合、SECURITY DEFINER／空search_path／anon/auth権限を再確認。想定外なら例外ROLLBACK。
- H31／H32で登録した元Migration `20261120091138_...`は**変更しない**。関数更新を独立した新Migrationとして追跡。
- 125を**COMMITではなくROLLBACKに差し替え**た単体試験は成功。さらに、125の関数更新+ [126 H33合成イベント・クリック試験](126_p0_h33_token_click_referrer_rollback_probe.sql) を同一トランザクションで実行、**すべてTRUEでROLLBACK**。実際にreferrerへ共有token風URLを入力しても3種すべて`referrer IS NULL`、user_agentは従来通り保持。有効tokenは3種それぞれ1件、無効/別種/空/NULLtokenは0件、共有停止後の追加0件、旧RPC存在・anon EXECUTE保持を確認。
- Stageへ125を`apply_migration`で確定適用：`name=task08_h33_stage_token_click_referrer_minimization`、**`version=20261120094347`**、Migration72→73。
- **適用済み本体へ126を再実行しROLLBACK、全判定TRUE**。Stage事後READ ONLY：新3関数にH33のNULL保存とtoken親イベント一致条件が存在、anon/auth EXECUTE=true、元3旧RPC anon EXECUTEも3件残存。`clubs3/club_members12/player_profiles12/events0/official_events0/event_video_clicks0/event_video_link_clicks0/official_video_clicks0`、migration73、anon clubs SELECT=false。

## 3. 正式MigrationとCI

Supabase CLIの`migration new`を、既存Stage専用Actionsの**一時ステップ**で実行。[Actions #44713381999](https://github.com/g-ambe/Padel-match/actions/runs/44713381999) SUCCESS。CLI 2.81.3が生成した原ファイル名`20261120094544_task08_h33_stage_token_click_referrer_minimization.sql`を、**Stage ledgerにすでに存在するversion `20261120094347`と一致させて**H33適用原本125をコピー・cmp一致（SHA256 `40b3dec90d11ef0a7ad71fad97f0e344c6ae2df7ba6f099ee46656968ee2bc61`）。既存PRへ [**正式Migration 20261120094347**](../../migrations/20261120094347_task08_h33_stage_token_click_referrer_minimization.sql) として記録。**Stageに同SQLを二重適用していない**。

- [H33専用静的テスト](../../../tests/h33-video-click-referrer-privacy.test.cjs) 4件を恒常CIへ追加：適用SQLとのバイト単位パリティ・version一意、3RPCのNULL保存とtoken/条件保護、共有画面3箇所でreferrer無送信、H33実SQL ROLLBACK probeが全3表を検証すること。
- CIに一時追加したCLI/npm実行ステップは**削除済み**。恒常的に残るのはH31(5)＋H32(3)＋H33(4)の回帰12件のみ。
- **最終 [Actions #44713666995](https://github.com/g-ambe/Padel-match/actions/runs/44713666995)：completed/SUCCESS**。H31/H32/H33 合計**12/12 PASS**、TypeScript noEmit・既存Stage B0実Auth/PostgREST・H22/H29・H31匿名HTTP no-opはすべてSUCCESS。
- [121 H31旧ROLLBACKスクリプト](121_p0_h31_installed_token_click_rollback_probe.sql)はH31当時の`referrer='test referrer'`保存を期待する**履歴資料**であり、H33後に再実行すると期待値が古く失敗する。その旨だけ冒頭へ追記、**現行Stage回帰は126を使用**。過去のH31試験結果を今回の検証として数え直さない。

## 4. 未完了と次の優先順位

1. **新token必須RPCの有効共有tokenを使う実HTTP書き込み正例は未実施**。Stageにイベント0件、バックアップ・隔離復元が未確認。ロール切替＋ROLLBACK正例と実PostgREST無効token/no-opは確認したが、これはブラウザ正例や実クリック遷移テストの代替ではない。
2. **旧3RPCの匿名実行権限は依然存在**（旧RPCは共有tokenを照合せずにクリック記録でき、referrerも書き込み得る）。正常共有の旧ブラウザとの互換影響と移行後の実正例を確認するまで一括REVOKEしない。現時点で**旧経路P0解消とは主張しない**。
3. token保有者の連続呼出しや、`p_user_agent`に不正文字列/秘密を入れる意図的な要求はtoken照合＋referrer NULLだけでは抑止できない。必要ならAPI/WAFのレート制御・ログ保護を別評価。クリックテーブルにIP/明示token列は追加していない。
4. 固定ペア0040〜0043のStage正式適用には、DB外バックアップ・隔離復元ゲートが残り**NO-GO**。本番の重要表匿名base SELECTも未修正。Stage/Prodへ`db push`一括実行は禁止（旧連番MigrationとStage ledgerが非同形）。
5. PRは**Draftのまま**。main/Prod SQL/本番デプロイの別承認が得られるまで実施しない。Projects #2フィールド同期は今回未実施。

**H33の完了範囲：新方式のreferrer収集停止・Stage適用・ROLLBACK正負例・CI・正式Migration履歴同期。旧RPC閉鎖と共有の実ブラウザE2Eは未完了。**
