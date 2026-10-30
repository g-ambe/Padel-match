# Step 1：clubs UPDATE（本番適用済み・画面確認待ち）

2026-10-30。対象本番プロジェクトは padel-hub / ntczrmvffmpjzilfebyi。
このフォルダは自動適用されない手動実行用。ユーザーの明示承認を受けて本番適用済み。実施結果は production-record.md を参照。以下の適用手順は再実行の指示ではない。

## 権限の決定

コード根拠は lib/permissions.ts の canEditGroupProfile / canDeleteGroup。
グループ名・説明・施設・画像URL・公開設定・is_activeによる論理削除は、スーパー管理者または有効な自グループの main_admin のみ。
sub_admin はメンバー管理権限を持つが、グループ設定変更は許可しない。
owner_idだけでは許可しない。所属登録前の作成者には既存同様INSERT/SELECTが残る。
club_members.profile_id と player_profiles.linked_auth_user_id の2経路を残す。

USING と WITH CHECK を同じ条件にし、更新前後とも権限を要求する。既存の owner_id変更防止トリガーは維持。
既存の clubs_super_user_update は変更せず利用する。既存 is_super_user のJWTメールによる判定も継続する（今回変更しない）。
ポリシー内の所属参照は通常のSELECTで行い、新しいSECURITY DEFINER関数は追加しない。

## ファイル

- apply.sql：既存ALLを削除し、SELECT/INSERT/DELETEは同等の3本に分割、UPDATEだけ制限。既存スーパー管理者ポリシー2本は維持。全変更は同一トランザクション。
- rollback.sql：この工程の4本だけを削除し元のALLへ戻す。UPDATEの既知の過剰許可も戻る。
- verify.sql：定義・権限・トリガーの読み取り。実行主体がpostgresである結果を一般ユーザーの認可検証と解釈しない。

applyは既存3ポリシーの定義が調査時点と一致しない場合に停止する。再実行は失敗させる設計。
rollbackのガードは工程名・件数・互換ポリシー・既存ポリシーを確認するが、新UPDATE条件の完全一致までは検査しない。
適用後のverify結果を保存し、切り戻し直前の結果と比較すること。後続工程や別の変更が入っていれば使用せず再レビュー。
実行エラーでトランザクションが残った場合は ROLLBACK し、成功扱いにしない。ロック待ちは3秒、文単位タイムアウトは15秒。
プロジェクト識別はSQLのDB名だけでは保証できないため実行先UI/接続情報で照合する。

## 事前確認の結果

本番読み取りでclubsポリシーはPhase 0と同じ3本であることを再確認した。
有効なmain_admin所属は9行、旧profile_idとlinked_auth_user_idの両方が未設定の有効main_admin所属は0行。
候補条件を本番READ ONLY内でEXPLAIN（ANALYZEなし）し、SQLの参照解決が成功した。
これはCREATE POLICYの実行、ユーザーとしてのRLS評価、性能の実測を検証したものではない。

Dockerエンジンは接続不能、psqlもPATH上になかったため、PGlite 0.3.14（PostgreSQL 17.5 / WASM）をローカルのメモリ内で使用した。
test-local.cjs による26項目の検証が成功。実際のapply.sql/rollback.sql/verify.sqlを実行し、SET ROLEによる非所有者・非スーパー権限でDMLを確認した。結果はtest-results.jsonに保存。
本番での代替書込みテストは行っていない。
アプリコードは変更せず、TypeScript/Cloudflareビルドは未実施。

## 検証表（以下のローカル合成データ検証は成功）

本番データのコピーを使わず、ローカルの合成ユーザー・合成グループA/Bで検証する。
サービスロールではなく、anon/authenticatedロールと対象ユーザーのJWT相当の認証文脈で行う。
is_super_userの本番定義・参照先のclub_members/player_profiles/app_adminsのRLS・権限・owner変更トリガーも再現する。

