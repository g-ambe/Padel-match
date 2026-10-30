# Step 4：clubs 閲覧制限（4Aのみ本番追加済み、4B/4C未反映）

ユーザー指定：非公開グループの共有ページでもグループ名は表示するが、他の非公開グループ情報は見せない。
現状はclubsのSELECTがanon/authenticatedへ無条件。公開検索と共有表示を壊さないため、1回で全て適用せず、以下3段階で進める。

## 操作への影響

| 実際の操作 | 変更後 |
|---|---|
| 一般/サブ/メイン管理者が所属グループを開く | 維持（有効所属、旧profile_idと連携選手IDの両経路） |
| 非公開グループのURLを無所属・他グループのユーザーが開く | clubsの行を取得できず、管理画面に入れない |
| ログインして「公開グループを探す」 | 有効かつ未削除の公開グループを表示 |
| 自分の非公開グループを新しく作る | 所属登録前でも所有者本人にSELECTを許可し、作成から管理者登録まで維持 |
| 自グループを論理削除する | UPDATE RETURNINGのため、所有者/所属のSELECTを維持。削除後一覧から隠れる仕様は維持 |
| スーパー管理画面でclosedを含む一覧を見る | 既存スーパー管理者SELECTで維持 |
| 非公開グループの終了済み公式戦を共有する | 有効トークンでグループ名だけ取得。グループ説明・施設・所有者等は公開しない |
| 匿名でclubsを直接一覧取得 | 0行 |

作成者本人には所属解除後も所有者として自分のグループ行を見せる。所有者を他人へ付け替える操作は既存トリガーが拒否する。
有効所属があるユーザーにはclosedグループの行も見せる（履歴表示・更新の整合性のため）。通常の一覧/詳細は既存UIのactive条件で非表示にする。
公開グループは行を公開する既存仕様を維持する。公開グループの列まで名前だけに絞る変更ではない。

## 適用順（各段階で確認し、次の承認を得る）

### 4A：共有グループ名取得SQLだけ導入

- shared-name/apply.sql：publicの呼出用関数（SECURITY INVOKER）と、shared_read_privateの名前取得関数（SECURITY DEFINER）を作る。clubsのRLSは一切変更しない。
- 返す値はグループ名のtextまたはNULLのみ。トークン完全一致＋共有有効＋終了済み＋イベント未削除を毎回確認。ログインを要求しないのは匿名共有の仕様であり、認可はこのトークンと公開状態で行う。
- SECURITY DEFINERは既存のclubs RLSに関わらず指定の名前だけ返すために必要。新しいスキーマに閉じ、search_pathは空、PUBLICの実行権限とschema権限は剥奪し、anon/authenticatedに必要なUSAGE/EXECUTEのみ付与。CREATEやテーブル権限は与えない。
- Data APIの公開スキーマにshared_read_privateを追加しない。公開するRPCはpublic.get_shared_official_club_name(text)のみ。
- 適用前に同名スキーマ/関数がないことを再確認する。CREATEは既存オブジェクトがあれば停止し上書きしない。
- 切り戻しはshared-name/rollback.sql。作った2関数と空のschemaだけをDROPし、CASCADEを使わない。

### 4B：共有画面の名前取得方法を反映

lib/shared-club-name.tsとapp/share/official-events/[token]/page.tsxの変更。
既存のclubs(name)埋込み読取りだけに依存せず、RPCの名前を表示する。SQL導入前/切り戻し時の42883・PGRST202だけは、既に既存SELECTで許可された埋込み名前へ戻す。無効トークンで返ったNULLには旧名を使わない。
他の権限/通信エラーは画面で失敗を表示し、名前取得の失敗を隠さない。
反映後、非公開グループの公式戦共有を匿名ブラウザで開き名前を確認してから4Cへ進む。
通常のイベント・フレンドリーチーム共有はclubsへの参照がなく、今回名前取得のコード変更は不要。

### 4C：clubs SELECTを1操作だけ制限

apply.sqlは4AのRPCの存在と既存SELECTの2本を確認してから実行する。既存super_user SELECTは維持し、互換SELECTだけを以下に変更。

