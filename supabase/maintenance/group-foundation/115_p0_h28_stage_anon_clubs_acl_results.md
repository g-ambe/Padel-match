# TASK-08 / P0-H28：Stage公開グループの匿名直接SELECT遮断 — 実適用結果

2026-11-20 JST。対象は **Supabase `padel-hub-staging` のみ**。既存 `codex/task-08-group-foundation` / Draft PR #265 / Issue #264、`AGENTS.md` に従う。本番 `padel-hub`・Cloudflare本番・アプリUI・スコア・GP・認証済みRPC・mainは未変更。

## 1. 仕様と不整合の確定

- Issue #264の確定要件：**「未所属でログインしているユーザー」**に限り、公開グループの概要/メンバー一覧を閲覧可。匿名ログインなしでの公開グループ検索・メンバー一覧を要求していない。
- 現コードの`app/groups/discover/page.tsx`は`supabase.auth.getUser()`に未ログインならトップへ戻す。 `app/groups/[id]/page.tsx`も`auth.getUser()`から本人IDを検証した後に公開概要/最小名簿を取得する。
- 既存の `supabase/maintenance/rls-clubs-select/README.md` は、公開クラブの検索を**ログイン後**とし、匿名で`clubs`を直接一覧取得したときの期待値を**0行**と記載。匿名の非公開公式戦共有名はtoken検証付きの専用RPCで扱う設計。
- H27実Stage匿名ロールでは`clubs`の公開2行が取得可能。匿名は`created_at/deleted_at/description/id/image_url/is_active/is_deleted/main_facility_id/name/visibility`の**10列**のSELECT権限、`security_public_clubs`（TO anon）RLSを保持。合意されたUIとDB公開範囲に差分。
- Stage共有ページは`get_shared_event(p_token,p_kind)`の専用token RPCで取得。RLS/ACL変更前のメタデータ検証で`anon`の関数EXECUTEを確認。新しい匿名公開機能を追加しない。

## 2. 今回の実施内容

1. `113_p0_h28_stage_clubs_anon_acl_apply.sql` を既存PRに追加（`fa7c36b`）。**Stage特有のオブジェクト有無、共有RPC、対象ポリシーと正確な10列GRANT、既存authenticated公開検索ポリシーを厳格に確認**。想定外のカタログなら中断。 `REVOKE SELECT(10列) ON public.clubs FROM anon` と `DROP POLICY security_public_clubs ON public.clubs`のみ実施し、匿名遮断/認証済み閲覧/共有RPCの事後条件をチェック。
2. 非自動実行の切り戻し `114_p0_h28_stage_clubs_anon_acl_rollback.sql`（`ad27c18`）を保存。**このスクリプトは匿名への直接閲覧を復活させるため、障害と原因の確認なしに実行禁止**。事前条件を満たすときだけ対象の10列と`security_public_clubs`を戻し、他のポリシーや表・データは削除しない。今回ロールバック実行はなし。
3. `padel-hub-staging` に**上記113ファイルと同じSQL**を `apply_migration`で適用成功。Migration名は`task08_h28_staging_close_anonymous_club_metadata`、履歴version `20261120073249`。**本番には一切適用なし**。
4. Stageに適用前のREAD ONLY preflight を別実行：Stage識別/RPC、ポリシー、10列と他の匿名SELECTポリシー不在、認証済み閲覧条件、共有RPC、Migration履歴70のチェックがすべて期待値。
5. Stageに適用後のREAD ONLY/role試験を実行。元の3クラブ・12所属・12選手プロフィール・0イベントは維持。Migration履歴は71。 `fixed_pair_private`は不存在のまま。アプリ/UIのコード・DBデータ・他のRLS/共有RPCの変更なし。

## 3. Post-apply確認

| 判定 | 事後実測 | 評価 |
| --- | --- | --- |
| `anon`の`public.clubs` SELECT列権限 | 0列 / `has_any_column_privilege(...,'SELECT')=false` | PASS |
| `anon`対象RLS SELECT/ALLポリシー | 0件 | PASS |
| `BEGIN READ ONLY; SET LOCAL ROLE anon; SELECT COUNT(*) FROM public.clubs;` | **42501 permission denied for table clubs** | **拒否が正しい：PASS** |
| `BEGIN READ ONLY; SET LOCAL ROLE authenticated; SELECT COUNT(*) FROM public.clubs;` | **公開2行が可視** | PASS（ロール模擬。実ログインJWTではない） |
| `anon`の`get_shared_event(text,text)` EXECUTE | true | PASS |
| `anon`の`get_shared_event(無効token,'official')` | SQL NULL | PASS（無効token負例のみ） |
| `anon`の`get_public_club_directory` / `get_public_club_member_count` EXECUTE | 両方false | PASS |
| `authenticated`の`clubs.name/visibility` SELECT・公開検索RLS | 維持 | PASS（権限確認。実UIではない） |
| Stage件数（clubs/member/profile/event） | 3/12/12/0、変更なし | PASS |
| Stage Migration履歴 | 70→71、追加した名称一致 | PASS |

**区別するもの**：role切替と無効tokenのDB試験は、実HTTPやWebブラウザの検証ではない。正規の共有token正例はStageに実イベントがなく**未検証**。プロジェクト全体の匿名アクセス対策や本番P0の解消を意味しない。

## 4. セキュリティ Advisor（今回の変更後にStageで取得）

- `rls_enabled_no_policy` INFO 1件（`club_owner_transfer_requests`）、`function_search_path_mutable` WARN 1件（`set_user_preferences_updated_at`）。
- `anon_security_definer_function_executable` WARN 12関数、`authenticated_security_definer_function_executable` WARN 52関数が報告された。**これは機能の必要なRPCも警告対象となる可能性があり、それだけで脆弱性確定ではない。** 特に `get_shared_event` の匿名EXECUTEはtoken付き共有のための仕様上必要な経路。
- 一括REVOKEや`SECURITY INVOKER`への機械的変更はしない。機能別の引数・返却値・本人認可・token検証を個別調査する。

## 5. 未完了と次の工程

- **Stage H28**：通常の認証済みユーザーによる実Auth/REST/画面の公開検索・詳細の正例、匿名REST拒否、共有の**有効token正例**は追加確認。今はロール/DB試験のみで実機受入を主張しない。
- **P0全体**：Prodの`club_members/player_profiles/profiles/official_events`等の匿名列SELECT/RLS行可視性は未是正。本番移行は互換RPC導入→アプリ切替→実Auth/共有正負例→旧匿名base SELECT遮断の順。**本番変更は別途ユーザー明示承認が必要**。
- **固定ペア**：0040〜0043 Stage確定導入は`110`のDB外バックアップ/隔離復元ゲート未通過につきNO-GO。今回の小さなStage匿名clubs権限修正を「固定ペアのMigration適用許可」と混同しない。
- GitHubのIssue/PRに報告後も **PR #265 Draft/OPEN・未マージ**、Projects #2フィールド更新は未実施。新規PR/ブランチなし。
