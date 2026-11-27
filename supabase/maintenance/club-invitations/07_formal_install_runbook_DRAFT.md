# TASK-08-02 正式SQL準備・導入手順案（未承認・未適用）
2026-11-27。正本: Issue #262 承認 comment 7206101373、ローカル完了 7209012918、移行方針 7209405484、PR #273 final-three 7209015443。基準main 5fd308eea4f7d673c2a3e170c934876634154d94、検証HEAD 0c648aec3c6ea27de1f7902a224637855cbaba29、rev06 blob 24f56469c245d0cc81b94a5aea48ed123fe75727、SHA256 1c039a661628d229b25d1bd123946dda246233585e3e3901fc7614202429c7b6。ユーザーは今回、本番の定義・権限・migration履歴のREAD ONLY調査のみ明示承認。正式Stage接続、利用者データ・秘密情報の取得、DDL/DML、実メール、設定、merge/deployは禁止。

## 読み取り専用調査（実測）
- production padel-hub の project metadata確認後、BEGIN READ ONLY / ROLLBACK、transaction_read_only=on、postgres、PostgreSQL 17.6 / UTC。対象catalogのみ。アプリ行・auth.users行・vault行・実メール・鍵値・cron command/履歴は未取得。
- 招待private schemaなし、公開RPC14名の衝突0。pgcrypto 1.3 (extensions)、Vault 0.3.1 (vault)、必須暗号関数の署名とVault viewの存在を確認。pg_cronは未導入（available 1.6.4、cron.jobなし、cron.timezone=GMT）。ジョブや拡張を勝手に追加しない。
- 既存主要関数のprosrc MD5は11/25記録 #7157876457 と一致: add_provisional_club_member ba08764f1bb8585aaeaed99695152b17 / find_profile_link_account ceb3d9240d46ee826a47b11a984525ac / request_player_profile_link f2efe0624a7e2cc8122926293fcf884c / named 5442ad6dad509a92e50b2284bf51cba1 / legacy 23255ecc8bf2d2779b3c8895c4fa1829 / check_reference_schema 6307c9011e62f717db387a165fca21dd。private依存はpostgres owner、anon/authenticated/service_role EXECUTEなし、空search_path、公開依存はanon不可/authenticated可（既存service_role可は変更しない）。named public choice列あり。player_profilesへのFKは17件、既知の所属・通常・team4枠・join2・公式2・link2・merge2・private/media3。新FKは追加しない。既存guard関数を本番で実行していない（定義指紋のみ）。
- ランキング関連events/event_participants/matches/match_players/match_resultsは全てRLS on、authenticated SELECTあり、anon SELECTなし。team/official関連も同様。ローカルの追加GRANTは正式案に含めない。player_profilesのanon SELECTは既存権限でありRLSと併せて既存挙動を維持。実ユーザー/RLS/HTTPの動作を本番で試験したわけではない。
- Vault schema USAGEとdecrypted_secrets SELECTはanon/authenticated不可、service_roleは双方あり。既存設定であって今回追加ではない。Data APIがvaultを公開していないこと・service keyのWorker限定利用を、実運用前に設定メタデータで別途確認。既存Vault ACLは勝手に変更しない。実鍵の存在/値は未確認。
- 本番migration履歴は0047～0053と日時版（30件）、task08_prod_phase2_atomic=20261124044002 / group_member_public_choice=20261125032915確認。番号の欠落だけから未適用と判断しない。手動適用履歴があるため全migration再実行・db push/reset/repair禁止。
- 06_catalog_readonly.sql の同一定義クエリを本番READ ONLYで2回実行し、一致: 56件（26 relations、29 functions、1 FK集合）、missing=0、fingerprint cb7dd9058615a43fe0efa1f2378254fb。列/型/default/constraint/index/RLS/policy/trigger・trigger関数/ACL、対象関数定義と実行権限、FK集合を含む。ハッシュ以外の定義値は出力しない。これは対象オブジェクトの時点指紋であり、すべての間接依存・権限継承・Data API設定や本番機能試験の保証ではない。

## ファイルの使い分け
- 04_integrated_review_candidate.sql: 検証済みrev06の原本（ROLLBACK、送信OFF）、そのまま保存。
- 05_formal_install_CANDIDATE.sql: 正式適用候補。原本のinvite_preflightから最後のpostflightまで文字列同一、隔離専用ガードを正式用の別承認・postgres/PG17/履歴/56件指紋ガードに変更、最終COMMIT。送信OFFのhard CHECK、内部/公開RPC、既存統合guard、既存ロックを維持。既存テーブルへの追加は登録済み招待用triggerのみ、既存関数置換・既存ACL変更・製品データ更新・鍵作成・cron作成なし。migrationディレクトリ外の候補で自動適用しない。opt-inは誤実行防止であり承認や環境認証そのものではない。
- 06_catalog_readonly.sql: 定義指紋の再照合専用。現行本番の指紋はStage・隔離DBに流用しない。別環境は同一計算式で環境ごとにレビューした期待値/履歴を使う。権限OIDや定義表現差、バージョン変化による保守的な停止を許容し、無条件に期待値を更新しない。

