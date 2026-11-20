# TASK-08 / P0-H30：共有token正例のROLLBACK再受入・動画クリックのtoken結合試験

実施日：2026-11-20 JST。対象：既存 `codex/task-08-group-foundation` / Draft PR #265 / Issue #264、Supabase **padel-hub-staging**（`zzjwpresqkefnyjyisgd`）のみ。**本番DB・Cloudflare本番・main・実アプリのUI/動作は変更なし。** トランザクション内で作成された合成イベント/関数/クリックはすべてROLLBACKし、恒久適用していない。

## 1. 第1優先：共有リンク正例（通常・公式・チーム混合）

H28後、Stageの現行状態で次の2本の**既存GitHub原本をそのまま**再実行した。Stageは開始時`clubs=3 / club_members=12 / player_profiles=12 / events=0 / official_events=0 / matches=0`、migration=71、匿名`clubs`列SELECT=false。外部共有tokenや本人プロフィールの実データには触れていない。

- `46_h12_share_token_rollback_probe.sql`：通常イベント・公式戦の合成クローズ済みイベント、参加ゲスト、スコアを1トランザクションで作成。`SET LOCAL ROLE anon`で**有効token正例・不正/非共有/種別違い/未知種別負例・events/official_events基底SELECT拒否**を検証。結果：`anon_token_friendly_score_success=true`、`anon_token_official_score_success=true`、`invalid_token_returns_null=true`、`disabled_sharing_returns_null=true`、`cross_type_token_returns_null=true`、`unsupported_type_returns_null=true`、`anon_friendly_base_select_denied=true`、`anon_official_base_select_denied=true`。
- `50_h12_mixed_round_rollback_probe.sql`：別チームのゲスト4人による混合1ラウンド/1試合を仮生成。`SET LOCAL ROLE anon`でチーム・ゲスト・ラウンド・コート・混合ペアスコア4対2・結果中立・選手のA/B所属由来・ゲスト内部IDマスク・不正token NULLを確認。列挙された**11判定すべてtrue**。
- 2本とも末尾は`ROLLBACK;`、**確定DB書込み0**。試験後のREAD ONLY事後確認：`clubs3/members12/player_profiles12/events0/official_events0/matches0/match_results0/event_participants0/event_team_sides0/event_team_matches0/event_team_rounds0/event_team_guests0/migration71`、匿名clubs SELECT=false。

**未完了の明確な区別**：今回の正例はSQLトランザクション内の`SET LOCAL ROLE anon`試験であり、**有効tokenの実HTTP・実ブラウザ試験ではない**。H29の実Stage JWT+PostgREST 14/14 PASSは、無効token負例と公開グループアクセスの検証。Stageに現在実イベントがないため、永続fixtureなしで別HTTP接続から有効tokenを試すことはできない。

既存の`51_h12_stage_http_fixture_setup.sql`／`52_h12_stage_http_fixture_cleanup.sql`、`08_staging_auth_http_smoke.mjs` の `TASK08_H12_TEST_POSITIVE=1` 正例3種類を読み取り確認した。H12実HTTP正例を実施する条件は**Stage DB外バックアップ/隔離復元証跡・50/46再確認・51/52の厳密ガード・テスト専用CIの書込禁止設定解除と即時復旧計画**の承認。運用上の復旧前提が未満なので、**51のCOMMIT永続fixtureは今回実行しない**。52による既存イベントの誤削除は禁止。

## 2. 第2優先：匿名動画クリック記録RPC3件のtoken検証案（現物試験）

現行アプリの呼出し位置：`app/share/events/[token]/page.tsx`（`record_event_video_click`, `record_event_video_link_click`）、`app/share/official-events/[token]/page.tsx`（`record_official_video_click`）。共有結果の読み込みは `getSharedEventClient(token)` + `get_shared_event(p_token,p_kind)` だが、クリック記録には`getSupabaseClient()`と旧RPC（match/link ID、user_agent、referrer）を使用し、**共有tokenそのものを渡さない**。

実Stageの旧3関数は`SECURITY DEFINER`かつanon EXECUTE可能で、共有の有効化・終了・対象動画の存在は検査するが、**呼出者のtoken所持を検証していない**。クリック計測自体は意図した仕様であり、単純に匿名RPCをすべてREVOKEして画面を破壊しない。

### 非永続の新APIプロトタイプ

[**`118_p0_h30_token_bound_video_click_rollback_probe.sql`**](118_p0_h30_token_bound_video_click_rollback_probe.sql)を追加し、Stageにて同じSQLを実行、全体ROLLBACK。新たに3つのtoken結合RPCを**トランザクション内だけ**作成：

- `record_event_video_click_by_token(p_match_id uuid,p_share_token text,p_user_agent text,p_referrer text)`
- `record_event_video_link_click_by_token(p_video_link_id uuid,p_share_token text,p_user_agent text,p_referrer text)`
- `record_official_video_click_by_token(p_match_id uuid,p_share_token text,p_user_agent text,p_referrer text)`

