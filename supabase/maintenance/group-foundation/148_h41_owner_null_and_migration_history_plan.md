# TASK-08 / H41：実グループ名確定・Migration履歴整合計画・Phase1/Phase2 SQL管理

確認日：2026-11-21（JST） ／ [PR #265](https://github.com/g-ambe/Padel-match/pull/265) ／ [Issue #264](https://github.com/g-ambe/Padel-match/issues/264)。
このレポートは **READ ONLY調査結果と未承認のリリース候補**。本番・StageのDDL/権限/データの確定変更、PRマージ、Cloudflare変更は行わない。

## A. Ownerの不整合：グループ名と事実

本番 `ntczrmvffmpjzilfebyi` に、既存H40と同じactive club / current main admin判定を用いたSQLを **BEGIN READ ONLY** で再実行。

| 項目 | 結果 |
| --- | --- |
| 実際のグループ名（DBの表記をそのまま記載） | **Wytel Bule Owls** |
| 公開設定 | public |
| 有効メンバー（active＋status active） | **9** |
| 有効メイン管理者 | **2** |
| `clubs.owner_id` | **NULL**（DB列はnullable） |
| `owner_id`と対応する有効main_admin | **0** |
| 本番有効グループ合計 | 3（`owner_id`がNULLのグループは1件） |

**正確な分類は「正式オーナーID未設定」**。メイン管理者不在ではない。レガシーデータの設計上許容されるNULLの可能性があるので、「破損」「誰かの誤登録」と断定しない。

**影響**：H19所有者移管RPCは現オーナーを起点とした本人操作のため、このままではこのグループの移管申請ができない可能性が高い。H19 migration自体の一般導入をこの1グループが必ず阻害するとは限らない（スキーマ事前条件と利用時条件は分けて判断）。対応する正式オーナーを**main_admin2名から自動選択しない**。対応には管理運営上のオーナー決定と、現在のRLS/DB実データに沿った個別の安全な変更・検証が必要。ほかのグループ、イベント、スコアや画像データを変更しない。

## B. Stage/Prod Migration履歴の実状

READ ONLYによる `supabase_migrations.schema_migrations` 照合：

- **Prod**：22件。旧番号 `0047`〜`0053`、2026-10末〜11/2の緊急RLSパッチ等があり、現実の固定ペア・本人画像・施設マスターが動作している。Stage独自 `task08_stage_0054...` は未登録。
- **Stage**：74件。初期0001〜0039復元を20261028のタイムスタンプ版で記録、0054〜0065は20261119〜20の`task08_stage_...`という**別のタイムスタンプversion**で適用、H31/H33/H35もStage専用の履歴あり。
- GitHub `supabase/migrations/0054_...sql`〜`0065_...sql` **ファイル名のversion（0054等）は、StageのMigration履歴で実際に登録されたversionではない**。Prodにも同名履歴なし。
- **禁止**：ディレクトリの存在だけを根拠に`supabase db push`を一括実行すること。Stage用の補完やProd既存`0047`〜`0053`を誤って再実行し、既存データ・オブジェクトを壊す危険がある。

### 本番用の実行単位（候補）

| 単位 | ファイル | 原本構成 | 状況 |
| --- | --- | --- | --- |
| Phase 1 先行追加 | `147_h41_prod_phase1_additive_candidate.sql` | `54_h12`→`133_h37`→`0054`→`0055`→`136_h38`→`137_h38` | **今回新規作成**。6原本、各GitHub blob SHAを記録。単一BEGIN/COMMIT、SQL引用対応を静的検査。Prod READ ONLYで主要事前条件を検査。**Prod等価スキーマでの6連続DDL実行は未検証** |
| Phase 2 切替 | `145_h40_prod_phase2_atomic_cutover_candidate.sql` | `138_h38`→`0057`→`0058`→`0059`→`0060`→`139_h38`→`0061`→`0062`→`0063`→`0064`→`0065` | 既存H40候補、11原本SHA付き。単一BEGIN/COMMIT。**Prod等価スキーマでの11連続DDL実行は未検証** |
| 共有UI切替後 | `20261121131943_task08_h35_legacy_video_click_anon_close.sql` | 旧動画クリックRPC3件の匿名EXECUTE停止のみ | Stage済。ProdはUI正常公開を確認してから |

**注意：Phase 1は「既存データ変更なし」の同義ではない**。`0054`は新たな`group_read_private.directory_refs`へ既存所属の参照行を生成し、INSERT時のtriggerを追加する。`136`はstatus変更の追加ガードを導入する。旧アプリを通した代表操作の前後回帰が必要。

### 履歴をずらさず適用する正式方針（未承認）

1. 本番データを含めず**Prodの既存スキーマ契約だけ**を再現した検証環境を用意し、H41 Phase 1→H40 Phase 2を連続で実行して、SQLコンパイル・トリガー競合・grant/RLS・本人操作を確認する。Stageは固定ペア・画像等のProd固有DDLが欠落しており、そのまま`Prod等価`とは扱わない。
2. **1回の実行と1件の履歴記録が対応する**ようPhase 1/Phase 2それぞれを正式Migrationとして確定する。Supabase管理APIの `apply_migration` は成功時に履歴を追加するが、現在`maintenance`の候補ファイルはそれだけでは自動登録されない。実行後の**実際のバージョン文字列**とSQL内容をGitHubに一致させる（事前に仮のversionを捏造しない）。
3. GitHub内の元 `0054〜0065` と新しい2本の正式Migrationの二重適用を避ける**ファイル配置と履歴整合**を、本番実行前に確定する。既存Stage履歴・ステージング実装を破壊せず、MCPでの単独`apply_migration`後に`supabase db push`が同じものを二重適用しない状態を必須条件にする。
4. 配信順は**Phase 1先行→限定実Auth回帰→Phase 2同時切替→本番Worker公開→H35匿名旧RPC閉鎖**。Cloudflare Prod Workerは`main`から自動デプロイされるため、Phase 2前にPR #265をマージしない。Stage Workerは別ブランチをビルドするので、PR #265 HEADが自動公開されるとはみなさない。
5. Phase 2コミット前の失敗はトランザクションROLLBACKで復旧できるが、**コミット後に旧UIへ戻すだけではDB権限が整合しない**。とくに新しい表示名列を含む`club_members`へ匿名テーブルSELECTを再GRANTする単純な戻し方は禁止。切替前に旧アプリがどのRPC/SELECTに依存するか最終検証する。

## C. 既存DBの追加前提照合（READ ONLY）

Prod：`security_private`/ `group_read_private` 不在、`get_shared_event` / 新クリックRPC3種類 / `get_club_roster` / 本人退会RPC不在。旧`guard_group_last_main_admin` 有り、新status bridge無し。クリック記録表3種類はRLS有効。Prod固定ペア・非公開画像表とも有り。これらは新Phase 1候補の想定と整合。

Prod：元加入RPC、review RPC、`profile_link_private.merge_changes`、プロフィール統合RPC等の主要依存が存在。既存`join_requests`はanon SELECTなし、authenticated直接INSERT/UPDATEなし。Phase 2向けの重要なACL条件と整合。**ただし本番DDL連続試験・レガシー画面互換の実認証試験は未実施**。

## D. リリース可否・次工程

**現状NO-GO**。未解決は、正式Migration履歴/配置の決定、Prod等価のDDL＋アプリ互換試験、`Wytel Bule Owls`オーナーID未設定の運営判断、PR #265のStage現HEADプレビュー、Cloudflare deploy/rollbackの実手順、匿名基底表の残存P0とTASK-08の未実装（同クラブ画像・招待）。`Wytel Bule Owls`への`UPDATE`は本人指定なしでは行わない。

今回GitHubに`147`と本書を追加。本番/Stageは全てREAD ONLY、ProdのMigration履歴22件とStage74件に変更なし。本番Worker/main/PR Draft状態も無変更。