## 独立レビューと最小限の再検証（次のゲート）
1. 最新main/PR/AGENTS、承認済みrev06、対象指紋と候補差分を確認。正式SQLの構文・PL/pgSQL、gateで例外時rollback、search_path復元、ACL、hard OFF、既存guardを確認。指紋照合の間接依存や環境識別の限界を明示。DDL並行変更を止める運用条件を定義。
2. 既存isolated-http/run.pyを利用し、使い捨て合成DBの指紋と履歴だけを明示的に差し替えた試験コピーで正式案を実行。実本番指紋をローカルへ強制しない。opt-in欠落/指紋差異/履歴差異でDDLなし、正常でCOMMIT、新規6表/30内部関数/14公開RPC・権限・hard OFF、重複適用拒否、既存通常連携/スコア/ランキング代表1件を確認。試験に不要な実鍵やデータなし。原本の隔離検証のPASSを使い、差分に必要な再試験のみ。正式SQL本体をホストDBで実行しない。
3. 正式migration番号/履歴登録方法は独立レビュー後にCLIの対応コマンド・既存手動release方針に沿って確定。まだ migration ファイルを作成しない。正式SQL案の確定と適用承認は別。

## 適用順序案（すべて後続承認が必要）
- リリース対象SHA固定、既存Workerバージョン記録、DB定義/履歴/バックアップの復元可能性確認。バックアップには利用者データが含まれるため今回は取得せず別途明示承認・暗号化・保管/復元訓練。既存cloud_backup.py/H61手順の必要な部分だけを再利用。リリース中の並行DDL禁止、ロック競合は事前調整、失敗時自動再適用しない。
- 正式Stageの別承認後に環境別catalog確認・送信OFF DDL→旧アプリの加入/連携/スコア回帰→新Worker/アプリ結合試験。新旧DB/APIの非互換を生じさせないようDB先行。Workerコード未実装につきIP信頼境界、匿名制限、秘密のログ/URL/HTTP境界、score入力保持/再試行は別検証。
- 本番は別の明示承認後、同じ手順でcatalog再取得→対象SHAと指紋一致/backup確認→atomic DDL（送信OFF）→DB/既存アプリ検証→新Worker/アプリ配信・検証。DBのみ適用時は新機能に依存しない旧アプリを維持。送信OFFはメール予約のhard gateであり全公開RPCの無効化ではない。専用Vault鍵が存在すると登録済み経路は利用可能になり得るため、鍵設置は別の明示承認・アプリ/アクセス制御の準備後とする。鍵名の存在確認も別承認の範囲で行い値は出力しない。
- 専用Vault HMAC/暗号鍵は承認済み32byte独立・自動rotationなし。既存Vault/Worker keyは変更しない。WorkerのIP digest専用secretは別。実鍵値はログ/Issue/commitに残さない。pg_cronの有効化は別承認・影響確認・schedulerの時刻/実行role/名前の衝突チェック。ジョブは毎日03:00 JST（UTCなら0 18 * * *）、owner-only cleanup、既存ジョブを上書きしない、失敗監視。公式: https://supabase.com/docs/guides/cron/quickstart (同名ジョブ作成は上書き), https://supabase.com/docs/guides/database/vault 。設定後は確認のみ。今回実行しない。
- 送信ONはhard CHECKを扱う明示的な別SQLと、Worker/API/鍵/cron/Stage検証完了、実メール送信許可を条件とする。ONのSQLを今回作成・実行しない。

## 停止・復旧
- preflight不一致、対象外FK、RLS/ACL差、DDL error/lock timeout、対象外既存定義差、score/戦績/権限/通知異常、backup不成立はSTOP。COMMIT前エラーはtransaction rollbackを確認（再試行前に原因評価）。COMMIT後は自動rollbackとは扱わない。
- 初期導入後に異常があれば送信OFF維持・新機能停止・旧Workerへの切戻しを第一候補とし、DB追加オブジェクトは保持して状況確認。稼働中の新規招待/統合/監査をDROP CASCADE等で消さない。送信ON後の停止は別承認で送信を止め、既に送ったリンク/未処理招待/予約の状態を個別確認。既存承認・restore監査を維持。既存の reviewed merge 復元は対象を確認して別承認、他の編集後行を巻き戻さない。全DB復元は後続の正常更新を失い得るため最後の手段。無損失を保証しない。
- 本番適用・正式Stage・実メール・Vault/cron設定・マージ/デプロイは未承認。PR Draft、Project #2未同期。ChatGPTの今回の実行は本番metadata READ ONLYおよびGitHubへの候補保存のみ。正式SQL候補の実行・構文解析・独立レビューはまだ行っていない。Changelog markdownの取得はcontent-typeエラー、Cron/Vault公式ページは確認済み。
