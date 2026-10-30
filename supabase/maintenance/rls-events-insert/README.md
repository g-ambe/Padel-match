# Step 5：events INSERT（準備・ローカル検証済み、本番未適用）

**一次再レビュー後の扱い：適用判断を保留。** permission-review/README.mdのR1参照。提案SQLは直接INSERTを制限するが、広いUPDATEでグループなし開催の所属/作成者を付け替える迂回が合成DBで再現した。通常運営を維持するID変更防止策との順序を、高モードで再検討してから本番適用する。既存SQLは比較・レビュー用として保持する。

対象：padel-hub / ntczrmvffmpjzilfebyi、public.events INSERTのみ。
本番はメタデータのREAD ONLY参照のみ。アプリ実装・RLS・本番データはまだ変更していない。

## 実際の操作への影響

| 操作 | 適用後 |
|---|---|
| 一般メンバーが所属グループで通常/手動開催を作る | 維持 |
| グループなし開催を本人が作る | 維持 |
| 開催後、所属メンバー/本人が参加者として追加される | 今回は参加者テーブルを変更せず維持 |
| メイン/サブ管理者が自グループのフレンドリーチームマッチを作る | 作成からチーム設定まで維持 |
| 両チームともグループなしのフレンドリーチームマッチ | 維持 |
| APIから他グループを指定して開催を作る | app_adminsの有効スーパー管理者以外は拒否 |
| APIから作成者を他人やNULLにして開催を作る | 拒否。スーパー管理者も本人名義で作成する |
| 既存開催の閲覧、スコア入力、終了/再開、削除 | 今回の権限範囲は変更しない |

今回のeventsは通常/手動フレンドリーマッチとフレンドリーチームマッチで共用される。オフィシャルチームマッチの新規作成は別のofficial_eventsテーブルで、今回変更しない。
画面に他グループが選択肢として出なくても、APIから指定する操作をDBでも拒否する変更。

## 現状と変更方法

本番にはevents_insertがあり、作成者本人で、club_idがNULLまたはapp_adminsで有効または対象グループの有効所属、というWITH CHECKが設定済み。
本人所属はclub_members.profile_id経由とplayer_profiles.linked_auth_user_id経由の両方を扱い、役職はmemberも許可する。
しかしPERMISSIVE ALL USING(true) WITH CHECK(true)のdev_all_eventsがOR合成されるため、制限を回避できる。eventsへのユーザートリガーは調査時0本で、clubsのような所有者トリガーによる既存保護もない。

apply.sqlはdev_all_eventsを削除し、SELECT/UPDATE/DELETEを同等許可の3本へ分割する。INSERTは既存events_insertだけを有効にする。
既存ポリシーはevents_insertを含め一切書き換えない。全ポリシーの完全一致を実行前に検査し、定義ドリフトがあれば停止する。変更は単一トランザクションで行う。
rollback.sqlは適用後の全ポリシー一致を確認してから、この工程の3本だけ削除し元のALLを復元する。既知の広いINSERTも戻ることに注意する。
以降の工程を適用した場合、今回のrollbackは不一致で停止する設計。強引にガードを外さず変更順を確認する。

一時維持する3本はrls05_events_select_compat / update_compat / delete_compat。
匿名の書込み禁止GRANT、既存のグループなし・チーム・共有SELECT等は維持する。既存の開催行を変更・補完しない。

## 対象コード

- app/home/page.tsx：ログイン本人をcreated_by_auth_user_idにしてevents INSERT RETURNING id、その後参加者追加。
- lib/event-participants.ts：所属グループのメンバー、またはグループなし作成者の参加者登録。
- app/team-matches/new/page.tsx：本人名義でevent_mode=teamの開催を作り、その後event_team_sidesへ2チームを登録。通常の画面は主副管理者のみ所属グループを選択可能。
- オフィシャルチームマッチはapp/official-matches/new/page.tsxでofficial_eventsへINSERTし、今回対象外。

## 検証

```powershell
node supabase/maintenance/rls-clubs-update/test-local.cjs --events-insert
```

前工程100項目＋今回27項目＝127項目成功。PGlite 0.3.14 / PostgreSQL 17.5、合成データのみ。
clubsの現在の制限を適用した状態から開始し、本番のevents全ポリシーをpreflight-production.jsonからそのまま作成。実ファイルapply/rollback/verifyを実行する。
関連のevent_participants/event_team_sidesのポリシーはPhase 0定義を利用し、本番読み取りで同条件を確認済み。参照トリガーも再現。

- 主副管理者、旧ID一般メンバー、連携選手ID一般メンバーの自グループ通常/手動作成が成功。
- 無所属でも本人のグループなし開催は成功。
- 他グループ、無所属、無効所属、他人/NULL作成者、匿名は拒否し、件数が増えない。
- app_adminsの有効管理者は本人名義で他グループに作成可能。JWTメールだけによるスーパー管理者例外は既存events_insertにはなく、その既存挙動を維持する。
- 作成→メンバー参加者追加、作成→本人参加者追加、グループ側/両方フリーのチーム開催→2チーム登録が成功。
- SELECT/UPDATE/DELETEの広い許可が維持されることも合成データで確認。これらは別工程で対策が必要。
- 既存ポリシー全文が不変、再適用・余分なポリシーの検知、切り戻し後の全定義一致、再適用を確認。

スキーマは認可に必要な最小構成。本番の全FK/制約/列デフォルト、SDK・Auth・PostgREST・ブラウザ・並行処理・全プロフィール解決RPCは再現していない。
auth.uidは合成JWT設定から取得するテスト用関数、auth.roleは合成ロールを返すテスト用関数。本人連携・team閲覧判定に使う関連関数はスナップショットの定義を利用した。
アプリ実装変更がないためTypeScript/Next.js/Cloudflareのビルドは今回は未実施。既存のローカル100検証も併せて通過したが、全アプリテストを今回再実行した意味ではない。

## 承認後に行うこと

1. 本番定義を再確認し、今回のINSERT制限と異常時rollbackの明示承認後に適用する。
2. events_insertだけがINSERTポリシーであること、他の既存9本が不変であること、3つの互換ポリシーとGRANTが想定どおりであることを確認する。
3. 正常な画面操作をユーザーに確認してもらう。作成者偽装・他グループ作成など本番の不正書込みテストはしない。

## ユーザーの必須操作（本番適用後）

1. **一般メンバーのアカウント**で自分のグループを選び、通常の開催を1件作成する。
2. 詳細画面が開き、グループメンバーが参加者として表示されることを確認する。
3. **グループなし開催**を作り、本人が参加者に追加されることを確認する。

手動モード・フレンドリーチームマッチも日常使用する場合は、次の通常の作成時に詳細とチーム設定まで開けることを追加確認する。確認できなければ未確認として残す。
今回は**開催が本番に追加されるテスト**で、グループ説明の保存テストではない。既存開催の削除・試合生成・得点変更は不要。
作成エラーが出たら連打せず、開催一覧に行ができているかとエラー文を報告する。開催だけ作成されている場合に自動再作成しない。

## 今回残る課題

SELECT・UPDATE・DELETEと子テーブルはまだ広い許可が残る。今回だけで他グループへの全不正操作を防げたとはしない。
既存events_insertはclubs.is_active/is_deleted、連携選手のis_active、参加者の権限やteam sideの所属先整合性を網羅しない。現行動作の維持を優先し今回新しい条件は追加しない。
作成者なしの古い開催、重複結果、本人連携、自動クリーンアップは変更しない。

公式根拠：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。
