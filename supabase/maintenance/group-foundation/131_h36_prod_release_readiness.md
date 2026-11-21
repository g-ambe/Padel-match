# TASK-08 / H36 本番リリース判定（2026-11-21）
対象：既存Draft PR #265 / Issue #264。今回の記録は**READ ONLYによる本番確認**とリリース手順の整理のみ。実本番SQL・マージ・デプロイは未実施。

## 判定
**NO-GO：PR #265を今すぐmainへマージ・Cloudflare本番配信しない。**
原因は過剰な追加セキュリティ要件ではなく、**本番DBと現在のアプリが要求する取得RPCの契約不一致**。

- PR #265：225ファイル、386コミット、Draft、未マージ（照会時）。最新HEAD `cb2ada7c6cff2d2879462d8d094136cbf1ff5c9f`。
- 現HEADに紐付くGitHub Actionsの「Profile media isolated checks」は成功。H34の実HTTP＋375pxブラウザ受入は従前のコミット [44873920056](https://github.com/g-ambe/Padel-match/actions/runs/44873920056) で成功。H35 Stage SQL権限はDBで独立検証済み。PR全体の本番互換テスト成功という意味ではない。
- Supabase：Prod `ntczrmvffmpjzilfebyi` / Stage `zzjwpresqkefnyjyisgd` に**同じ既存READ ONLY** `103_p0_stage_prod_parity_readonly.sql` を実行して比較。Prod migration履歴22件、Stage74件。単なる履歴件数差は移行対象を自動決定する根拠に使わない。
- StageにありProdにない主要公開RPC：`get_shared_event`、`get_club_roster`、`get_public_club_directory`、`get_public_club_member_count`、`get_my_player_profiles`、`save_my_player_profile`、`leave_my_club`、`respond_club_owner_transfer`、`review_player_profile_link_named`、動画クリック用token-bound 3 RPC。少なくとも共有画面・グループ画面・プロフィール編集等でProd切替前の導入が必要。
- 対照的にProdにありStageにない既存機能：固定ペア系3表、ラウンド操作系2表、プロフィール非公開画像系4表、施設追加5列、動画・画像・ホームコートの関数等。施設マスターはProd24件、Stage9件。**Prodの既存機能・データを削除、初期化、Stageへ置換しない**。
- Prodは本番の匿名基底表SELECTがStageより広い（既存のREAD ONLY差分再確認）。ただしこのP0改善のために無差別の一括REVOKEをしない。認証済み試合運営・プロフィール・イベントの継続を最優先する。
- H34 Stageの検証fixtureはH35で全削除済み（Stage events0、official_events0、クリック0/0/0、clubs3、members12、player_profiles12）。H35旧クリックRPCの匿名EXECUTEはStageのみ停止済み、新token-bound 3 RPCの匿名実行は維持。本番は未適用。

## 最短で進める順序
1. **既存アプリの依存RPCのみ抜き出す。** PR #265にある公開グループ・本人プロフィール・所有者移管・共有画面の呼出先と、Stageで既に動く定義を対応付ける。既存契約が揃っていればCodexによる機能追加は不要。既存仕様を改変しない。
2. **Prod互換のDB追加SQLを構成・検証する。** 既存 `0054〜0065` と `54_h12_prod_compatible_rpc_candidate.sql`、正式 `20261120091138`(新クリックRPC)→`20261120094347`(referrer最小化) を元にし、既存Prodスキーマ・関数と衝突しない部分のみ、**旧機能を変更せず追加**。H12 `get_shared_event` は候補SQLだけで、**正式なリリース用移行と本番適用は未完了**。現状のマイグレーションを一括db pushしない。
3. **本番へのRPC先行導入→実HTTPで正負例。** 適用前に実際の対象DDLとロールバック方法を確定し、ユーザーの本番反映判断を得る。導入時は既存の匿名SELECT/旧RPCを急に閉じない。公開/非公開/イベントのうち少数の必要な動線だけで実認証＋匿名検証する。
4. **PR全体の既存機能互換を確認後にマージ・公開。** Cloudflareの自動デプロイ有無を確認。スコア/GP、固定ペア、公式・通常・チーム戦、プロフィール画像、公開グループ、3タブ、共有リンクの最低限の回帰を行う。既存失敗（プロフィールのfixture整合等）は今回追加された失敗と区別して判断。
5. **新しい共有画面が配信された後に旧匿名クリックRPCを閉じる。** H35正式SQLはProd配信順序の最後に置く（`20261121131943_task08_h35_legacy_video_click_anon_close.sql`）。匿名base表の閉鎖をする場合も影響のある画面ごとに実施し、無差別な権限変更をしない。

## 明確な非対象
今回のリリース準備のために、StageへProd画像/R2・固定ペア・施設全件を再生成すること、旧スコア6件を自動修正すること、追加のセキュリティ監査・全機能再実装、別PR/重複Issueを作ることはしない。

## 今回の操作範囲
**Stage/ProdともREAD ONLY、GitHubへのこの調査報告追加以外は変更なし。** PR #265は引き続きDraft。次の実装対象は本番互換の欠落RPCの最小パッケージ化であり、完成前の本番デプロイは行わない。
