# セット02：旧player_statsのクライアント直接アクセス停止（本番適用・画面確認済み）

推奨設定：Sol・中。対象の作成/閲覧/更新/削除4操作をまとめて扱う。2026-10-30、外部連携で旧表を使っていないとの回答と明示承認後に本番適用した。

## 本番適用結果

マイグレーションclose_unused_player_stats_client_access成功。production-application.jsonに直前・直後のメタデータと9項目の比較結果を保存した。全項目成功。匿名/認証済みの5権限は全てfalse、ポリシー0件、RLS有効。行数1件、service_roleの対象権限、本人連携関数の定義・所有者、他テーブルのポリシー・ACLは不変。対象ACLも予定した7権限の撤回だけ。切り戻し未実施。本番データの書き込みテストは行っていない。

Security Advisorsの追加はplayer_statsの「RLS有効・ポリシーなし」INFOのみ。今回の直接アクセス停止に伴う意図した状態で、クライアント権限も撤回済み。[診断の説明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。既存の警告に差分なし。

2026-10-30、ユーザーが所属グループの戦績・ランキング、自分の個人戦績、終了済み開催の試合結果の表示を全て確認した。4項目を完了計上し、全体11/33、残り22項目。切り戻しは不要だった。

## 利用状況と実操作への影響

- app/libにはplayer_statsへの直接読書きがない。現在の個人/グループ戦績はevents、event_participants、matches、match_players、match_resultsとメンバー履歴から計算する（lib/stats-history.ts、各画面の集計）。
- そのため「試合スコア保存→開催終了→グループ/個人ランキングを開く」「終了した開催の共有を見る」の現在の取得先は変更しない。
- 唯一確認できたDB内の参照はprofile_link_private.merge_profilesの整合性チェック。postgres所有のSECURITY DEFINERで、実行所有者はBYPASSRLSを持つため、ユーザーロールの直接権限を外しても内部チェックを維持できる。
- 本番テーブルには1行ある。行の削除、再集計、統合、テーブル廃止は一切しない。管理者DBメンテナンス/service_roleの権限も変更しない。
- Webアプリのスーパー管理者もauthenticatedロールなので、APIでこの旧表を直接読む/書くことはできなくなる。現在の管理画面はこの表を使用していない。
- 外部で独自にこの表を参照する集計・CSV連携がある場合は影響し得る。リポジトリ外の独自処理までは確認できていない。利用している場合は適用前に知らせてもらう。

## SQLと切り戻し

apply.sqlはdev_all_player_statsだけが調査時の定義どおり残っていることと、anon/authenticatedの現在の5権限を確認してから、SELECT/INSERT/UPDATE/DELETE/TRUNCATEを撤回し、無条件ALLポリシーを削除する。
RLSは有効なまま、テーブル・データ・制約・管理者アクセス・本人連携関数は変更しない。TRUNCATE撤回は補助対策として含め、33項目へ重複計上しない。
権限を撤回しても継承経由で残る場合はガードで失敗し全体ROLLBACKする。

rollback.sqlは新ポリシーや新権限が追加されていないことを確認し、元のALLと元のロール別権限を復元する。他の表やデータは変更しない。ロールへの直接GRANT、grant option/継承経路の違いは適用直前にも確認する。
両SQLは単一トランザクション、lock_timeout3秒・statement_timeout15秒。管理者としてプロジェクトntczrmvffmpjzilfebyiに実行する。

## 検証結果

```powershell
node supabase/maintenance/rls-player-stats/test-local.cjs
node --test tests/stats-history.test.cjs
# 次の環境変数はテスト用合成DBにだけ作用する
$env:PADEL_CLOSED_STATS_TEST='1'
node --test tests/profile-linking-db.test.cjs
```

- 専用検証18項目成功：匿名/認証済みの5操作を42501で拒否、データ不変、service_role参照維持、definer内部参照、切り戻し・再適用、部分的な権限ドリフトの停止。
- 戦績関連16テスト成功：現在の計算と取得の回帰確認。
- 実際の本人連携マイグレーションを組む合成DBで旧表を閉じてから41テスト成功：通常連携/加入承認/統合の安全チェック等が維持されることを確認。

専用検証18＋戦績16＋本人連携41＝75項目。過去の全151テストを無変更で繰り返すのではなく、この表に関わる範囲を選んで実行した。
全てローカル・合成データのみ。本番での読み取りはメタデータと件数のみ。アプリ実装無変更なのでNext.js/Cloudflareビルドは今回未実施。

## 適用前後の確認と進捗

verify.sqlで事前にポリシー、ロール別直接ACLと実効権限、内部参照関数の所有者/definer、行数を再確認し、差分があれば停止する。
適用後はクライアント5権限がなく、他の表のポリシー・権限、行数、service_roleの権限、merge_profilesの定義が不変と確認する。本番のUPDATE/DELETE/TRUNCATEや本人統合をテスト目的で行わない。
ユーザーには既存のグループ戦績・個人戦績・終了済み開催結果を開き、普段の件数や表示が維持されることをまとめて確認してもらう。新規の作成/削除/連携操作は不要。
現時点7/33。4操作の適用・確認が終われば11/33。外部独自利用がない前提で、本セットの本番適用と異常時の切り戻しについて一度承認を得る。
