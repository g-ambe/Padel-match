# Step 2：clubs 物理DELETE（ローカル検証済み、本番未適用）

対象：padel-hub / ntczrmvffmpjzilfebyi。Step 1のUPDATE改修後を前提とする。ユーザーの次工程への指示は準備・検証として扱い、本番適用の承認はまだ得ていない。

## 方針と影響

アプリの認証ロールからのclubs直接DELETEをすべて拒否する。メイン管理者・スーパー管理者も物理削除はできなくする。
通常のグループ管理画面は UPDATE is_active=false、スーパー管理画面は UPDATE is_deleted=true,deleted_at=... による論理削除であり、今回はこれらを変更しない。
app/libと既存マイグレーションを検索し、アプリからclubsを直接物理DELETEする呼出しは見つからなかった。
本番からDELETE対象のポリシーを再確認し、Step 1後の互換ポリシー USING(true) が残ることを確認した。

apply.sqlは rls01_clubs_delete_compat を USING(false) にし、rls02_clubs_delete_deniedへ改名する。
UPDATE・SELECT・INSERT、GRANT、既存関数・トリガーは変更しない。
追加のDELETE/ALLポリシーがある場合は停止する。RLSの無効化や別ポリシー追加が将来行われれば、この拒否だけで防げるわけではない。
管理者接続・service_role等のRLS迂回権限やSECURITY DEFINERによる経路、他表からのFK連鎖削除、TRUNCATEは今回の直接DELETEポリシーの対象外。

## SQLと切り戻し

- apply.sql：同一トランザクションでDELETE条件だけ変更。短いロック/実行タイムアウト付き。
- rollback.sql：Step 2だけ元の無条件DELETEへ戻す。Step 1のUPDATE制限は維持。
- verify.sql：clubsの全ポリシーとDELETEのテーブル権限を読取り確認。

テーブル権限はauthenticatedにDELETEありのままで、RLSで対象行を0件にする。anonは従来どおりテーブル権限でも拒否される。
切り戻しは既知の広い物理削除許可も復活させる。後続の変更があれば定義を比較してから実施する。
Step 1も戻す必要がある場合は、Step 2を先に戻し、その後Step 1のrollbackを使用する。
実行途中で失敗した場合はROLLBACKして状態確認。失敗後の別SQLを同じトランザクションで続行しない。
実行先は接続UIで本番プロジェクトと照合する。

## 検証

再現コマンド（依存導入はStep 1のREADME参照）：

```powershell
node supabase/maintenance/rls-clubs-update/test-local.cjs --delete
```

PGlite 0.3.14 / PostgreSQL 17.5、合成データのみ。Step 1の26項目に加えStep 2の21項目、計47項目成功。実際のapply/rollback/verifyを読み込んで実行した。

- メイン/旧IDメイン/サブ/一般/無効所属/無所属/所有者のみ/スーパー管理者/JWTメールスーパー管理者のDELETEは全て0行。匿名は権限拒否。
- DELETE拒否時に親行とON DELETE CASCADEの合成子行が残る。
- メイン管理者の論理削除・設定更新、スーパー管理画面相当の論理削除、INSERT/SELECTは維持。
- UPDATE等の非DELETEポリシーが定義まで一致する。
- 追加DELETE/ALLや再適用を検知して停止。切り戻しはStep 1後の定義へ完全一致。
- 切り戻し後の合成データでは広いDELETEが再び成功し連鎖削除されること、再適用成功も確認。

本番の書込み・削除テストは実施していない。ブラウザ、PostgREST/Auth、並行処理、ロック待ち、本番の全FK構成は再現していない。TypeScript/Cloudflareビルドはアプリコード無変更のため未実施。

## 承認後の本番手順

1. 直前にverifyと関連定義を再確認し、applyを実行。
2. DELETEがfalseの1本だけ、他5本・GRANTに変化なしを確認し記録。
3. 本番グループの削除操作は試験しない。ユーザーに通常のグループ表示・設定保存・再読込で回帰確認を依頼する。
4. 定義異常や通常運用の不具合があれば、承認済みの当工程のrollbackで復旧し、次へ進まない。

本番適用と異常時の当工程rollbackについて、SQL・検証結果を提示したうえで明示的承認を得る。
