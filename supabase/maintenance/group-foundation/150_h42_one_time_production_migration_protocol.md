> **2026-11-22 H44更新：本文中の「Prod等価Branchは費用承認待ち」は旧計画です。有料Branchを作らず、本番schema/ACL/RLS/関数/Migration名だけをコピーする無料GitHub Actions隔離DB方式でPhase1・Phase2の実SQL連続適用が全PASSしました。[H44詳細](152_h44_free_schema_only_prod_migration_rehearsal_result.md) / [Actions #44952613293](https://github.com/g-ambe/Padel-match/actions/runs/44952613293)。利用者行データはコピーしていないため、データ依存の移行挙動・実Auth/HTTPの検証は別に残ります。本文の費用・Branch手順は過去の検討記録として残し、現在の実行方針はH44を優先します。**

# TASK-08/H42：本番Migration二重適用防止・順次試験の確定手順

確認日 2026-11-21／既存 Draft PR #265。**このファイルは検証計画・実行手順であり、Prod向けDDL適用を承認するものではない。**
移行対象：Supabase Prod `padel-hub`、比較：既存Stage `padel-hub-staging`。本番ユーザーデータのコピーはしない。

## 1. 二重適用を防ぐ唯一のサポート手順

| 名称（`apply_migration`の`name`として固定） | 実行するSQL候補 | 前提 | 成功後に確認すること |
| --- | --- | --- | --- |
| **`task08_prod_phase1_additive`** | `147_h41_prod_phase1_additive_candidate.sql` | `149`で`phase1_eligible=true`、Prod既存ACL/構造、ユーザーによる本番GO | 登録履歴`phase1_history_entries=1`、`phase2_eligible=true`、共有/クリック/ロスター/本人退会RPC |
| **`task08_prod_phase2_atomic`** | `145_h40_prod_phase2_atomic_cutover_candidate.sql` | **Phase1登録済み**かつ`149`で`phase2_eligible=true`、旧UI/新UI切替時間確定 | 登録履歴`phase2_history_entries=1`、表示名・人数・オーナー引継ぎRPC、`club_members` anon SELECT不可 |
| H35（切替後） | `20261121131943_task08_h35_legacy_video_click_anon_close.sql` | 新共有UIが本番で正負例/クリック検証済み | 旧3RPCのみanon不可・authenticated可、新3RPCはanon可 |

- `149_h42_prod_migration_replay_gate_readonly.sql`を**各Phaseの前後に必ず実行**する。Stageでは`phase1_eligible=false`、Prodでは（まだ未適用の現状）`phase1_eligible=true`を確認済み。
- 候補SQL `147` と `145` の両方に**Migration履歴ガード**を追加した。Phase1は同名Prod履歴もStageの0054〜0065移行履歴もない場合だけ実行。Phase2はPhase1登録**ちょうど1件**・Phase2未登録・Stage移行履歴なしの場合だけ実行。さらに両SQLに既存機能のDDL/ACL preflight とpostflightがある。**再実行時は失敗して止まる**設計。
- **禁止**：`supabase db push`、旧`supabase/migrations/0054〜0065`をそのままProdへ再適用、Stage専用MigrationをProdへ流用、`supabase db reset`、不足機能を手で一括補完、移行履歴を成否未確認で手動挿入。
- 現状のgitの`supabase/migrations`には旧番号の元SQLとStage用別タイムスタンプ版の実体が併存し、Supabase CLIによる「ディレクトリ全体を同期」は**安全ではない**。本番はこの2本だけ`apply_migration`で**明示的に選択して登録する**。成功時に実際に生成されたversionを読み返し、GitHubのリリース記録と一致させる。GitHubへ歴史移行ファイルを追加/移動する場合はStage履歴と将来の`db push`動作を別途検証してから。
- **失敗時**：前提チェック不一致なら適用しない。トランザクションCOMMIT前ならSQL自体がROLLBACK。COMMIT後のMigration記録異常、あるいはRPCだけ追加され履歴が欠けた場合は、履歴を捏造したり再実行せず、**DB実体と記録の両方を照合し停止**。Cloudflareの旧コードに戻すだけではDB権限の変更が復元されないため、Phase2はユーザーへ公開手順/復旧手順を説明したうえで実行する。

## 2. Prod等価環境でのPhase1→Phase2連続試験

**必要な環境**：Supabase Prodのschema/migration系を引き継ぐ一時的なPreview branch。2026-11-21確認時、Prodには既存開発branch **0件**。

**費用・承認**：Supabase MCPでbranch作成を試みたところ`confirm_cost_id`の事前承認が必要として拒否され、**作成されていない**。組織の計算費用見積は **$0.01344/時間〜**（Micro compute、その他使用量が追加される可能性あり）。ユーザーがこの単価を確認し費用発生に同意してからのみ作成。作業後は不要なPreview branchを削除して時間課金を止める。別プロジェクトの永続作成はしない。

承認後の実行順：
1. Preview branchのproject ref/構造・Migration履歴をProd READ ONLY `132,135,140,143,144,149`と比較。branchがProdの必要な表/関数を欠く場合は**Prod等価ではないため中止**。branchには本番ユーザーデータを引き継がないことを確認。
2. branchで`149`を実行して`phase1_eligible=true`を確認し、**Phase1を`apply_migration(name='task08_prod_phase1_additive')`**で適用。postflightと履歴登録`=1`を独立したSQLで確認。再実行はしない。
3. branchで`149`の`phase2_eligible=true`を確認し、**Phase2を`apply_migration(name='task08_prod_phase2_atomic')`**で適用。11節のSQL/trigger/RLS/ACLが適用・コミットされていることを確認。
4. 代表的な公開/未所属匿名、本人所属、加入同意、Owner引継ぎ、共有リンク/動画クリックの**最小正負例**を専用fixtureで確認。元Prodデータの秘密・ユーザーID/メール等を使用しない。固定ペア/写真/施設のschema存在を再確認（branchに行がないことはProdで当該機能が存在しない意味ではない）。
5. migration履歴が`phase1=1,phase2=1`、権限が現仕様どおり、Prodから引き継いだ既存schemaを消していないことを確認する。再適用の禁止を論理preflightと履歴の両方で検証し、branchは削除する。
6. **ここまで通った後**、実本番へのGO/NO-GOを判断。Prodは本番データ有り、旧UI/Cloudflareは`main`自動デプロイである点を考慮し、単純にbranch PASS＝本番無条件GOにはしない。

## 3. 役職変更の確定結果（DB DML、別手続き）

ユーザーの明示的指示で**本番のグループ「Wytel Bule Owls」**のみ変更済み。
- 変更前：`clubs.owner_id=NULL`、`あんべ`と`瀧田`がともにactive `main_admin`。
- 変更後：**`clubs.owner_id=あんべ`の連携済アカウント**、`あんべ=main_admin`継続、`瀧田=sub_admin`。両者 active、グループ有効所属9人。
- 実行前、名前・紐付けたauth/profiles・対象所属を照合し、**BEGIN→UPDATE→事後検証→ROLLBACK**で予行。次に同じ対象に対して**1件の`clubs.owner_id`と1件の`club_members.role`だけUPDATE**してCOMMIT。改めて別のREAD ONLY SQLでowner/role/9名/イベント54件維持をPASS。
- グループ名や他者、プロフィール、試合、戦績を変更していない。Migration履歴は影響なし。H41のOwner NULL報告は**修正前の履歴**で、現状の未解決事項には数えない。

## 4. 現在の判断

- **実データの役職変更は完了**。
- **H42二重適用防止**：実行順・対象SQL・履歴名・チェックSQL・失敗時STOPの取り決めを定め、Phase1/Phase2へ拒否ガードを実装・Prod/StageでREAD ONLY判定実行。
- **Prod相当の連続DDL検証は未着手**（branch作成が費用承認待ち）。見積額のユーザー了承後にのみ進む。
- 本番の追加RPC・画面/Cloudflareデプロイ・PR merge は未実施。PR #265は引き続きDraft。TASK-08全体の画像/メール招待等は別残件。
