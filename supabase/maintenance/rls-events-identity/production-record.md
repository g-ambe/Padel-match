# 本番適用記録

- 2026-10-30 13:39 JST頃、padel-hub / ntczrmvffmpjzilfebyi。
- ユーザーの「お願いします」により、直前に提示した付け替え防止ガードだけを適用・異常時切り戻しを承認。
- migration名events_identity_guardでapply.sqlを実行し成功。
- 直前のeventsユーザートリガー0件、専用schemaなしを確認後に実行。
- 適用後：guard_event_identityがenabled=Oで1本、privateのSECURITY INVOKER関数の本文が承認SQLと一致、anon/authenticatedの直接schema利用・関数実行権限なし。
- 全RLSポリシーの集計ハッシュ・eventsテーブル権限は前後で一致。
- Security Advisor再実行。production-snapshots.jsonに前後の定義・権限を保存。
- 本番でのUPDATE/INSERT/DELETE/TRUNCATEや付け替えテストは実施していない。更新拒否の動作は合成DBの検証で確認済み。
- INSERT制限とTRUNCATE権限剥奪は今回未適用。ガードだけで直接の不正INSERTまで防げた意味ではない。
- 異常がないためrollbackは未実施。必要な場合は当工程rollback.sqlだけを使い、既存RLSは維持する。

## ユーザーの確認（待ち）

名前編集権限のある主副管理者等で既存開催名を一時変更し、保存→再読込→元に戻して保存を確認する。
名前変更以外の通常更新、一般メンバーの終了/再開は必要な運営機会に確認する。検証目的で開催を終了したり、得点や所属先を変更したりしない。
この確認後に、未適用のevents INSERT制限を別途承認・適用する。
