# TASK-08 P0 / H23：Codex向け「匿名・認証済みDB消費者」棚卸し（コード改修前の調査のみ）

AGENTS.md、Issue #264／#215、既存Draft PR #265、`supabase/maintenance/group-foundation/103_p0_stage_prod_parity_readonly.sql` と `104_p0_compatible_cutover_sequence.md`を正本にする。最新作業ブランチ`codex/task-08-group-foundation`を使い、**新規PR/ブランチ、mainマージ、本番DB/Cloudflareデプロイは行わない**。

**この依頼はコード・DBの変更を伴わない棚卸し。アプリ機能を勝手に変更しない。実行中の他機能を触らない。**

## 調査対象

1. 匿名の共有導線：`app/share/events/[token]`、`app/share/official-events/[token]`、共有関連のlib、関連API routes。公開トークンの検証がない`events`/`official_events`/`matches`/`match_results`/`club_members`/`player_profiles`などの直接SELECTがないか。
2. 公開グループ：`app/groups/discover`、`app/groups/[id]`、`lib/group-read.ts`、`lib/group-detail.ts`。未所属/匿名に内部メンバー名・役職・戦績・画像・token原文を返す直接SELECT/fallbackがないか。認証済み・公開クラブの`get_public_club_directory`と`get_public_club_member_count`を使う現H22仕様を維持。
3. 認証済み管理と試合：`lib/player-profiles.ts`、`app/events/[id]`、`app/official-matches/[id]`、固定ペア、ラウンド・スコア・チーム戦。匿名base SELECTを閉じても**正当な本人/運営のSELECT/UPDATE/INSERTが壊れない**よう、各アクセスの必要列と認証要件を整理。
4. 画像/R2：プロフィール非公開画像の本人のアップロード/読取/削除経路、Cloudflare R2・アプリの権限境界。グループ内限定での他人画像表示はまだ未実装のため**勝手に追加しない**。
5. エラー時のfallback：RPC不明/404/42501/通信断の際に`supabase.from()`で広域base tableを再取得する処理がないか、匿名でも管理者データを取得できる経路がないか。

## 報告形式（Issue #264コメントでよい）

各呼出しについて **ファイルパス・行番号・利用者条件（anon/auth/owner/member）・DB table/RPC・読取/書込・必要な最小列・実装済の安全な代替・潜在的な破壊影響・変更要否** を1行に整理。特に本番P0の匿名アクセスを遮断した際に**動かなくなる公開・共有機能があるか**を明示。

既に安全なRPCへ移行したものには**「対応不要（理由）」**と記載。Stageに`0040〜0043`固定ペア関数・`0048〜0051`画像機能がないことは既知で、StageでのE2E不能とアプリバグを混同しない。

DB schema/RLS/Migration/Cloudflare設定を**変更しない**。公開仕様・本人同意・イベント共有の意味を**推測して拡張しない**。H15～H22、現行3タブ、ランキング・スコア・GP、関連チュートリアルを変更しない。

調査後、修正が必要な部分だけGPTがDB権限と照合して最小変更を指示する。**実装開始・本番変更・PRマージは行わず、結果報告まで。**
