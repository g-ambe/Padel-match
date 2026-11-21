# TASK-08 / P0-H27：Stage/Prod ACL・イベントID保護パリティ再監査（2026-11-20）

関連：Issue #264、Draft PR #265、`AGENTS.md`、`104_p0_compatible_cutover_sequence.md`、`107_p0_stage_legacy_migration_gates.md`、`108_p0_0040_0043_shadow_security_rollback_result.md`、`110_p0_stage_backup_restore_gate.md`。

**判定：Stageの旧固定ペア0040〜0043確定導入は依然 NO-GO。本番P0匿名基底表の権限是正は未実施。** 認可条件・列ACL・ID保護を実プロジェクトに対してREAD ONLYで比較し、今後の最小安全移行条件を具体化した。今回のSQLはSELECTのみ（別途Stageの `BEGIN READ ONLY; SET LOCAL ROLE anon; SELECT COUNT(*); ROLLBACK;` も使用）。個別の氏名・ID・共有token・画像キー・秘密情報・行本文は取得していない。

## 1. 現在のStage/Prod監査値

対象：`padel-hub-staging` と `padel-hub`。既存ブランチの **`111_p0_h27_stage_prod_acl_identity_readonly.sql` を同じ内容で両環境に実行・成功**。再実行するときも両環境の結果は別々に扱い、全テーブルを網羅した証明と誤認しない。

| 調査項目 | Stage | Prod | 解釈 |
| --- | --- | --- | --- |
| 13表のうち、anonにSELECT可能な列が1つ以上ある表 | `clubs` の1表 | 13表全部 | **`has_any_column_privilege`**での列ACL比較。行可視性は別のRLS試験を要する |
| 13表のうち、anonの表レベルSELECTがある表 | 0 | `clubs`, `club_members`, `player_profiles`, `official_events`, `official_matches`, `official_opponents` の6表 | 表レベル許可がなくても列許可があればAPI SELECTに使える可能性がある |
| Stageの`events` UPDATE RLS | `security_minimal_events_update` 1件（PERMISSIVE） | PERMISSIVE 4件（`events_super_user_update`, `events_update_creator_or_group_admin`, `events_update_friendly_team_match_managers`, `rls10_events_update_members`） | **ProdのポリシーをStageへ機械的に追加しない**（OR合成と権限拡大） |
| 6表に存在するユーザー定義トリガー | 6 | 16 | 設計が相違。単純な数一致を目標にしない |
| 原本0040が必須とする旧ID保護7トリガー | 0 | 7 | Stageへ原本0040をそのまま適用不可 |
| `fixed_pair_private`, `lineup_private`, `profile_media_private` | すべて不存在 | すべて存在 | Stageの機能パリティ未成立 |
| `matches`, `rounds`, `match_players` のサンプル主要列への authenticated UPDATE | すべてfalse | すべてtrue | StageのAPI直UPDATEとは非互換。ただしStageの専用RPCによる操作は別に検証し、直UPDATE権限が必要と**推定しない** |

## 2. Stageの公開クラブ閲覧を追加確認

`public.clubs` はStageでもRLS有効。Stageには `security_public_clubs` という **TO anon / SELECT** のPERMISSIVEポリシーがあり、条件は `is_active AND NOT is_deleted AND visibility='public'`。anonは`id/name/description/visibility/main_facility_id/image_url`等の列SELECT許可を保有（`owner_id`にはSELECT許可なし）。

Stageのみで以下の**ロール切替付きREAD ONLY / COUNTのみ**を実行し、`current_user='anon'`・可視クラブ **2件** を確認：
`BEGIN READ ONLY; SET LOCAL ROLE anon; SELECT current_user, count(*) FROM public.clubs; ROLLBACK;`