| ケース | 期待 |
|---|---|
| Aの有効main_admin（選手連携経由）→Aの設定変更 | 1行更新、再SELECTで一致 |
| Aの有効main_admin（旧profile_idのみ）→A | 同上 |
| Aのmain_admin→B | 0行更新、Bの全列が変更前と一致 |
| Aのsub_admin/member、無効所属、無所属、所有者だけのユーザー→A | 0行更新 |
| anon→A | 権限拒否、変更なし |
| スーパー管理者→A/B | 更新可能 |
| Aのmain_admin→Aのis_active=false | 更新可能、再SELECT一致 |
| Aのmain_admin→owner_idを変更 | 既存トリガーが拒否 |
| Aのmain_admin→idを所属のない別IDへ変更 | WITH CHECK拒否、元の行が維持される |
| SELECT/INSERT/DELETEの前後比較 | 権限・ポリシー意味が元と同じ |
| rollback後のポリシー | 元3本と定義一致 |
| rollback→apply再適用 | 同じ期待結果 |

追加で、変更前には無所属ユーザーのUPDATEが成功すること、適用/切り戻し時の余分なポリシーを検知して停止すること、所有者であるだけでは更新できないこと、既存JWTメールによるスーパー管理者判定が維持されることも確認した。

再現手順（リポジトリルート）：

```powershell
pnpm --dir .rls-validation add --ignore-scripts --save-exact @electric-sql/pglite@0.3.14
node supabase/maintenance/rls-clubs-update/test-local.cjs
```

検証用依存は .rls-validation のみで、アプリのpackage.json/lockfileは変更していない。
検証ではclubsの認可に必要な最小テーブル、関連SELECTポリシー、既存is_super_user関数と所有者トリガーをスナップショットから再現した。
本番の全外部キー・全テーブル・書込みRPCは再現していない。Authの署名検証・PostgREST・ブラウザUI・並行更新/ロック待ち・Cloudflareも対象外。
本番のPostgreSQL 17.6とのパッチバージョン差があり、この成功は本番操作の実測ではない。

正常更新はerrorなしだけでなく返却id・変更件数・再取得を確認。拒否はエラーまたは0件と変更なしを確認する。
main_admin以外の拒否、WITH CHECK拒否、他グループ変更拒否のうち1つでも失敗したら承認対象にしない。

## 本番適用手順（まだ実施しない）

1. ローカルの上表を実施し結果を記録する。
2. 本番verify.sqlを取得しPhase 0/今回の定義と照合。GRANT・依存先RLS・関数・トリガーの変化も確認する。
3. apply/rollbackと検証結果を提示し、この1操作の本番実行についてユーザーの明示的承認を得る。異常時のこのrollback実行の承認も同時に確認する。
4. 通常運用が少ない時間にapplyを実行し、直後にverify。想定は元ALLなし＋新規4本＋既存2本。
5. 通常利用時のmain_adminによる設定保存と再読込、一般メンバーの試合運営を確認。既存データの論理削除を試験目的で実行しない。
6. 正常運用の失敗・定義の予期しない変化があれば次へ進まず、承認済みの復旧手順に従う。

## 残る制限

この工程はclubsへの直接UPDATEだけを制限する。INSERT/DELETE/SELECTの広い許可は残る。
特に他グループの物理DELETEはまだ別途対策が必要で、グループ全体の保護完了ではない。
新しいグループの作成や試合運営テーブルの権限は変更しない。
RPC等の特権経路全体の安全性はこの工程だけでは保証しない。
グループ削除処理には権限関数自体を条件にしている箇所と更新結果を十分確認しない箇所があるが、今回アプリ修正は混ぜない（app/groups/[id]/page.tsx:378）。
UIの成功表示だけで保存成功と判断しない。

公式根拠：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。
changelog.mdはWebツールのContent-Type制限で取得できず。実装仕様は公式RLSドキュメントで再確認した。
