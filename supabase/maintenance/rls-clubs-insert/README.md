# Step 3：clubs INSERT（本番適用・主要画面確認済み）

対象：padel-hub / ntczrmvffmpjzilfebyi。Step 1 UPDATE制限、Step 2直接DELETE禁止に続く1操作の改修。
ユーザーの明示承認で本番適用済み。production-record.md参照。以下の適用手順は再実行指示ではない。

## 変更理由と仕様

現在のrls01_clubs_insert_compatはanon/authenticatedのWITH CHECK(true)。ただし既存のprofile_link_club_ownerトリガーがowner_idとauth.uid()の一致を既に要求しており、他人を所有者にしたINSERTは現状でも拒否される。
今回は既存の保護と同じ条件をRLSに明記する整理であり、未保護の所有者偽装を新たに発見したという意味ではない。

apply.sqlはINSERTポリシーだけをTO authenticated、WITH CHECK(auth.uid() IS NOT NULL AND owner_id=auth.uid())へ変更し、rls03_clubs_insert_selfに改名する。
一般メンバー・無所属ユーザーも本人を所有者にして新グループを作成できる。スーパー管理者も他人を所有者にして作る例外は設けない（既存トリガーも同じ扱い）。
SELECT/UPDATE/DELETE、所属登録ポリシー、関数、トリガー、GRANTは変更しない。
グループの初期is_active/visibility等への追加制限、作成レート制限、原子的なグループ＋所属作成、プロフィール本人連携の改修は今回の範囲外。

コード根拠：app/groups/new/page.tsxは本人プロフィール確認後、owner_idにログイン本人を渡してINSERT RETURNING id、その後club_membersへ本人をmain_adminでINSERTする。所属登録前のSELECTも必要なため、今回SELECTは狭めない。

## ファイルと復旧

- apply.sql：追加のINSERT/ALLポリシーがなく、既存の1本が調査定義と一致することを確認して変更。同一トランザクション、lock_timeout=3秒、statement_timeout=15秒。
- rollback.sql：今回だけ元のINSERTポリシーへ戻す。Step 1のUPDATE制限、Step 2のDELETE禁止は維持する。既存の所有者トリガーも維持。
- verify.sql：全clubsポリシーを読み取り確認。適用前後でINSERT以外の5本が一致することを確認する。
- dependency-fixture.json：今回読み取った所属登録の関連関数・トリガー。個人の行データは含まない。
- test-cases.cjs / test-results.json：ローカル合成データの検証。

適用先はSQLだけでプロジェクトを保証できないので実行UI/接続情報で照合する。エラーが出た場合はROLLBACKし、状態を再確認する。
次の工程を適用済みならその変更を確認してから復旧する。以前のUPDATE工程まで戻す場合は逆順で整理し、別工程の定義を壊さない。

## 検証結果

```powershell
node supabase/maintenance/rls-clubs-update/test-local.cjs --insert
```

PGlite 0.3.14 / PostgreSQL 17.5、前工程47項目＋今回21項目、計68項目が成功した。

- 無所属、一般、サブ、メイン、スーパー管理者の本人所有INSERT RETURNINGと再取得が成功。
- 本人のグループ作成→club_membersへのmain_admin登録→作成グループのUPDATEが成功。
- 他人所有、NULL所有者、本人IDなし、匿名、スーパー管理者による他人所有の作成を拒否し、行がないことを確認。
- 合成DBのみで所有者トリガーを一時無効にし、RLS単独でも所有者偽装を42501で拒否することを確認。元のトリガーへ復帰。
- 前工程のDELETE禁止と非INSERTポリシーの完全一致を確認。
- 追加INSERT/ALLポリシー、再適用を検知して停止。切り戻し後に元ポリシーへ完全一致、所有者トリガーも有効、再適用も成功。

関連club_membersのINSERTポリシーはPhase 0スナップショットから実定義を使用し、今回本番で同じ条件であることを確認した。club_role等の依存関数、参照整合性トリガーも今回の読取り定義を使用した。
AuthのJWT署名確認、プロフィール作成RPC一式、PostgREST、ブラウザ、全FK・並行性・ロック待ちは再現していない。本番のグループ作成テストは未実施。
アプリコードと依存は変更していないため、TypeScript/Cloudflareビルドは未実施。

## 承認後の本番確認

適用直前に定義とトリガーを再確認し、今回の本番適用・異常時rollbackの明示承認後に実行する。
直後にINSERTが本人所有条件の1本、他5本・GRANT・トリガーが不変であることを確認する。
グループ作成は実データ追加を伴うため自動では行わず、ユーザーの通常の作成機会に作成→管理者として編集可能か確認する。本番で偽装INSERTやNULL所有者等の書込みテストは行わない。
新規作成が失敗した場合は再作成を繰り返さず、既にグループだけ作られていないか確認して復旧する。

公式根拠：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。
