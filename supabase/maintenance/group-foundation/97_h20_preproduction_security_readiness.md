# TASK-08 / H20 本番移行前セキュリティ監査・停止条件（2026-11-20）

対象：[Issue #215](https://github.com/g-ambe/Padel-match/issues/215)、[Issue #264](https://github.com/g-ambe/Padel-match/issues/264)、既存[Draft PR #265](https://github.com/g-ambe/Padel-match/pull/265)の `codex/task-08-group-foundation`。**本書は調査・計画であり、Prod DB変更・本番デプロイ・マージの承認ではない。** 既存AGENTS.mdに従う。GPT＝DB/Stage/権限検証、Codex＝UI/APIアプリ変更、ユーザー＝本番リリース判断。

## 監査範囲・再現方法

- `96_h20_prod_cutover_readonly_gate.sql` を**同じSQL**でSupabase Stage `zzjwpresqkefnyjyisgd`とProd `ntczrmvffmpjzilfebyi`に実行。どちらも `BEGIN READ ONLY`、`ROLLBACK`のみ。認証済み/匿名の表・列SELECT GRANT、匿名に適用されうるSELECT/ALL RLSポリシー、公開RPCの実在性、publicテーブル名のみ集計。**実データ、個人名、Auth ID、share_tokenなどは抽出しない**。
- `pg_policies`とACLによる「匿名アクセス可能な候補テーブル」は、**返却行が必ず存在するという証明ではない**。行実証は既存の `47_h12_no_header_anon_acl_probe.sql`、Stage実HTTPの限定ケース等と区別。列単位GRANTがある表は「テーブル全体のGRANTがfalse」でも閲覧可能なので `has_any_column_privilege`も検査。
- Stageのpublic relationは**33種類**、Prodは**40種類**。`get_shared_event`、`get_club_roster`、`get_public_club_directory`、`leave_my_club`、`review_player_profile_link_named`、`respond_club_owner_transfer`の6RPCは**Stageに存在／Prodでは全て未導入**。Stageの全PASS＝本番相当の全機能PASSとは扱わない。
- 匿名SELECT候補：**Stage 4表**（`clubs`、`health_check`、`padel_facilities`、`user_preferences`）／**Prod 19表**（`club_members`、`event_participants`、`event_team_guests`、`event_team_matches`、`event_team_sides`、`event_video_links`、`events`、`health_check`、`match_players`、`match_results`、`matches`、`official_events`、`official_matches`、`official_opponents`、`padel_facilities`、`player_profiles`、`profiles`、`rounds`、`user_preferences`）。**一律削除対象ではない**。施設マスター等、正当な匿名読取が必要なものは残す。
- P0不整合の中核はProdの`club_members`**anon table-level SELECT + anon/ authenticated `USING(true)`**、`player_profiles`**anon SELECT + active広範囲ポリシー**、`profiles`**匿名に列単位SELECT + anon/ authenticated `USING(true)`**、`official_events`と`official_matches`（既存共有トークンによる行制限が不十分）、それらを参照する`official_opponents`／試合/イベント基底関係など。共有リンクのtokenチェックが不要な表直接読取の実症状は以前の`47_h12_no_header_anon_acl_probe.sql`に記録。Prodには新token RPCがない。**ProdへのPR一括マージやSQLの一括REVOKEはしない**。

## Stage・Prodのスキーマ非対称（必須先行解消）

- **Prodのpublicにのみ存在する9表**：`event_fixed_pair_rounds`、`event_fixed_pair_state`、`event_fixed_pairs`、`friendly_match_operations`、`friendly_round_lineup_state`、`player_profile_private`、`profile_media_attempts`、`profile_media_objects`、`profile_media_operations`。
- **Stageのpublicにのみ存在する2表**：`club_owner_transfer_requests`、`public_player_profiles`。
- この差分は単純な不足機能という断定ではなく、**移行履歴・権限・実装の非互換をチェックする必要がある差分**。Stage画像/固定ペアを未再現のまま本番相当の全回帰と称しない。Prod専用テーブルを無条件DROPしない。StageへDDLを追加する場合も依存・費用・テストAuthから検証し、DB変更はGPT担当・本番未適用のまま。

## 実コードへの影響の限定棚卸し

- 既存PR branchの`lib/group-read.ts`はグループ内ロスター・公開ディレクトリ等の専用RPCへ移行済。H15〜H19のStage実Auth、古い名前と本人同意、H12匿名共有は限定シナリオを検証済。
- 依然`lib/player-profiles.ts`は認証済み管理操作に使う`club_members`の直接SELECT/UPDATE、`player_profiles`のUPDATEを含む。認証済みまで一括ACL閉鎖すると、管理画面・プロフィールの稼働機能に影響する可能性がある。
- `app/groups/[id]/page.tsx`は`clubs`の限定列取得・更新、`app/groups/discover/page.tsx`は公開clubsの限定列検索に直接依存。Stageは`clubs`の一部匿名列GRANTを維持している。所有者ID・内部会員名を未所属者向けAPIへ出さない。
- `app/events/[id]/page.tsx`、`app/official-matches/[id]/page.tsx`は認証済みの試合運営で`events`、`matches`、`match_results`、`official_events`、`official_matches`などの直接取得/書込を使用。匿名遮断とauth業務の継続を**別テスト**する。
- 旧匿名共有`app/share/events/[token]`と`app/share/official-events/[token]`は画面から直接base tableを取得しない構成を確認。ただし全イベント種別・動画・ラウンド・ゲスト/公式スコアの互換、実正規共有tokenのHTTP正例が完全に済んだという意味ではない。
- グループ詳細は**いまだ大タブ `グループ管理/メンバー管理/グループ戦績`**。Issue #264確定の`概要/メンバー/戦績`と相違し、コンパクト表示・共通POP・戻り先含め**H20以降のCodex UI残件**。R2本人画像を同グループ現役メンバーだけが閲覧できる拡張も未実装。画像は機密API/R2/キャッシュまで調査し、DOMだけ隠す対策は禁止。
- `#262`メール招待、`#263`任意英数字ユーザーIDは**別タスク／別PR**として管理。旧スコア6例外はユーザー判断で保留し、試合・GP・ランキング変更禁止。

## 段階的な本番移行のゲート（**どれか不成立ならSTOP**）

1. **スキーマ差分とmigration順を完全確定**。Prod既存`0047〜0053`等の個別テーブル、Stage先行`0054〜0064`と共通関数/RLS依存を照合。実行順でDDLの事前`ROLLBACK`、列互換、戻し方を整理。本番の写真・固定ペアの破壊を避ける。
2. **公開仕様と既存アプリ消費者を網羅**。匿名＝公開グループの承諾済み別名/最小DTO・認可済み共有tokenのみ。認証済みはグループロスター、役職管理、イベント/チーム試合、プロフィール操作など既存機能を維持。`club_members`・`player_profiles`・`profiles`・公式/通常/チーム共有の直接匿名SELECT経路を静的＋実Auth/anon HTTPで検査し、依存除去と権限変更を同じリリース単位で管理。必要ならCodex UI/APIとGPT DBの順序を分離してステージングで検証。
3. **Stageで全経路の回帰受入**。匿名直接基底表SELECTは拒否される／正しいtoken共有は最小DTOを返す／無効token・公開OFF・非所属の戦績/会員名/役職/動画URLを拒否／認証済み既存のイベント操作・記録・プロフィール・固定ペア・公式スコア・チーム戦・通知が維持。所有権の本人承諾・ダブルリクエストやプロフィールリンクCASを再試験。プロフィールテスト既知12失敗は原因と修正・明示的受容を判断するまでは**全回帰PASSと主張しない**。
4. **旧連携済み表示名の本人公開同意**。既存linkedで`club_display_name_public_confirmed_at=NULL`は公開名簿へ自動補完しない。Prod実データの影響数を**READ ONLY集計**し、本人への同意導線・公開名簿の一時空欄/省略・管理者への説明とリリース計画を確定。無断プロフィール名コピー・一括同意は禁止。
5. **移行設計レビューと明示的なユーザー承認**。Prodのバックアップ/リストア可否、移行・ロールバック可能範囲（公開済み状態や通知を含む）、既存イベント・人員数の事前/事後スナップショット、RLS/GRANT diff、旧CLI/RPCからの切替順、プレビュー本番環境の接続先を記録。**PR #265の単独mergeやDB Migrationの先行一括適用を行わない**。
6. **本番適用直後の確認ゲート**。重要な匿名表の直接SELECTを本当に拒否できること、正規の共有トークンを持つ場合だけ表示できること、内部管理機能の動作、写真/R2の会員外拒否、ユーザー実機、監視・復旧手順を確認してはじめて完了とする。

### 次に実装すべきタスク

**P0監査の技術結果を基に、本番ACLの実変更より先に**①Stage/Prod欠落テーブル依存の精査、②匿名共有/グループ閲覧経路の受入表と成功用テストfixture整備、③CodexでIssue #264の未完成3タブ・共通POPと戻り導線、④R2同グループ画像の安全な別API設計を**別々に進める**。すべて既存Issue #264へ記録してから担当を分離。Project #2の権限不足同期を完了扱いしない。

**不変の禁止事項**：本番DBへのCREATE/ALTER/REVOKE/GRANT/UPDATE/DELETE、mainマージ、本番Cloudflare deploy、既存戦績の一括変更、正本仕様の勝手な追加・変更。