- TO authenticated。
- 所有者本人 OR 有効な所属 OR 有効・未削除の公開グループ。
- 追加のSELECT/ALLがあれば停止。
- INSERT/UPDATE/DELETE・GRANT・既存トリガー/関数は変更しない。

verify.sqlで適用前後を保存・比較する。既存2本を含むSELECT以外の定義が不変、anonに直接見えないこと、共有名が返ることを確認。
rollback.sqlは4Cだけを元のanon/authenticated USING(true)へ戻す。条件の全文一致まではガードしないため適用後スナップショットと実行直前の定義を照合する。
4A/4Bも戻す場合は「4Cを先に戻す→共有画面を戻す→4Aの関数を削除」の順とする。
4Aはユーザー承認後に本番追加済み。shared-name/production-record.md参照。4Bの画面反映と4Cの閲覧制限はまだ行っていない。

## 本番データの読取り調査

事前調査時のclubsはStep 1〜3後の6ポリシーで、共有名RPC/新スキーマは未作成だった。4A追加後も全RLSポリシーのハッシュは一致し、clubsの6ポリシーを維持している。
有効・未削除のグループは公開4、非公開1。共有有効な非公開グループの公式戦は調査時0件（将来の機能を壊さないため、合成データで検証した）。
公式戦共有画面のclubs(name)埋込みが非公開clubs制限の影響を受けることをコードで確認。
関連SELECTはclub_membersがtrue、player_profilesが有効または本人またはsuper_userで、今回の条件はこれらを参照する。

## ローカル検証

```powershell
node supabase/maintenance/rls-clubs-update/test-local.cjs --select
node --test tests/shared-club-name.test.cjs
```

DBは前工程68項目＋今回32項目＝100項目成功。共有名クライアント処理5テストも成功。TypeScript noEmit・Next.js本番ビルド成功。Cloudflare Worker生成と本番ブラウザは未検証。
実際のSQLファイルをPGlite 0.3.14 / PostgreSQL 17.5で実行した。対象は合成データのみ。

- 私有グループを所有者・旧/連携の所属メンバー・super_userは閲覧でき、無効所属・無所属・他グループは閲覧不可。
- 公開グループ検索、作成直後RETURNING、所属初回登録、論理削除RETURNINGを確認。
- anon/authenticatedの非所属ユーザーがclubsを読めなくても、有効共有トークンで名前だけを取得できる。
- 停止・進行中・削除イベント・グループなし・空/NULL/無効トークンはNULL。トークン再発行後は旧トークン無効。
- RPCラッパーはinvoker、匿名はprivate schemaへCREATE不可。切り戻しは元のclubsポリシーへ完全一致し再適用も成功。

PostgREST/Auth実接続、本番ブラウザ、全FK/関連RPC、並行性は未検証。公式戦イベント自体のSELECTポリシーやログインした非所属者の共有閲覧は別の既存権限に依存し、今回それらを一括変更しない。
既存のofficial_events匿名SELECTから共有トークン等が列挙できる課題も今回のclubs制限では解消しない。名前用RPCだけでアプリ全体がリンク所持者限定になるわけではない。
club_members/player_profiles/profilesや他の試合テーブルには広い閲覧経路が残る。clubsだけを直して他グループの全データ閲覧対策完了とはしない。

## 必須の実操作確認（4C反映時）

1. 一般メンバーで所属する非公開グループを開き、名前・説明・メンバーが見える。
2. 別グループの非所属アカウントで同じ非公開URLを開くと閲覧できない。
3. 「グループを探す」で公開グループを表示できる。
4. 本人の新規グループ作成からメイン管理者としての保存までできる。
5. 非公開グループの終了した公式戦共有リンクを、未ログインの別ブラウザで開いてグループ名が表示される。

本番で削除や不正アクセスの書込みテストは不要。必要なデータ/アカウントがなければ未確認と記録し、確認済みと扱わない。
4Aだけ反映した段階では既存画面操作を変えないため、ユーザーのグループ作成・削除テストは不要。

公式根拠：[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Database functions](https://supabase.com/docs/guides/database/functions)。
