# 本番適用記録

- 対象：padel-hub / ntczrmvffmpjzilfebyi、public.clubs UPDATE。
- ユーザーの「OK！」により、本番適用・異常時の当工程の切り戻しを承認。
- 2026-10-30 10:36 JST頃に適用成功。Supabase migration名：rls01_clubs_update_main_admin。
- 実行内容：apply.sql。テーブル行へのINSERT/UPDATE/DELETEは実行していない。
- 適用前：preflight-production.json。適用後：postapply-production.json。
- 適用後：RLS有効、元ALLなし、新規4本＋既存2本を確認。GRANTは変更なし。
- UPDATEは有効な同グループmain_admin、または既存スーパー管理者条件に限定。
- SELECT/INSERT/DELETEは互換ポリシーで元の許可を維持。別工程の対策が必要。
- ローカル合成データの26検証成功。本番のブラウザ保存・実ユーザーAPIによる更新拒否の確認は未実施。
- 定義確認では異常がないため切り戻し未実施。正常運用で保存不能等が判明した場合は、この工程のrollback.sqlで復旧する。
- Security Advisorも再実行。既存の関数search_path、SECURITY DEFINER実行権限等の指摘は別課題として継続し、この適用だけで全体の安全性を保証しない。

Gitのコードを戻すだけでは本番DBは戻らない。DB復旧にはrollback.sqlを明示実行する。
次のテーブル・操作への適用は、この工程の実画面確認後に別途準備・承認する。
