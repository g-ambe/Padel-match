# OTHER-02 / TASK-01-21 限定検証・引継ぎ

> 先行実装時点の記録です。その後の候補受領・独立レビュー・アプリ対応・新しい検証結果は [最新レビュー](../../supabase/maintenance/lineup-home-court/REVIEW.md) を参照してください。

2026-11-25 JST。基点main `065ade4b0c579ea47eb0452a85a0f17cb651abb2`。
ブランチ：`codex/lineup-home-court-selection`。本番/Stage書込み・Migration変更/適用・マージ・配信なし。

## OTHER-02 / #267

**DB契約整理と現象再現まで。非固定入替の機能は未実装。**
変更：`OTHER-02-db-contract.md`、`tests/round-lineup-fixed-contract.test.cjs`。対象コミット `def2654`。

- `node --test --test-isolation=none tests/round-lineup-fixed-contract.test.cjs tests/round-lineup-client.test.cjs`：8/8成功（親テスト含む）。両者出場・片方休憩・両方休憩のeffective/applied/split形状と解除後の履歴保持を実SQL/PGliteで確認し、現行の一律拒否を再現。応答喪失・同一操作ID/CAS・ゲスト経路の既存クライアント回帰も成功。
- `node --test --test-isolation=none tests/profile-media-api.test.cjs tests/round-lineup-db.test.cjs`のうち既存Round DB部分：21/21成功（親含む）。固定なしの同一/別コート/休憩入替、履歴、次生成、認可、得点済み、重複、未知履歴、競合、監査、rollback等の既存基線。修正版の受入結果ではない。
- 未実施：候補SQLの独立レビュー・新DB正負例、固定あり非固定入替の正例、複数固定の新保護条件、実Auth/HTTP・モバイルの新固定表示。アプリのRound全体禁止を勝手に除去していない。
- 次工程：ChatGPTが `OTHER-02-db-contract.md` のDTO/署名/互換/保護境界を確定したSQL候補を提供 → Codex独立レビュー/隔離検証 → アプリの固定選手無効表示と非固定選手選択を対応。既存Migration・生成アルゴリズムは不変。

## TASK-01-21 / #258

**プロフィールUI/APIとグループ設定UIは実装・限定確認済み。直接RPCの自由入力禁止は候補待ち。**

- `tests/profile-media-api.test.cjs`：10/10成功。旧新API形式の新規自由入力拒否、施設ID選択・解除、本人/利用制限、R2未使用、CAS/認可/試行制限エラーの旧RPC fallbackなし、応答喪失時の施設ID/版/名称NULL照合、補助読込み失敗後の確定値保持。API境界の依存はテストdoubleであり実Auth/HTTP試験ではない。
- `tests/profile-v4.test.cjs`：4/4成功。既存値・関連プロフィール状態の基線。
- `tests/shared-home-facility-db.test.cjs`：3/3成功。既存0051 SQLをPGliteへ適用し、施設ID/マスター参照、本人・匿名・直接UPDATE/閉業/不明ID、CAS/試行制限・旧値維持を回帰確認。**旧RPCの自由入力が今も通る旧仕様も含む**ため、DBの自由入力廃止成功とは扱わない。
- `node tests/browser/home-court-selection.cjs`：ライト/ダークとも成功。ビルド済みアプリをloopbackのみで起動し、合成Auth/RESTで実React UIを操作。プロフィールの施設選択/保存/解除/再表示、自由入力欄なし、既存未掲載名の読み取り表示、他項目だけの保存・候補取得失敗時にホームコートPATCHなし、明示解除、キャンセル、都道府県分類/施設名のみ/長い名称、グループ側と同じselect DOM/クラス、グループ保存/キャンセル/保存拒否、閉業施設の新選択禁止と既存ID保全、候補取得失敗時ID保持、一般所属者に設定操作なし、320/375px横はみ出しなし、外部通信なし。実DB認可・物理iPhone・本番データは未検証。
- `tests/browser/group-detail-tabs.cjs`は関連する施設selectのアクセシブル名だけ追従。全3タブ回帰は今回再実行していない。
- 共通 `lib/tutorial-content.ts` を更新。使い方・初回/項目別体験で共有するプロフィール説明から新規自由入力の案内を削除し、既存値保持・グループ設定の選択方法を同期。OTHER-02の新操作は未実装なので案内を先行変更しない。

## 共通の型・互換確認

- `npx tsc --noEmit`：成功。
- `npm run cf:build`：Next15.5.29 / OpenNext1.20.17で成功、Worker成果物まで生成。合成URL `http://127.0.0.1:54321` / 合成公開キーのみ使用。CLI設定・公開URL・Secret変更なし。
- 初回ビルドは環境にBunがなく開始前に停止。packageManagerと同じBun1.2.15を `/tmp/lineup-home-tools` にだけ導入して再実行。package.json/bun.lockは不変。
- 単体試験の新しいAST抽出でexport除去漏れ、ブラウザ試験の閉じたselect内optgroup可視待機、既存POP復元を無視した再クリックの各試験ハーネス失敗を修正後、対象を再実行して成功。アプリの判定を緩和していない。単体試験は既存registerHooksと分離プロセスの組合せを避けるため `--test-isolation=none` で実施し、アサーションは維持。
- 既存workerd compatibility_date警告とNodeのMODULE_TYPELESS_PACKAGE_JSON警告あり。今回と無関係な設定変更は行わない。
- Project #2は403のため同期できず、既存Issue/PRを進捗正本として更新する。

## リリース残件

ChatGPT作成の両DB候補・独立レビュー・隔離正負例が必要。新アプリ/旧DBではAPIの自由入力拒否は働くが、旧タブ/直接RPCは未封鎖。OTHER-02も旧DBが全体拒否のまま。**3改修全部の完了や本番準備完了とは扱わず、Draftで保持する。**
