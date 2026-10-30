# 適用セット01：開催作成＋未使用の破壊的権限（準備済み、本番未適用）

ユーザーの希望により、影響を分離して確認できる小さな変更は一度の承認・一度の画面確認にまとめる。設定はSol・中で継続。
対象プロジェクト：padel-hub / ntczrmvffmpjzilfebyi。

## セット内容

1. events INSERT：準備済みrls-events-insert/apply.sqlを使用。既存events_insertを活かし、INSERTの無条件許可だけを外す。
2. events物理DELETE：anon/authenticatedからDELETE権限をREVOKE。RLSの許可が残っていてもテーブル権限で直接DELETEを拒否する。通常画面の削除はUPDATEによる論理削除なので維持する。
3. clubs TRUNCATE：anon/authenticatedから全件削除権限をREVOKE。
4. events TRUNCATE：同上。

既適用の開催ID/所属/作成者変更防止ガードは維持する。SQL実行前に同トリガーの有効状態と定義を確認する。
TRUNCATEはRLSとは別枠の補助対策で、主進捗33項目へ重複計上しない。

## 実操作への影響

- 維持：一般メンバーの自グループ開催作成、グループなし開催、作成後の参加者登録、終了/再開、得点入力、名前変更、通常画面/スーパー管理画面の論理削除。
- 拒否：他グループへ無断で開催をINSERT、作成者偽装、WebアプリのDBロールからのevents物理DELETE、clubs/events全件TRUNCATE。
- スーパー管理画面も論理削除を維持する。アプリのスーパー管理者も直接DELETE/TRUNCATEは不可。DBメンテナンス用postgres/service_roleの権限は今回変更しない。

app/libでevents直接DELETE/TRUNCATEの利用は確認できず、public等の関数本文を調べても明示的な該当記述はなかった。外部管理ツール・動的SQLを完全監査した意味ではない。
eventsの物理DELETEを許可するRLS自体は互換状態で残るが、ロールへのDELETE権限を撤回して止める。将来むやみにGRANTし直さない。

## SQLと切り戻し

- apply.sql / rollback.sql：単一トランザクションで全セットを適用/復元。途中で1つでもガードが失敗すれば全てROLLBACKする。失敗したトランザクションを成功と扱わない。
- grants/：変更ごとの独立したSQLと切り戻し。events INSERT分は既存のrls-events-insertにある。
- build-bundle.cjs：個別SQLから全体SQLを再生成する。手編集で個別版と全体版を食い違わせない。
- eventsの既存全ポリシーを完全比較し、REVOKE前後の実効権限も検査する。権限が継承等で残った場合は停止。
- ロックはclubs→eventsの順、lock_timeout=3秒、statement_timeout=15秒。定義の競合があれば再実行を繰り返さず調べる。
- 切り戻しは撤回した権限と元の広いINSERT許可も復元する。実データを元に戻すSQLではない。他工程が進んでいれば定義ガードで停止するため、適用順を確認する。

## 検証

```powershell
node supabase/maintenance/rls-batch-01/build-bundle.cjs
node supabase/maintenance/rls-clubs-update/test-local.cjs --events-insert --identity-guard --batch
```

PGlite/PostgreSQLの合成データで、既存140件＋今回11件＝151件成功。
開催作成から参加者登録、直接DELETE拒否、TRUNCATE実効権限なし、論理削除継続、ID付け替え拒否、全体適用・切り戻し・再適用を確認。
途中の権限定義を意図的にずらし、INSERTやDELETE権限変更が部分適用で残らないことも確認した。
本番では読み取り調査のみ。アプリコード無変更のためNext.js/Cloudflareビルドは今回未実施。全外部ツールや本番ブラウザでの全ロール動作を検証した意味ではない。

## 適用後に一度だけお願いする画面確認

1. 一般メンバーで所属グループの開催を1件作成し、詳細と参加者が表示されること。
2. グループなし開催を使用する場合は1件作成し、本人が参加者に入ること。未使用ならその経路は未確認として記録する。
3. 不要になったこの確認用開催を、正規の削除権限を持つアカウントで画面から論理削除し、一覧から消えること。元から必要な開催は試験で削除しない。

同じ開催を作成確認と論理削除確認に兼用し、確認データを増やしすぎない。物理DELETE/TRUNCATEを本番で試す必要はない。
失敗時はエラー文と一覧の状態を報告し、作成を連打しない。

## 進捗への計上

本番未適用のためevents INSERT/DELETEはまだ未完了。施設の公開閲覧確認が完了した現時点は5/33。
本セットの適用・確認完了後にevents INSERT/DELETEの2項目を追加し7/33とする。補助のTRUNCATE対策は別記する。
eventsの広いSELECT/UPDATEや子テーブルは残るため、これだけで全グループデータの隔離完了ではない。
