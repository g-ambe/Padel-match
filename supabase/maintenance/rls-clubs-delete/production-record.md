# Step 2 本番適用記録

- 2026-10-30 10:53 JST、padel-hub / ntczrmvffmpjzilfebyi。
- 承認：ユーザー「まずはWebアプリ側のデリートは防ごう」。事前提示したclubs直接DELETE制限の範囲。
- migration名：rls02_clubs_delete_denied。apply.sqlを実行し成功。
- 直後の読み取り検証：RLS有効、DELETEはrls02_clubs_delete_deniedのUSING(false)のみ、ALLなし。
- 他5本のポリシーは適用前後で完全一致。SELECT/INSERT/UPDATE/DELETEのテーブル権限も一致。
- スナップショット：production-snapshots.json。Security Advisorも再実行。
- 本番行の削除・更新によるテストは行っていない。通常の画面表示・保存の適用後確認は未実施。
- 定義に異常がないため切り戻し未実施。復旧用rollback.sqlは今回のDELETE変更だけを戻す。
- ローカル合成データではStep 1含む47項目成功。

## 別タスクとして保留する決定

論理削除から3か月以上経過した不要データの物理削除バッチは別タスクとして保留する。
今回バッチ・スケジュール・削除日時補完・データ削除は実装しない。
将来着手時に、対象テーブル・削除日時の統一・関連データの保存範囲・候補一覧の確認方法を決める。
