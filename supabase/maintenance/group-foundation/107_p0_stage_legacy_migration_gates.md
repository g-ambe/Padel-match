# TASK-08 / P0-H24：既存本番機能を保つための Stage 0040・0047～0051 導入前検証

2026-11-20。既存 Draft PR #265 のみを更新。Issue #264 / #215、AGENTS.md、`104_p0_compatible_cutover_sequence.md` の次工程。**Prod変更・mainマージ・本番デプロイなし。**

## 今回の確認方法（安全のため検証と導入を明確に分離）

- 正式Migration `supabase/migrations/0040_event_fixed_pairs.sql`、`0041_atomic_round_lineups.sql`、`0042_round_lineup_safety.sql`、`0043_match_results_one_per_match.sql`、`0047_event_result_video.sql`、`0048_private_profile_media.sql`、`0049_profile_avatar_position.sql`、`0050_private_profile_home_court.sql`、`0051_shared_home_facility.sql` のGitHub現物を閲覧。
- 再実行可能な `106_p0_historical_migration_preflight_readonly.sql` をStage・Prodの両方へ**同一SQL・BEGIN READ ONLY / ROLLBACK**で実行。対象テーブル名・ポリシー名・トリガー個数・RPC存在・試合結果重複数を取得し、イベント・選手・R2オブジェクトの個別データ本文は取得していない。
- `0047`単独と`0048`単独について、原本のBEGIN～COMMITを**BEGIN + SET LOCAL lock_timeout 5s + statement_timeout + ROLLBACK**に置換してStageで試験した。
- `0048→0049→0050→0051`の原本順で、各ファイルの外側のBEGIN/COMMITだけを取り除き、**一つのBEGINから最後にROLLBACKする**連続DDL試験を実施。原本の関数・ポリシー・列定義は変更していない。**Stageへ確定適用していない**。SQLテキストのGitHub参照が前提であり、手動の差分なしに再実行すること。
- 全DDL試験の後にStageで別のREAD ONLYクエリを実行し、生成されたschema/関数/テーブルが**残っていないこと**、元のclubs3/members12/profiles12/events0・migration履歴70が変わっていないことを確認。

## 検証結果：固定ペア系 0040～0043

| Stageの条件 | 原本0040の要求 | Stageの実測 | Prodの実測 |
| --- | --- | --- | --- |
| 重要テーブル（events/participants/rounds/matches/players/results） | 6表すべてRLS有効 | 6/6 | 6/6 |
| `ALL`型の広いRLSポリシー | 0件 | 0 | 0 |
| `rls10_events_update_members` | 1件必須 | **0** | 1 |
| `guard_event_identity`・`guard_event_member_fields`・`guard_participant_identity`・`guard_match_identity`の有効トリガー | **7件必須** | **0** | 7 |
| 固定ペア用schema | 初回導入時未存在 | なし | 導入済み |
| match_resultsの同一match_id重複 | `0043`適用前に0件 | 0 | 0 |

**結論：Stageへ原本0040をそのまま適用できない（原本の事前ガードが拒否）**。`0041`は0040関数が前提、`0042`は0041関数と編集停止が前提、`0043`は0042と結果重複解消が前提。今回はStageでもいずれも適用していない。

**追加の注意（Stage RLSの合成挙動）**：Stageの現行イベント更新は `security_minimal_events_update`（`PERMISSIVE`、`USING/WITH CHECK security_private.can_operate_event(id,false)`）。この関数は、activeの制約を緩めても非削除・event_modeごとの権限を検証する。Prodの`rls10_events_update_members`は**別のPERMISSIVE UPDATEポリシー**であり、権限を比較しないままStageに追加すると PostgreSQL の同種PERMISSIVEポリシーが**ORで合成**され、既存より広い操作を許可し得る。固定ペア原本0040の「必要なポリシー名が存在する」チェックを通すためだけの追加は禁止。さらに原本の7トリガーのうち一部はStageの`security_minimal_event/security_minimal_parentage`と機能が重なるため、二重登録による正常操作への影響を分離して試験すること。

