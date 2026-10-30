# RLS対応進捗（分母33固定）

対象8テーブル×4操作＝32、padel_facilities SELECTの確認1を加えて33。
SQL修正が不要でも、意図する公開範囲と実効権限を確認できたものは「確認済み・変更不要」で完了計上する。補助修正やテスト件数は重複計上しない。

| テーブル | 完了/予定 | 状態 |
|---|---|---|
| clubs | 4/4 | INSERT/SELECT/UPDATE/DELETE適用・確認済み |
| events | 2/4 | INSERT作成・DELETE権限整理は本番適用・作成/論理削除画面確認済み。SELECT/UPDATEは未完了 |
| event_participants | 0/4 | セット03：INSERT/UPDATEの2操作を本番適用済み・画面確認待ち。関連52項目と本番10比較成功。SELECT/DELETEは後続 |
| rounds | 0/4 | 未完了 |
| matches | 0/4 | 未完了 |
| match_players | 0/4 | 未完了 |
| match_results | 0/4 | 未完了 |
| player_stats | 4/4 | セット02本番適用・画面確認済み。旧表の直接アクセスを停止。関連75項目と本番メタデータ9比較成功 |
| padel_facilities | 1/1 | 公開施設マスタのSELECT。確認済み・変更不要 |
| 合計 | **11/33** | 残り22項目のうち2項目は本番適用済み・画面確認待ち。確認後13/33 |

施設の列はid/name/prefecture/address/source_url/created_atであり、グループの非公開情報・個人情報を保持する構造ではない。実装は施設選択の候補としてSELECTするだけ。既存RLSはanon/authenticatedにSELECTのみtrueを許可し、本番匿名ロールのREAD ONLY参照で読めることを確認した。開発用というポリシー名だけのために変更はしない。

補助対策：共有グループ名RPC＋表示修正、グループ削除ボタン修正、events ID/所属/作成者の変更防止は完了。TRUNCATE権限整理はセット01で本番適用・権限確認済み。3か月後の自動削除バッチと公式戦の名前編集は別タスクとして保留。

今後は影響が小さく独立した変更をセット化して一度承認し、確認もまとめる。一般メンバーの試合運営に深く関わるSELECT/UPDATEの条件変更は、影響を見て小さく分ける。