`SECURITY DEFINER` + `SET search_path=''` + public関数EXECUTEの`PUBLIC`剥奪と`anon,authenticated`への限定GRANT。各SELECTは**指定match/video_linkから親eventを辿り、その親の`share_token = p_share_token`を同じ条件式で照合**。終了済み/共有有効/非削除/対象動画URL有効も確認し、既存のクリック集計テーブル・列（トークン保存なし）を再利用。現行関数3つはこの試験では変更/停止しない。

Stageの合成通常イベント1件、公式イベント1件、動画付き通常試合/イベント動画/公式試合を仮挿入し、`SET LOCAL ROLE anon`で3関数を実行した実結果：

| 試験結果キー | 値 |
| --- | --- |
| `invalid_and_cross_kind_tokens_denied` | **true**（不正/別種別/空/NULLでは全クリック0件） |
| `valid_tokens_record_one_each` | **true**（3種類の正規tokenでそれぞれ1件を保存） |
| `after_disabling_share_no_extra_clicks` | **true**（共有停止後に旧tokenを再呼出しても追加記録なし） |
| `anon_can_execute_new_click_rpcs` | **true**（試験期間の匿名ロールだけで新3関数を呼べた） |
| `legacy_rpcs_untouched` | **true** |

**実際に試験完了後のREAD ONLY検証**：`events=0/official_events=0/matches=0/event_video_clicks=0/event_video_link_clicks=0/official_video_clicks=0`、新プロトタイプ関数3つは不存在、Migration71、基礎グループ/所属/プロフィール件数不変。**従来の匿名旧RPC3つは依然EXECUTE可能であるため、恒久的なセキュリティ修正は未完了**。本試験はStage内SQLロール・ROLLBACKのみ。新APIの実JWT/HTTP、クリック画面、並行/負荷は未実施。

### 導入の順序（まだ許可/実装ではない）

1. **DB先行**：現物のStage/prod関数・RLS/テストを再照合したうえ、CLIで正式Migration番号を作成し、token結合新3RPCを先にStageへ追加。将来Prodへの適用は本番の別承認。旧APIは利用者の切替までは残すが、移行中は残存リスクあり。
2. **アプリ切替（Codexスコープ）**：上記2つの共有ページの3箇所だけ`getSharedEventClient(token)`でRPCを実行し、`p_share_token:token`と対象IDを新RPCに渡す。表示・クリック時YouTubeへの遷移・スコア・GP・A緑/B青・3タブは変えない。イベント/公式/チーム混合の既存共有token閲覧に後方互換を保つ。**旧RPCへのfallbackを追加しない**（対策が無効になる）。異常時にtokenやURLをconsoleに出さない。
3. **Stage実Auth/匿名HTTP試験**：正規tokenの3種クリック記録増分、無効/他イベントtoken/停止/再発行で増分0、tokenが保存されないこと、集計画面の正しいカウント、匿名直接INSERT拒否を確認。既存のH12/通常共有/公式/チーム試験と合成ブラウザ、TypeScript/OpenNext互換ビルド。
4. **旧API遮断**：Stageで新アプリ受入後、旧 `record_*_click(uuid,text,text)` 3関数に対する `PUBLIC/anon/authenticated` EXECUTE権限を正確に確認し、必要な役割の旧経路を閉じる。旧ブラウザ残存によるクリック集計の非記録リスクを受入判断。**旧RPCの遅延fallbackは許さない**。本番は段階的デプロイと別承認の手順に従う。
5. **残存リスク**：有効tokenを取得した人による大量クリック等はtoken結合だけでは阻止できない。プライバシー保持・計測維持とのバランスを見てCloudflare側の最小レート制御等を別評価。トークン・IPをクリック履歴に新規保存しない。失敗時にイベント自体やDBが破壊されない復旧手順を用意。

## 3. 第3優先：Stage固定ペア

`110_p0_stage_backup_restore_gate.md`は引き続き**NO-GO**。Supabase公式[Database Backups](https://supabase.com/docs/guides/platform/backups)はプランにより自動バックアップが異なり、FreeにはCLIによる`db dump`等を案内。専用[Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)は別プロジェクトへのDB複製を説明。**既存StageのDB外バックアップを実際に取得し、隔離復元で検証した証跡は未取得**。自動バックアップ・R2オブジェクト復旧まであると推測しない。0040→0043のStage正式適用、Prod変更、mainマージ、本番デプロイは保留。

## 4. 今回の管理

- **実装済み**：rollback-onlyの118試験SQLをPR #265の既存ブランチへ追加し、Stageで実行PASS。既存46/50再試験、Stage事後照合。
- **未実装**：正式な動画クリック新RPC migration、アプリ3箇所の切替、旧RPC EXECUTE閉鎖、正規token実HTTP positive fixture、実画面E2E。
- **本番**：参照・変更とも実施せず。PRはDraft維持・Issue #264 OPEN、Projects #2フィールド同期は今回未実施。

**試験PASSを本番安全性の承認や永続実装の完了と混同しない。** AGENTS.md遵守・既存PR/作業ブランチ再利用・重複PR禁止。
