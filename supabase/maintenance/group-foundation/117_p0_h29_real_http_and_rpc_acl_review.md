# TASK-08 / P0-H29：Stage実Auth/PostgREST 14/14受入と匿名SECURITY DEFINER点検

実施日：2026-11-20 JST。対象：`padel-hub-staging`、既存Issue #264 / Draft PR #265 / `codex/task-08-group-foundation`。**Prod DB、Cloudflare、mainへのマージ、アプリ画面/仕様、RLS・GRANT、既存Stage業務データには今回変更なし。** GitHub Actionsは既存のStageテスト秘密情報を使用し、ログに名前/ID/JWT/パスワード/行本文を出力しない。

## 1. 既存CIを再利用した実Stage HTTPの新規受入

- 新しい非破壊スクリプト：`116_h29_stage_real_auth_clubs_readonly.mjs`。**Stage URLを固定**し、publishable keyと既存の専用StageテストAuthに限定。ブラウザやDB内`SET ROLE`ではなく、Supabase Auth実ログインとPostgREST実HTTPで検証。SQL書込み/API書込み・テストフィクスチャ作成なし。
- `.github/workflows/task08-staging-b0-auth-http.yml` の最後にH29の読み取り専用ステップを追加。既存B0、H22、TSコンパイル等を除去/弱体化しない。
- 既存の無害な `.task08-b0-trigger` だけを更新して既存ブランチ上のStage専用Actionsを起動。**新規branch/PR/別workflowは作成していない**。
- [GitHub Actions run #44697430131](https://github.com/g-ambe/Padel-match/actions/runs/44697430131)、HEAD `d731fe9b1b0d089d306a123f9571bd6e715af6e7`、workflow **completed / success**。ジョブ最終ステップ「H29 real Auth anonymous clubs and public group access (read-only)」 **success**。H29ログ `pass:14, fail:0` を現物確認。

| H29の実際のチェック | 結果 |
| --- | --- |
| 既存Stage専用2アカウントで実ログイン/Auth `getUser` | 2/2 PASS |
| 匿名PostgREST `clubs` 直接SELECTは401/42501拒否 | PASS |
| 匿名 `club_members` 直接SELECTも401/42501拒否 | PASS |
| 実ログイン2アカウントで公開グループ検索はHTTP200・2件・最小5列 | 2/2 PASS |
| 未所属の公開グループを検索結果から選べる | PASS |
| 未所属の公開グループ詳細を必要列だけでHTTP200取得 | PASS |
| 公開名簿RPCの返却が `reference/display_name/is_unlinked` の3列だけ | PASS |
| 公開人数RPCが数字2を返す | PASS |
| 匿名公開名簿RPCは401/42501拒否 | PASS |
| 匿名公開人数RPCは401/42501拒否 | PASS |
| 匿名 `get_shared_event` の無効token（event/official）はHTTP200・NULL | 2/2 PASS |

**合計14件PASS、0件FAIL**。実際の2アカウントのパスワード・JWT・名前、発見したクラブID、公開名簿はログに記録しない。GitHub Actionsが一部のテストアカウント識別子をマスクする場合がある。

**未確認**：有効tokenによる実Stage共有の正例（Stage `events` 0件で専用フィクスチャなし）、実ブラウザ/UI/実機、固定ペア/ScoreInput、Stage DB外バックアップと隔離復元。今回のHTTPはSDK経由であり「ブラウザ操作完了」ではない。H28匿名拒否と公開表示のDB・API権限上の受入に限定。

## 2. H28 Stageデータの事後確認（READ ONLY）

H29 CIの後にStage SELECTのみ実行し、`clubs=3 / club_members=12 / player_profiles=12 / events=0`、Migration履歴`71`、H28 migration 1件、`anon`の`clubs` SELECT列権限なし、匿名`get_shared_event`のEXECUTEは維持、`fixed_pair_private`未導入を確認した。Prod DBは**今回一切操作していない**。

## 3. Stage匿名SECURITY DEFINER関数12件の読み取り専用棚卸し

Stageのpg_proc / `has_function_privilege('anon',oid,'EXECUTE')`から対象12件を取得し、ロール、引数、関数定義をREAD ONLYで確認。**アドバイザー警告の件数は「脆弱性12件確定」ではない**。関数ごとに入出力・認可・トークンと悪用防止を判定する必要がある。

| 用途 | 関数 | 調査で確認した性質・次の判定 |
| --- | --- | --- |
| チームイベント権限判定 | `can_manage_friendly_team_event_by_sides`, `can_view_friendly_team_event_by_sides` | `auth.uid()` / 役職・所属条件を持つboolean関数。匿名での0-ID/任意ID応答など実HTTP拒否/値判定は未実施。即一括REVOKEはしない |
| 動画クリック数集計 | `get_event_video_click_counts`, `get_event_video_link_click_counts`, `get_official_video_click_counts` | 内部で`auth.uid()`に基づく運営者/メイン管理者判定があり、匿名の集計行露出はSQL上想定されない。ただし**匿名実HTTPでの0行**は未検証 |
| 共有トークン閲覧 | `get_shared_event`, `get_shared_event_player_names`, `get_shared_official_player_names` | トークン引数の専用公開経路。H29では`get_shared_event`無効tokenのみHTTP NULLを確認。他2件も正規/無効tokenを分けて追加検証 |
| SuperUser判定 | `is_super_user` | `auth.uid()`に依存するboolean。匿名呼出しでの戻りは未実測 |
| 動画クリック書込み | `record_event_video_click`, `record_event_video_link_click`, `record_official_video_click` | **SECURITY DEFINERかつanon EXECUTE可能でINSERTを含む**。対象イベントがclosed・share_enabled・share_token存在・非削除などはチェック。ただし**呼出し側が有効共有tokenを提示した事実の検証は実装上確認できず**、ID指定とuser_agent/referrer（最大500字）で記録を増やせる構造。大量呼出し・虚偽カウント・書込みコストの潜在的リスク。実用条件（ユーザー操作・クリック記録の仕様・メトリクス用途）を確認するまで勝手にREVOKE/スキーマ変更しない。悪用再現や書込み負荷試験はしていない |

**特に注意**：3つのクリック記録関数には`share_token IS NOT NULL`の条件はあるが、これは「イベントにトークンが設定されている」ことの確認に過ぎず、「呼び出した人が正規のトークンを所持している」ことを証明しない。既存正常な動画リンククリック計測を維持したまま、トークン検証/不正書込み抑制/レート制限案を別工程で検討する。

## 4. 次の安全な順序

1. Stageの公開グループ認証済み正例と匿名拒否は、**実HTTPの範囲ではH29でPASS**。ブラウザと実機は別ゲート。
2. 共有token正例は、既存Stageテストクラブや本番実履歴を上書きせず、隔離した合成イベントの作成・削除手順およびDB外バックアップを用意して別回で実施。正規token未確認をPASSとしない。
3. 動画クリック記録RPC3件は、認可条件/呼出し経路/悪用抑制を最小変更で設計し、通常/公式/チーム共有、クリックカウント維持、匿名不正書込みの試験計画を作成。**実DBへの権限変更や計測機能の無断停止はしない**。
4. Stage固定ペア0040〜0043正式移行は、`110_p0_stage_backup_restore_gate.md`のDB外バックアップと隔離復元ゲート未通過で引き続き**NO-GO**。
5. 本番の匿名基底SELECTのP0は未修正。互換RPC→アプリ切替→実受入→旧匿名権限遮断の順を維持し、Prod変更・mainマージ・Cloudflare本番デプロイは**ユーザー明示承認まで禁止**。

**現在：PR #265 Draft/OPEN・未マージ、H29 Stage実HTTP 14/14 PASS、本番P0 OPEN。**
