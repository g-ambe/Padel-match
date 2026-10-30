# 開催ID・所属・作成者の付け替え防止（本番適用済み・画面確認待ち）

推奨モード：利用可能な選択肢を前提にSol・中。モードだけを安全性の根拠にせずSQL・合成検証・本番確認・切り戻しで判断する。高モード必須という以前の推奨は更新する。

## 操作への影響

- 維持：通常の開催終了/再開、名前、コート数、共有設定、論理削除。INSERTの開催新規作成もこのガードでは変更しない。
- 拒否：Webアプリの認証ロールによる、既存開催のid / club_id / created_by_auth_user_idの変更。アプリ側スーパー管理者も同様。変更しない値を再送する場合は許可。
- 本番コード検索では、eventsのこれら3列を変更する通常のUI経路は見つからなかった。event_team_sidesのclub_id変更は別テーブルなので対象外。
- 古い作成者NULL行も、名前/状態の通常更新は維持。今回NULLを自動補完しない。

## SQL

apply.sqlは専用private schemaにSECURITY INVOKERのトリガー関数を作り、eventsのBEFORE UPDATEに設定する。current_userがanon/authenticatedのときだけ、3列のOLD/NEW差を確認し42501で拒否する。
既存RLS・GRANT・データ行は変更しない。schema/関数の権限はPUBLIC/anon/authenticatedから剥奪。トリガー呼出しがこの状態でも動作することをローカル実DBで確認した。
postgres/service_role等の管理処理やSECURITY DEFINERを通した更新はこの条件では制限しない。全RPC経路の防御完了という意味ではない。
本番実行前にeventsの既存トリガー一覧、同名schemaがないこと、実行先プロジェクトntczrmvffmpjzilfebyiを再確認する。

rollback.sqlは今回のトリガー、関数、空schemaだけを削除する。CASCADEなし。関数定義が適用後から変わっていれば、実行前に比較し再レビューする。既存RLS・データを戻す操作ではない。

## 適用順

1. このガードを適用し、通常の開催更新ができることを確認。
2. 別途承認後、既に準備したevents INSERT制限を適用して、直接の偽装作成も止める。

ガードだけではdev_all_eventsの直接INSERT過剰許可は残る。INSERTだけでもUPDATEの付け替え経路が残る。両方で当該2経路を止める。既存の他グループへの状態/得点等の更新や子テーブルの問題は別途残る。
TRUNCATE権限剥奪は別の1操作として準備・承認する。今回混ぜない。

## 検証

```powershell
node supabase/maintenance/rls-clubs-update/test-local.cjs --events-insert --identity-guard
```

前工程127件＋ガード13件＝140件成功。PGlite 0.3.14 / PostgreSQL 17.5、全て合成データ。
付け替え3列、NULL遷移、アプリsuper_userの拒否、通常の各更新、値不変、古いNULL行、管理者DBメンテナンス、二重適用、切り戻し、再適用、実際のガード先行→INSERT制限の順を確認。
実際のSQLファイルを読み込んで検証。新しいトリガーが既存ポリシーを書き換えないことも比較した。
本番のブラウザ/PostgREST/全RPC/全制約・並行性は未検証。本番で不正な付け替え・削除・得点変更のテストは行わない。
アプリコード無変更のためTypeScript/Cloudflareビルドは今回は未実施。

## 本番適用後の必須確認

普段の開催で、名前やコート数等を通常どおり保存できることを確認する。終了/再開は実際に必要な運営タイミングで確認し、確認のために既存開催を終了させたりスコア変更したりしない。
ガードは画面に新しい機能を出す変更ではなく、画面が送らない不正な3列変更だけをDBで止める。画面からの付け替えテストは不要。
ユーザーの「お願いします」により本番適用・異常時の当工程rollbackを承認。applyは実施済み、rollbackは未実行。production-record.md参照。
