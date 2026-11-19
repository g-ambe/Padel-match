# TASK-08 H12：本番共有リンクRPC移行手順（未承認・本番未実施）

更新日：2026-11-19。対象：Draft PR #265 / Issue #264。
**この文書は本番作業の承認ではない。Cloudflareデプロイ、本番SQL、PRマージはまだ実施しない。**

## 現在の事実と移行ブロッカー

- 本番 `padel-hub` は、2026-11-19のREAD ONLY監査時点で終了・共有ONの通常イベント9件、公式イベント1件が存在。実トークン、個人識別子、試合行は取得・記録していない。
- 本番には `public.get_shared_event(text,text)` / `security_private.shared_event(text,text)` / `security_private` schema が存在しない。共有RPC対応の画面を先に本番へデプロイすると共有リンクは読み込めない。
- `event_team_matches` の0045混合/ラウンド列は本番とStageの双方で存在し、候補RPCが要求する必須15列の欠落は0。
- 本番の公開公式表は匿名で直接読める経路が残る。**現在のStageの防御が本番にも適用済みと誤認しない。**
- Draft PR #265にはH12以外にもグループ権限/取得RPC移行が含まれ、本番にはまだ反映されていない前提を含む。H12単独で `main` / Cloudflareへまとめてデプロイしない。

## 事前Stageで完了した試験

- `54_h12_prod_compatible_rpc_candidate.sql` をStage `BEGIN/ROLLBACK` で実行：既存関数上書きと、Stageの2関数を一時DROPした**本番の初回作成相当**の両方がPASS。
- `50_h12_mixed_round_rollback_probe.sql`（混合4-2、所属元、仮名ゲストID、ラウンド/コート情報）と `46_h12_share_token_rollback_probe.sql`（通常・公式正規トークン、無効/種別違い/共有OFF/匿名表直接拒否）を、新規RPC候補と同じROLLBACKトランザクションで再実行。判定すべてtrue。
- 同じ候補をStage限定Migration `task08_staging_h12_prod_compatible_rpc_boundary` に適用済み。Stageでは公開RPCが `SECURITY DEFINER` のtoken検証を呼び出す一方、`security_private.shared_event` のanon/authenticated直接EXECUTEは無効。Stageの全イベント・公式イベント・試合は0件のまま。
- `tests/shared-event-rpc-release.test.cjs` を追加し、初回作成ガード、公開RPC/非公開helper権限、token条件、基底表REVOKEを別段階に保つことを検証する。

## リリース手順（将来の承認後・順番厳守）

1. **事前確認とバックアップ**：本番DBの対象schema/列/RLS/関数/ACL/移行履歴、Cloudflare現行デプロイの復帰点を記録。実利用トークンはログ・Issue・CIに残さない。ユーザー承認があるまでここでもREAD ONLY。
2. **RPCの先行導入**：`54_h12_prod_compatible_rpc_candidate.sql` をレビューし正式な順序付きMigrationとして確定・本番適用する。これは追加のpublic token RPCと内部helperのみ。既存の匿名SELECTはこの段階では変更しない。適用後に新関数の所有者 `postgres`、`search_path=''`、公開RPCのanon/auth EXECUTE許可、内部helperの匿名/認証直接EXECUTE拒否を検査。無効/共有OFF tokenはnull。**本番適用はまだ未承認**。
3. **アプリ切替**：他のP0マイグレーション（0054/0055等）の本番互換・全UI/認証の受入が先。既存PR #265をそのまま先行本番配信しない。承認済みのリリース時に通常/混合/公式の共有ページを公開RPC取得へ移行。
4. **実利用リンクの受入**：共有を許可したテスト対象で、イベント名・所属・対決/混合のスコア・個人/ペア戦績・YouTubeリンク・公式集計を実ブラウザで照合。匿名とログイン双方、無効・共有OFF・未終了・削除・グループ無効を負例確認。ここで初めて「アプリ切替受入」を判定。アプリの旧JSキャッシュ/開いたままのタブによる旧匿名SELECTにも注意。
5. **匿名基底表SELECTの遮断**：4までの確認後、`53_h12_anon_shared_base_acl_candidate.sql` の7表 `REVOKE SELECT FROM anon` を本番で**別工程として承認・実施**。原SQLの合成tokenチェックは本番では実在しないため、正式本番SQLでは候補の固定テストtokenを事前に除去し、実リンクを秘密のまま安全に検証する設計に置き換える。再度7表の `has_any_column_privilege('anon',...,'SELECT')=false`、ログインユーザー向けSELECT維持、匿名正規token取得可・基底表直GET不可を検証。
6. **完了判定**：H12のすべての正負例、実ブラウザ動作、既存利用者への互換性・H14履歴保護が成立して初めてPRのH12完了に変更。P0全体のリリース条件は別途。

## 停止・ロールバック判断

- RPC新設で既存の権限/関数との衝突、token型誤判定、機密フィールド混入があれば**即停止、次工程へ進まない**。関数削除はアプリが新RPCを使用していないことを確認してから。新設したprivate schemaを丸ごとDROPしない。
- アプリ切替の画面不具合では、まず配信バージョンを復帰。RPCは残してもよいが、基底表の匿名権限はむやみに拡大しない。
- 匿名SELECT遮断後の不具合では、RPC/API/キャッシュとクライアントを修正する方向を優先。**匿名SELECTを安易に再GRANTすると既存の公式データ公開リスクが復活する**ため、再付与は個別のセキュリティ判断と明示承認が必要。
- ステージングの合成fixtureは削除済み、Stageの実イベント件数は0。本番の既存履歴・結果を修正しない。

## 次の未完了ゲート

- 本番適用用の正式Migrationパッケージ化と実データに基づく正規token/ページの受入（機密リンクは公開CIへ出さない）。
- グループP0全体の互換Migration、RLS/旧連携関数と新取得RPCの移行順を解消。
- H14の既存スコア例外6件を仕様照合し、過去の退会者/戦績の不変性検証。
