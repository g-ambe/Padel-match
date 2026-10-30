# セット01 本番適用記録

- 承認：ユーザー「お願いします！」。セットの開催INSERT制限、events直接DELETE権限撤回、clubs/events TRUNCATE権限撤回と異常時のセット切り戻し。
- 2026-10-30 14:10 JST頃、padel-hub / ntczrmvffmpjzilfebyiで適用後状態を確認。
- migration名：rls_batch01_event_insert_delete_and_truncate。apply.sqlを実行し成功。
- 初回は接続側のInvalid or expired requestStateで失敗。読み取りでポリシー/権限が事前状態のままと確認後、同じSQLを再試行して成功。
- events INSERTの適用ポリシーはevents_insertのみ。残すSELECT/UPDATE/DELETE互換ポリシーと既存9本は想定どおり。
- eventsのDELETEはanon/authenticatedとも実効権限なし。clubs/events TRUNCATEも両ロールとも実効権限なし。
- その他のポリシー集計ハッシュと、対象9テーブルのSELECT/INSERT/UPDATE/DELETE/TRUNCATEのその他権限は事前状態と一致。events ID変更防止トリガーと関数本文も不変。
- Security Advisor再実行。前後定義/権限はproduction-snapshots.jsonに保存。
- 本番データ行の作成・削除・更新・TRUNCATE等によるテストは実施していない。合成DBの151項目が成功済み。
- 異常がないためrollbackは未実行。

## 一連の実操作への影響

| 流れ | 今回の影響・確認範囲 |
|---|---|
| 自グループで開催作成→参加者自動追加 | 作成時に本人と所属をDBで確認する。成功後の参加者追加権限は不変。合成で一連の流れを確認済み、本番画面は確認待ち |
| グループなし開催→本人の参加者登録 | 本人名義で作成できる。合成で確認済み、普段使用する場合に本番画面を確認 |
| 開催を開く→参加者選択→Round生成→得点保存 | 今回は参加者/rounds/matches/match_players/match_resultsの権限を変更していない。本番の全工程を今回実操作したという意味ではない |
| 開催終了/再開→戦績/共有表示 | events UPDATE/SELECTと既存の共有ルートは不変。新しい条件を加えていない。実運用で異常があれば報告して復旧判断する |
| 画面から開催削除→一覧から非表示 | UPDATEの論理削除は維持。物理DELETEのみ停止するため、履歴行そのものの連鎖削除は行わない |
| DBメンテナンス用管理者の物理処理 | 今回REVOKEしたロールはanon/authenticatedだけ。postgres/service_roleへ権限撤回するSQLは含めていない |

## ユーザーの確認（待ち）

確認用開催1件を使い、一般メンバーで作成→詳細と参加者が表示される→削除権限のあるアカウントで通常画面から論理削除→一覧から消えることをまとめて確認する。
グループなし開催を使う場合は、本人参加者が追加されることも1件で確認。未使用経路は未確認として残す。
既存の必要な開催の削除、得点変更、全件削除、検証のためだけの終了/再開は不要。
実操作で確認した範囲のみ受入記録へ追加し、INSERT/DELETEの2項目を完了にして7/33へ更新する。
