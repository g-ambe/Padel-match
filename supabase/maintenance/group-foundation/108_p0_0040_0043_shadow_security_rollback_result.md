# TASK-08 / P0-H25：固定ペア移行のStageロールバック互換性検証（2026-11-20）

関連：Issue #264、既存Draft PR #265、AGENTS.md、`106_p0_historical_migration_preflight_readonly.sql`、`107_p0_stage_legacy_migration_gates.md`。**DB本番変更、Stageへの確定Migration適用、mainマージ、本番デプロイなし。**

## 目的と前提

- Stageの既存security_minimal系イベントUPDATEポリシーは `PERMISSIVE` かつ `USING/WITH CHECK security_private.can_operate_event(id,false)`。本番の旧`rls10_events_update_members`（PERMISSIVE）をそのままStageへ追加するとPostgresのOR合成により権限を拡大する可能性があり、その方法は禁止。
- 原本 `0040_event_fixed_pairs.sql` は`rls10_events_update_members`という名前のポリシー1件、ID保護トリガー7件、6表のRLS、既存のALL型ポリシーなしを事前ガードとして要求。Stageには名前とトリガーが欠ける一方、現行の別の保護は存在する。
- Prodの稼働中トリガー関数4件とトリガー7件を**pg_get_functiondef / pg_get_triggerdef でREAD ONLY参照**。本人・イベント等の実データや秘密情報は読み出していない。これらを**Stageの1トランザクション内だけ**再現する。

## 実際に実行したStageロールバック試験

1. `BEGIN`、`SET LOCAL lock_timeout='5s'`、`statement_timeout='90s'`。postgresかつ本番固定ペアschema未導入・現StageイベントUPDATEポリシーがPERMISSIVEで存在することを厳格に確認。
2. `events_identity_private`・`events_operation_private`・`participants_identity_private`・`match_identity_private` を一時作成しPUBLIC/anon/authenticated/service_roleへUSAGE付与しない。Prodの4件の現行関数定義をトランザクション内で作成（SECURITY INVOKERのまま）、その関数への7件のID保護トリガーを装着。
3. 旧ポリシー名`rls10_events_update_members`を**AS RESTRICTIVE**として作成し、`USING/WITH CHECK`に**現Stageと同一**の`security_private.can_operate_event(id,false)`を使用。`PERMISSIVE`ポリシーを増やさないため、現在の許可結果をORで広げない。これは**Stage検証専用の互換ガード**であり、Prodのポリシーを置き換える最終設計ではない。
4. GitHubの原本 `0040→0041→0042→0043`をこの順で全て実行。各原本の外側の`begin;`と`commit;`だけを除き、**同一トランザクション内に連結**。原本関数・制約やガードそのものは書き換えない。
5. 0040の固定ペアRPC、0041/0042のラインアップ/削除RPC、0043の`match_results_one_per_match` UNIQUEが存在すること、追加ポリシーがRESTRICTIVEのままであることを確認し、最後に**ROLLBACK**。

**結果：0040→0043連続DDLのStage ROLLBACK試験PASS**。元のStageへの確定適用なし。

## 認証済み正常操作・不正操作の同一トランザクション試験

上記DDLを全て導入した**同じBEGIN内**で、StageテストAuthに紐づく既存クラブ1件に、ロールバック用の一般メンバー1件・通常イベント1件を合成作成。検査時だけ`SET LOCAL ROLE authenticated`と`request.jwt.claim.sub`を切替。再利用可能な本番IDやJWT本体はログに出さない。

| 判定 | 結果 |
| --- | --- |
| 一般メンバー：イベント名の管理編集を拒否 | PASS |
| 一般メンバー：通常の開催状態変更を許可 | PASS |
| 一般メンバー：作成者の書換えを拒否 | PASS |
| 現オーナー：イベント名の編集を許可 | PASS |
| 現オーナー：所属グループIDの変更を拒否 | PASS |
| 現オーナー：イベント自身のID変更を拒否 | PASS |
| 別クラブ/部外者：イベントの閲覧・更新を拒否 | PASS |
| 元の0040〜0043のRPC・制約が導入できる | PASS |

**8/8真、最後にROLLBACK**。これらは**イベント更新に関する限定した正負例**であり、全固定ペア生成・全ラウンド自動編成・複数接続競合・旧フレンドリーイベント全件の互換性を証明しない。

事後別クエリでStage baseline `clubs3/members12/profiles12/events0`、migration記録70件、`fixed_pair_private`・`lineup_private`不在、追加トリガー0・旧名ポリシー不在を確認。**Prod READ ONLY以外なし**。

## ゲート（この試験がPASSしても即導入しない）

- 原本0040〜0043は強いテーブルロックとDB外バックアップ/リストア確認を要求。Stage正式適用前にバックアップと復元可能性を確認し、今のStage固有トリガーとの競合テスト・固定ペア生成履歴・通常編集/ScoreInput/結果変更/チーム戦を実Authで回帰する。
- 追加RESTRICTIVEポリシーとProdトリガーの併用は**Stage検証上の候補**であり、セキュリティ審査と全機能テスト前の恒久化は禁止。本番の旧トリガー・ポリシーを再定義したり、RLSを広げる操作はしない。
- P0匿名公開の実対策は**アプリの実データ取得経路の棚卸し→互換RPC・アプリ切替→匿名base SELECTを閉鎖**する別の本番変更ゲートを要する。Codexは`105_p0_codex_anon_access_consumer_audit.md`に基づく**ソース監査のみ**を先に担当し、無断でDB/画面を修正しない。
- Prod変更・mainマージ・Cloudflare本番デプロイはユーザーの明示承認まで禁止。
