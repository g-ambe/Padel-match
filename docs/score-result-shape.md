# 0043適用後のスコア読取互換性

`UNIQUE(match_id)` により、PostgRESTは `matches` → `match_results` を一対一の関係と判定する。埋め込みレスポンスは、以前の配列から単一オブジェクト（結果なしはnull）へ変わる。従来の `match_results?.[0]` は保存済みの結果を読めず、保存成功後の再取得で得点が「—」へ戻る。イベントの作成時期は関係しない。グループ・プロフィール・共有・生成時の履歴評価も同じ前提だった。

DBの一意制約・RPC・保存キュー・集計式は変更しない。`firstMatchResult` と `matchResultRows` で両形式を読み、従来の配列に複数の不一致結果がある場合の拒否も維持する。修正は読取りだけで、既存の得点・試合・監査を変更しない。

前回のDBバックアップ比較は値と計算式の不変を確認したが、実PostgRESTの返却形式を再現していなかった。今回は次を検証する。

- `node tests/integration/match-result-postgrest.cjs`：実PostgreSQL 17/PostgREST 13.0.4を外部通信なしの専用Dockerネットワークで起動し、UNIQUE前後の配列→object/nullと旧読取の表示消失、修正後の同じ得点保持を確認する。合成データだけを使用し、終了後に自分のコンテナ・ネットワークを削除する。
- `tests/match-result-shape.test.cjs`：初回/再取得/修正/再送と正本ID保持、0対0、個人・ペア・グループ・プロフィール・過去評価の同値性を確認する。
- ブラウザ回帰は `TEST_MATCH_RESULTS_ONE_TO_ONE=1` を指定し、実DB相当のobject/null形式で実施する。旧配列形式の単体試験も維持する。
- `production-smoke.yml` の `score_diagnostic=true`：READ ONLYの接続・トランザクションで、最近の開催中イベントの保存件数と一意制約だけを確認する。氏名・イベント/試合/結果ID・実得点は公開ログへ出さない。本番データを書き換えない。

本番の読取調査では、利用可能な場合に一時プロファイルの匿名Chromeで公開済みの1試合を開き、DBに保存された得点と表示を照合する。クリック・得点変更はせず、URL・実得点・DOMはログへ出さない。
