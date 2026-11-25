# TASK-08-03 / #264 — 候補03の限定再検証

2026-11-25 / 既存Draft PR #270 / `codex/task-08-member-public-choice`。
対象SQLのHEAD：`d8ac04559faa6eccd5635cb56944b81b3afc4e0c`。
修正正本：https://github.com/g-ambe/Padel-match/issues/264#issuecomment-7151752641

**判定：今回指定された限定確認はPASS。候補01のMedium指摘は、従来の再現条件に対する候補03の実行で解消を確認。正式Migration化・本番適用・配信承認とは区別し、Draftを維持する。**

## 差分・原文の保全

- 候補01と03の差分は、共通transaction advisory lock取得文を最初のDDLより前へ移動したこととコメントのみ。
- コメント・空行と当該1文の位置を除いたSQLは一致。取得文は1回。RPC本文・認可・CAS・RLS/ACL・初期化条件・5秒lock_timeout／60秒statement_timeoutは不変。
- 候補01/02/03、API契約の原文は変更していない。アプリ本体も変更なし。
- 01 SHA256：`040ff7910c01783354f95cfe22dfa1df8cfa0389e82aa08c83596d9fc192bb26`
- 02 SHA256：`e6e84bcfe0b41de5a5cd62dfad8688e0694c0c82747109f48e1750e534fdc4e6`
- 03 SHA256：`4d2dd78e1bf0ed3be97a7409fe1678ae8f36bfa838332b667ceefc6d30cf4ce3`

旧候補01の40P01再現は `REVIEW_RESULTS.md` と `tests/member-public-choice-concurrency.cjs` に履歴として保持し、今回は再実行していない。

## 実ローカルPostgreSQL 17.11

新規・空の使い捨てDB `member_public_review`（127.0.0.1のみ、tmpfs）に既存の合成fixtureを構築。既存7関数の本文ハッシュを含む事前ガードを通し、**候補03ファイル全体を変更せず実行**した。試験後に今回作成したコンテナのみ停止・削除。

| 確認 | 実行結果 |
| --- | --- |
| DDL前の共通ロック待機 | Aが共通advisory lockを保持。Bで03を実行すると `pg_stat_activity.wait_event=advisory`、Bのgranted AccessExclusiveLockは0。Aはclub_membersを読めた。PASS |
| DDL前タイムアウト | 原文どおりの5秒lock_timeoutでBが55P03。明示ROLLBACK後、候補列・新RPCは不在。選択したスキーマのカタログ・ACL/RLS/policy・関数本文/権限とpublic表の行ハッシュが事前と一致。PASS |
| 途中DDL後のタイムアウト | advisoryに協調しないAがjoin_requestsをAccessShareLock。Bはclub_membersのDDLを実行済み（granted AccessExclusiveLockを観測）、join_requestsのDDL待ちとなり5秒で55P03。ROLLBACK後に途中の列・制約等が残らず、同じカタログ・publicデータfingerprintが一致。PASS |
| 元の循環待ち条件の解消・実適用 | Aが共通ロックを保持し、BがDDL前で待機。Aは既存の表示名保存RPCを完了しCOMMIT。解放後Bの03が最後のCOMMITまで成功、先行保存名を維持。40P01なし。PASS |
| 適用後のRPC正負例 | 同じ実PostgreSQLで本人OFF保存成功、古いCASはPT409、他人の連携済みメンバー変更とanon実行は42501。PASS |
| 二重適用拒否 | 適用済みDBで03を再度明示試験し事前ガードで拒否、ROLLBACK後も確定済みOFFを維持。PASS |

タイムアウトで返されたエラーの後は接続に明示ROLLBACKを送り、確定状態を照合してから独立した次の試験へ移行した。適用結果不明の自動再送ではない。60秒statement_timeout単独の発火試験は行わず、設定不変を差分で確認した。共通ロックを使用しない全ライター間のデッドロック不存在までは保証しない。非協調処理による競合・適用停止の運用条件は引き続き必要。

実行コマンド（`pg@8.16.3` はリポジトリ外の既存検証ツール）：

```sh
NODE_PATH=/tmp/lineup-home-tools/node_modules \
MEMBER_PUBLIC_TEST_DB_URL=postgresql://postgres@127.0.0.1:55433/member_public_review \
node tests/member-public-choice-lock-order.cjs
```

同スクリプトはローカル限定ホスト・DB名および空のpublicスキーマを確認してからfixtureを作成する。新しい有料環境・本番データ複製・既存Stage初期化なし。

## 候補03を実適用した関連SQL正負例

既存テストの候補選択だけを追加し、03をPGliteに実適用。候補02の復旧試験は選択範囲から外した。

```sh
MEMBER_PUBLIC_TEST_CANDIDATE=03_lock_order_candidate.sql \
node --test --test-isolation=none \
  --test-name-pattern='unchanged candidate:|named join OFF' \
  tests/member-public-choice-db.test.cjs
```

**10件PASS、失敗0。** ACL/RLS/policy・既存関数権限、既存別名/確認日時/無効行/所属ID/役職/選手連携/スコア/履歴/戦績保全、本人OFF→名前編集、旧RPC拒否、他人/管理者/super/anon拒否、公開DTOの最小項目、直接INSERT/UPDATE偽装拒否、旧unnamed再加入によるOFF上書き拒否、CAS、二重適用拒否、加入OFF・本人連携OFF・統合AFTER snapshotを確認。

fixtureの所有者移管表等は最小の試験用前提であり、本番全スキーマや実Auth/PostgRESTの再現ではない。この制限は前回から不変。

## 再利用した証跡・実施していない確認

- `b67b703..d8ac045` の変更は03の追加1ファイルのみ。今回の変更はテスト選択・新しいロック検証・結果文書のみ。
- アプリ/候補02/API契約不変により、前回のアプリ関連テスト・モバイル明暗・本人連携/復旧02・TypeScript・Cloudflare互換ビルド証跡を再利用。UI・ブラウザ・全件回帰・ビルドは再実行していない。
- d8ac045の既存GitHubチェックは `private-media`、`Workers Builds: padel-match-staging` ともcompleted/successを読み取り確認。今回Actionsの手動実行やデプロイは行っていない。記録追加後HEADの自動チェックは別扱い。
- 実Auth/PostgREST・物理iPhone・本番カタログ/適用件数/実データは今回未検証。本番/Stageへの書込み、正式Migration採番、マージ、配信、Draft解除なし。
- Project #2は `Resource not accessible by integration (user.projectV2)`。Issue #264とPR #270へ結果を記録し、Project同期済みとは扱わない。

## 次工程

本件のロック順序修正は限定確認済み。ChatGPT/ユーザー側で正式SQL対象・保全範囲・操作停止/排出・適用停止/照合・DBとアプリの配信順を確定し、別途本番適用承認を得る。候補01を誤って適用しないこと。候補03の結果だけをもって本番適用へ進まない。