**設計要確認**：現行画面 `app/groups/discover/page.tsx` は `auth.getUser()` でログインを要求し、`app/groups/[id]/page.tsx` の未所属公開閲覧もログイン必須。一方Stage DBは匿名でも公開グループ概要の一部列を取得できる。**ログイン要求をAPI側にも徹底するべきか、匿名への最小公開を認めるかは過去の承認済み仕様と照合**する。勝手にログイン不要へ変更しない、また緊急に本番の`clubs` ACLをCOPY/REVOKEしない。これは`club_members`・内部戦績・プロフィール画像の匿名SELECT許可を意味しない。

## 3. ID保護トリガー差分（実際の関数・定義をREAD ONLYで確認）

- Stage `security_private.guard_event`：`events` INSERT/UPDATEでID/club_id/created_by_auth_user_id/**created_at**変更を制限。設定変更は管理者判定、削除・共有状態にも制限。単なる「IDガードなし」ではない。
- Stage `security_private.guard_parentage`：`event_participants`では `id/event_id/created_at/player_profile_id/profile_id/participant_type` を保護、`match_results`では `id/match_id/created_at` を保護。付随のプロフィール参照・親整合チェックあり。
- Stage `rounds` / `matches` / `match_players` にはProd相当の `guard_match_identity` が未登録。ただし今回対象としたauthenticated直接UPDATE列は**すべて許可なし**なので、この事実だけで「認証済み利用者が直接ID改ざんできる」とは言わない。SECURITY DEFINER RPCを含めた実際の操作・トリガー優先順序は別検証。
- Prodの4関数：`events_identity_private.guard_event_identity`、`events_operation_private.guard_member_fields`、`participants_identity_private.guard_identity`、`match_identity_private.guard_identity`。有効旧ID保護トリガー7件：events 2、event_participants 1、rounds 1、matches 1、match_players 1、match_results 1。いずれもSECURITY INVOKER。
- StageとProdではイベント管理者の役職判定や認可モデルが異なる。**Prodの関数・PERMISSIVEポリシー・列GRANTをStageに丸ごと移植しない**。H25の実験的な旧名RESTRICTIVEポリシーは同名ガードの通過用仮案であり、恒久設計承認ではない。

## 4. 工程と停止条件

1. **Stageの匿名クラブ閲覧の仕様照合**：ログイン必須画面の要件と、DBの `security_public_clubs` / 列GRANTの整合を確認。匿名公開する場合の最小列を確定。現在の2行の可視性は事実として保持する。
2. **0040〜0043のStage互換設計**：旧ID保護と既存Stageガードが重複した際の発火順序・カラム禁止条件、固定ペア/チーム/公式を含むアプリの認証済み利用権限を正負例で確認。`matches/rounds/match_players` の直接UPDATE権限を安易に本番同等へ広げない。
3. **DB外バックアップと隔離復元が必須**：`110`のチェックが未通過。現状は**Migration確定適用禁止**。H25のROLLBACK 8/8は過去の限定試験であり今回の実Auth・一括回帰を代替しない。
4. **本番P0 cutover**：事前に本番既存機能と新RPC互換を満たし、正規/無効共有tokenや本人/運営実Authを検証してから、最後に匿名base-tableアクセスを遮断。現行の本番での匿名露出は未修正。
5. GitHubの既存 `codex/task-08-group-foundation` / Draft PR #265 / Issue #264 のみ管理。アプリ・DB・Migration・RLS・Cloudflare・R2の操作は今回なし。新PR/ブランチ、mainマージ、デプロイなし。

## 5. テスト区分・今回の成果

- **PASS**：`111`のSELECT-only監査SQLをStage/Prodへ同文で実行。Stage `anon` roleの`clubs` COUNT-only ROLLBACK試験。Stage/Prodのイベント関連関数定義・トリガー定義の読み取りと比較。
- **未実施**：バックアップ取得/復元実演、StageのMigration適用、実Stageの通常/固定ペア/ScoreInput E2E、デプロイ、全アプリテスト。匿名クラブアクセスは**DBロール試験**であり、実HTTP/ブラウザのチェックではない。
- **結論**：セキュリティ/機能パリティの確認材料を前進させたが、**本番匿名base-table P0・Stage復旧ゲートはいずれも未完了**。PR #265はDraftのまま維持する。
