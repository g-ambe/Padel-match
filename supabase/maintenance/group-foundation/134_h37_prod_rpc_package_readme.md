# TASK-08 / H37：本番互換RPCの最小追加パッケージ（2026-11-21）

対象：既存 Draft PR #265、Issue #264。**本番DBの確定適用・Cloudflareデプロイ・mainマージではない。**
方針：既存の固定ペア・画像・施設・イベント/戦績を消したり初期化せず、必要なRPCだけを段階的に追加する。
セキュリティ対策の追加拡張や本番機能の再実装は行わない。

## 再利用・追加するソース

| 順序 | SQL | 目的 | 本番適用状況 |
| --- | --- | --- | --- |
| 調査 | `132_h37_prod_rpc_release_readonly.sql` | Stage/Prod共通の事前条件・不一致を最小集計 | 両方READ ONLY実施 |
| A候補 | **既存** `54_h12_prod_compatible_rpc_candidate.sql` | 匿名共有結果用 `get_shared_event` ＋内部helper（追加のみ） | 未適用 |
| B候補 | **新規** `133_h37_prod_video_click_additive_candidate.sql` | 共有token付きクリックRPC3種を**H33の完成形**で直接追加（旧RPCや履歴に触れない） | 未適用 |
| C | `0054_group_read_interfaces.sql` → `0055_group_read_consumer_support.sql` | グループ取得RPCやJOIN参照用の追加 | Prod未適用 |
| D | `0056`→`0065` | 表示名・公開同意・Owner引継ぎ・人数表示 | **本番互換の前提調整待ち** |
| 切替後 | `20261121131943_task08_h35_legacy_video_click_anon_close.sql` | 旧クリックRPCの匿名実行権限を閉鎖 | **新共有画面の配信後のみ** |

注意：GitHub `supabase/migrations` にはステージング先行版H31/H33等が含まれる。**`supabase db push`でディレクトリ全体を無条件適用しない**。正式な本番Migrationへの番号登録・衝突回避は本番適用を判断するリリース作業で行う。本候補は `maintenance` に配置し、未承認の自動適用から分離する。

## Stage/Prod照合（同一SQLの実測）

`132_h37_prod_rpc_release_readonly.sql`を両環境で`BEGIN READ ONLY; ... ROLLBACK;`実行。

| 確認 | Stage | Prod |
| --- | --- | --- |
| H12基礎16表・チームスコア列欠落 | 0件 | **0件** |
| `get_shared_event` | あり | なし |
| H37クリック用8表/旧3関数の欠落 | 0件 | **0件** |
| クリック計測3表RLSなし | 0件 | **0件** |
| 新tokenクリックRPC | 3件導入済 | **0件（新規追加可能）** |
| `club_members`匿名列SELECT | 無し | **有り（0056をそのまま適用不可）** |
| `security_private.task08_guard_last_main_member()` | あり | **なし（0062をそのまま適用不可）** |
| 固定ペア・画像テーブル | 未導入 | 導入済 |
| 施設行数 | 9 | 24 |
| イベント/公式イベント | 0 / 0 | 91 / 4 |

### SQL試験済み

- A候補：既存 `54_h12_prod_compatible_rpc_candidate.sql` の実体をStage内で**BEGIN→全DDL→確認→ROLLBACK**。共有RPC存在と匿名EXECUTEをPASS。本番は基礎16表・0045の列がすべて存在することをREAD ONLYで確認。ただし**本番実行・実token HTTPはまだ行っていない**。
- B候補：導入済のH33完成済み3関数の定義を再利用し、Stageで`CREATE OR REPLACE`→ACL確認→**ROLLBACK**。3関数の実行可・`search_path=''`・referrer無保存コードをPASS。Prodの8表/RLS/旧3関数/新RPC不存在をREAD ONLY確認。**ProdにDDLを実行したわけではない**。
- Stage H34で実HTTP＋375pxブラウザで正常・無効リンク、通常/混合/公式、クリック3種類をPASS済。fixtureはH35で回収済。
- A/Bとも「本番の既存アプリを直ちに切り替える」ものではない。旧RPC・既存SELECT/UPDATE/RLS・戦績データは維持する。

## 本番リリースまでの実施順

1. **RPC追加のみ**：A→Bの内容を本番用の正式Migrationとして確定後、ユーザーのリリース承認を得て適用。旧共有画面は従来のまま動作させる。導入前後で実イベント数・試合/戦績数・既存RPCの権限と、新RPCの正負例を確認。
2. **グループ機能の互換性解消**：0054/0055の依存とProd既存パッチを確認。0056は本番 `club_members` 匿名SELECTが残るため事前ガードで停止する（安易な匿名REVOKEは旧画面を壊す）。0062はProdに `task08_guard_last_main_member` がないため停止する。これらは**既存管理/試合機能と同時に切り替える限定パッチ**が必要。Stageの独自ポリシーやトリガーをProdに無条件コピーしない。
3. **アプリの反映判断**：#265は約225ファイルの変更を含む。上記DB互換と固定ペア/画像/施設/試合管理/プロフィールの主要動作が維持できることを確認した後のみマージ・本番Cloudflare反映。現時点はDraftを維持。
4. **匿名旧RPC整理**：新しい共有UIが配信されたことを確認してからH35を本番へ適用。関数は削除せず、認証済み互換呼出しを残す。旧匿名基底表の広いSELECTの見直しは旧画面との互換性を確認してから用途別に行い、一括REVOKEしない。

## NO-GO/復旧
- A/BのSQLに既存関数名衝突・テーブル/列欠損があれば適用しない。
- 上記SQL候補は単一BEGIN/COMMITに閉じ、エラー時は自動ROLLBACK。確定反映後に誤りがあれば、**新UI未配信時に限り**新規追加したRPCのみの取り消しを判断し、既存関数や旧権限は変更しない。
- 0070等を含む歴史Migrationを全適用・本番データ改変・mainの先行マージ・Cloudflare本番デプロイは**この作業に含めない**。
- 次工程：**0054/0055がProd現物で成立するか**、および0056/0062の具体的互換ブロッカーを限定検証し、正式本番移行パッケージを決める。