Stageが無保護という意味ではない。Stageは別実装の `security_minimal_events_update`、`security_minimal_event`、`security_minimal_parentage`、`profile_link_participant_reference` 等で保護されている。ただし**本番の原本トリガー7件・ポリシーと実装が異なる**。原本のガード値だけを合わせるために同名の空トリガー/広いRLSを追加したり、Stageの匿名SELECTを復活させることは禁止。既存H12～H22を壊さず、ProdのID保護・role/関係性制御を再現する**Stage専用互換パッチ案**と回帰を先に作る必要がある。

## 検証結果：チーム動画0047、本人画像0048～0051

- **0047のStage単独DDLのROLLBACK試験：PASS**。`save_friendly_team_match_video`の関数は確定導入されていない。
- **0048単独のStage DDL ROLLBACK試験：PASS**。
- **0048→0051のStage連続DDL ROLLBACK試験：PASS**。`profile_media_private`・privateメタテーブル・avatar位置・home court・施設マスターの追加カラム・RPCに構文/DDL上の依存欠落は確認されなかった。
- **成功の範囲に注意**：この結果は「SQLが1トランザクション内で作成できる」ことだけを意味し、R2/Workersによる本人画像アップロード・読取・GC・権限判定、媒体とDBの最終整合、運用secretの設定、バックアップ/復元、正常な既存施設9件→24件への補正を確認したものではない。
- Prodの`profile_media_private.settings`は認証・commit proof用の設定レコードが1行あることだけを件数確認。**hash・proof・秘密情報そのものは取得していない**。Stageに本番secretやR2画像をコピーしない。Stage専用のsecret/バケット連携と、メディアのリカバリー手順が用意できるまでは画像本適用を行わない。
- 連続DDL試験後のREAD ONLY：Stageの`fixed_pair_private`、`lineup_private`、`profile_media_private`は依然不存在。`player_profile_private`、`profile_media_objects`、`save_friendly_team_match_video`、施設`facility_key`も不存在。Stage既存件数・migration履歴70は変化なし。ProdもREAD ONLY以外は未操作。

## 次に行うこと（順番を変えない）

1. **GPT：Stage用の本番イベント/試合ID保護との互換設計**。Prodトリガー4関数/計7トリガーと`rls10_events_update_members`を、Stageの `security_private.guard_event/guard_parentage` および現存RLSと比較し、匿名無許可・本人/管理者の認可・オーナー/参加者ID不変・イベント名編集・退会を保てる最小前進Migration案を作成。**事前ROLLBACKとStage専用の実Auth負例/正例テストなしに確定適用しない**。
2. **Codex：ソース利用者の棚卸しだけを先行**。既存 `105_p0_codex_anon_access_consumer_audit.md`に従い、共有・公開グループ・固定ペア・画像・チーム戦の匿名/認証済みの取得列・RLS依存とfallbackをファイル/行単位で報告。現時点でアプリ修正・DB改修を勝手に行わない。
3. **GPT：0040～0043のStage専用バックアップ/復元ゲート**。Stageの既存テストAuth/club/プロフィールを復旧可能な方法と、DB外のバックアップ手順を確立してから、原本が要求するロック・事前ガードを満たす環境にのみ適用。テスト用データを確定保存する場合は個別の掃除・検証SQLを用意。
4. **GPT＋Codex：画像0048～0051は独立工程**。Stage専用R2 credentials/commit proof・GC/削除運用を確認し、本人限定・非本人拒否を実HTTP/実ブラウザで検証した後、確定適用可否を判断。データベースとR2が別システムのため、DB ROLLBACKだけで画像物理オブジェクトの削除/復元は保証されない。
5. **ユーザー：本番適用の最終承認**。既存固定ペア・画像履歴と通常/公式試合の動作を保持する移行計画、バックアップ・戻し方、Stage全回帰、P0匿名漏出の拒否を確認してからのみ本番。

**現時点：P0匿名公開はProdで未修正。Draft PR #265未マージ、本番DB・Cloudflare本番未変更。**
