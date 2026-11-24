# TASK-08-03 / #241 同一グループ内プロフィール写真

基点：main `a8d2ab12eec70d2da8534fd17a7ca43998e12cb1`。旧PR #265/#266はマージ済み、開始時open PRなし。写真表示だけを新規ブランチ `codex/group-member-avatars` に分離する。

正本：Issue #264 [承認済み設計](https://github.com/g-ambe/Padel-match/issues/264#issuecomment-7127560349)、[SQL候補/API契約](https://github.com/g-ambe/Padel-match/issues/264#issuecomment-7127764270)。本書は実装記録であり本番適用の承認ではない。

## SQL候補

- `01_group_member_avatar_CANDIDATE.sql`：GPTがIssueに提示したSQLをそのまま保存した原文。通常のWebPキーにも一致しない正規表現を含むため、**適用しない**。
- `02_group_member_avatar_CANDIDATE.sql`：ユーザーの明示承認により正規表現末尾の二重バックスラッシュ＋`.webp`を`[.]webp`にした1箇所だけの修正版。新RPCの認可条件、引数、返却列は原文のまま。
- SHA256（01）：`7ff436793d1cfab29e6cfff51f6aad3d0452fdcf02b1a76fcc3c9f5d84cc4cec`
- SHA256（02）：`c58d8b7de3e4540486f578b295a705609797a41c2dadd0708a6fbde6a93f4dc6`

0048/0049の実DDLと実際のproof関数、0054の実member関数を使った合成PGliteで構造・正負例を確認した。本番カタログは正本コメントのGPT読み取り調査を参照し、今回新たにProd/Stageへ接続・適用していない。正式Migrationの採番/確定は独立レビュー後。`supabase db push`は使わず、01/02を連続適用しない。

既存の表/列/RLS/ACL・画像変更RPC・R2構成は変更しない。新規RPCはpostgres/空search_path/SECURITY DEFINER、authenticated＋既存Worker proofのみ。所属判定に管理者・スーパー管理者の例外を追加しない。対象の有効な連携、private所有者、現在のactive objectとの一致が必要。

## 実装

- `GET /api/groups/[clubId]/members/[memberId]/avatar`：既存のBearer/getUser検証を共通化して使用。本人用mediaContextの本人照合、mutationの試行制限・quota、既存画像キャッシュは維持。
- 毎回認証→新RPC→返却行数/キー/位置/版の検証→既存`PROFILE_IMAGES.get`の順。R2へのPUT/HEAD/コピー/公開化はなし。proof/画像キー/プロフィールIDは応答・診断へ出さない。1応答でWebPバイトと検証済み位置ヘッダだけを返す。
- 全応答`Cache-Control: private, no-store`、`Vary: Authorization`、nosniff。ETag/304を使わない。401=未認証、404=不許可/画像なし、503=内部障害。
- メンバー一覧の36px領域だけを既存ProfileAvatarへ置換し、未連携/退会/未登録/失敗時の既存SVGは保持。名前・役職・POP・戦績・他画面の画像表示は変更しない。
- メンバータブにいる在籍閲覧者のみ、所属再確認後にIntersectionObserverで可視行だけ取得。最大3件の同時取得。同じ訪問中はBlob URLを再利用するが、永続Storage/共有キャッシュ/定期poll/失敗の無限再試行は使わない。
- タブ/club/account/名簿状態の変更、画面非表示・離脱でabort/revoke。復帰時は所属と画像を再照会し、古い非同期応答を捨てる。すでに閲覧した画像を遠隔で消去する保証はしない。退会/除名以降の新規API要求はDB判定で拒否する。
- 関連ヘルプの標準アイコン説明だけを同期。既存チュートリアルの操作手順に変更はなく、疑似体験から実画像を取得する処理は追加しない。

## 限定検証（2026-11-24）

| 検証 | 結果・環境 |
|---|---|
| 候補SQLの原文保存・修正版差分 | 1箇所の承認済み修正のみ。原文では正常キー不一致、修正版では正常画像を取得 |
| SQL認可・構造 | PGlite、実0048/0049/proof/member関数。公開/非公開、一般/メイン/サブ、第三者/他グループ/非所属super相当/匿名/service_role、proofなし/不正、改ざんclub/member、双方の退会/除名、無効/未連携/owner不一致/失効objectを限定確認 |
| 画像ライフサイクル | 既存prepare/commit/position RPCで差替え・削除・位置変更。閲覧が成功回数を増やさず、本人privateやobjectsの直接SELECTも広がらないことを確認 |
| API | Request/Response単体試験。認証/認可前のR2拒否、エラー分類、秘密値非露出、位置/版/キー/容量検証、R2不在/障害、no-store/Vary、ETag指定時も再認可 |
| キャッシュ | Session単体試験。3並列、同一訪問内再利用、遅延応答/画面外abort、dispose全URL破棄、失敗再試行なし、新訪問で再取得 |
| 本人機能の回帰 | 既存profile-media-api、profile-avatar-position、profile-avatar-position-dbを限定再利用。本人照合・変更制限・応答喪失・位置CASを維持 |
| ブラウザ | 375px Chromiumライト/ダーク。合成Auth/REST/画像応答、実WebP描画で位置・遅延取得・並列上限・タブ破棄/再訪・背景/復帰時失効・Auth切替・未所属GETなしを確認。スクリーンショットなし |
| 型/ビルド | TypeScript `--noEmit --incremental false`成功。固定Bun 1.2.15で`npm run cf:build`成功、Worker/assets/Next BUILD_ID一致。localhost合成公開設定であり本番配信物ではない |

コマンド：`node --test tests/group-member-avatar-api.test.cjs tests/group-member-avatar-session.test.cjs tests/group-member-avatar-db.test.cjs tests/profile-media-api.test.cjs tests/profile-avatar-position.test.cjs tests/profile-avatar-position-db.test.cjs`。ブラウザは`tests/browser/group-member-avatars.cjs`をローカルNext・既存のChromiumで実行。既存の無関係な全件テストは再実行しない。

試験の区別：PGliteはSET ROLE/合成claims、API単体は依存注入、ブラウザは合成Auth/REST応答。**実Supabase Auth/PostgREST＋実Worker＋クラウドR2を通した新APIの統合試験、物理iPhone、本番実画像は未検証**。既存の過去PASSや本単体試験をその代わりとはしない。

## リリース・残件

Draft維持。独立DB/APIレビュー、必要な実Auth/HTTP統合確認、正式Migration確定、本番適用/配信の明示承認が残る。承認後は追加RPCを先に適用してからアプリを配信し、実画面を確認する。候補未適用の環境では新APIはfail closedとなり標準アイコンへ戻る。

新API停止/未使用を確認した後の撤回対象は新RPC `public.get_group_member_avatar_for_worker(uuid,uuid,text)`だけ。CASCADEや既存画像API/RLSの緩和はしない。今回、本番/StageへのSQL・データ変更、R2書込み、設定変更、mainマージ、デプロイは行わない。
