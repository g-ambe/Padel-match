# TASK-01-21 / #258：施設選択専用化のDB契約引継ぎ

調査基点：main `065ade4b0c579ea47eb0452a85a0f17cb651abb2`。
正本：[#258コメント7148177020](https://github.com/g-ambe/Padel-match/issues/258#issuecomment-7148177020)、[設定UI追加](https://github.com/g-ambe/Padel-match/issues/258#issuecomment-7148233314)。

## 実装済みのアプリ範囲

プロフィールは既存FacilitySelectorの都道府県別単一selectだけを使用。未掲載名は新規入力不可。既存の施設IDを保持し、従来の自由入力値は読み取り専用の「現在の登録」として表示する。selectが未設定に見えても、マウントや候補取得失敗ではonChangeを発火せず、本人の「登録解除」または施設選択でだけ更新する。他プロフィール項目保存時は既存changeCourt判定が同じ値を送らない。

`components/profile-media-provider.tsx`はHomeCourtSelectionのみを受け付け、施設ID/期待版を送る。名称は送信しない（既存API互換のnameは空文字）。応答喪失では施設ID＋進んだ版、解除時は名称NULLを確認。既存自由入力を新規保存として送らない。

`app/api/profile-media/[id]/home-court/route.ts`は既存本人認可・ticket/試行制限を先に行い、旧{name,version}と新{facilityId:null,name,version}の新規自由入力を400で拒否する。既存施設ID選択または空文字での明示解除を、既存 `save_my_home_court_selection` に渡す。p_nameは常に空文字、施設名はDBがマスターから決める。補助読込失敗で確定保存を取り消さず、認可/CAS/RPC失敗で旧RPCへfallbackしない。

グループ設定は既存FacilitySelector groupByPrefecture＋見出し「ホームコート（任意）」へ統一。既存clubs.main_facility_idの保存/取消/権限を維持し、新規作成画面は対象外。候補取得失敗を設定POPに表示し、既存IDや取得済み候補を消さない。グループ概要の「活動施設」は維持。

## まだ塞がれていないDB経路

0050/0051の `save_my_home_court(uuid,bigint,text,uuid)` と0051の `save_my_home_court_selection(uuid,bigint,uuid,text,uuid)` は、authenticatedの直接RPC呼出しで施設IDなし名称を保存できる。APIの拒否だけでは完全な自由入力禁止にならない。既存0051テストはこの旧仕様を再現する基線であり、新DB仕様の受入試験ではない。

## ChatGPTへ必要な候補SQL/契約

- **既存署名を維持できるか確定**。旧save_my_home_courtの非空名は拒否、空文字/NULLでの明示解除をどう扱うか確定（現アプリは新selectionへ空文字を送る）。新selectionは施設IDなし非空名を拒否。推奨SQLSTATEは既存入力不正と同じ22023だが、設計側で確定する。
- p_facilityありでは実在/閉業制限を検証し、クライアント提供名を信用せず正規マスター名を使用。返却JSONのhome_facility_id/home_court_name/home_court_versionとhome_facilityを現契約のまま維持する。
- profile_media_private.owner / consumeによる本人・正規プロフィール・ticket/短時間制限、CAS40001、画像変更枠を消費しない仕様、SELECT/EXECUTE/RLS/SECURITY DEFINERを維持。直接テーブル書込みを広げない。
- 既存自由入力・施設ID・マスターの一括UPDATE/削除/推測紐付けはしない。本人の施設選択/解除以外の公開プロフィール・写真・Instagram更新はホームコートに触れない。
- 旧タブの自由入力は安全にエラーとして再読込へ案内し、黙って解除/成功にしない。新アプリ→旧DBではAPIが自由入力を拒否できるが、旧RPC直接経路は未封鎖。DB候補レビュー/適用がリリース条件。
- 既存Migrationは不変とし、追加候補・採番・依存・権限維持・停止/復旧を設計する。グループDB/RLS・施設マスター変更は不要。

## 候補受領後の限定検証

旧新RPCの不正自由入力/偽装名/閉業/不明ID拒否、本人/他人/匿名/複数連携・CAS・ticket/利用制限、解除、施設改称、既存自由入力を含む無変更保全、写真/Instagram/他項目保存でホームコート不変、途中失敗rollback・応答喪失。
候補なしのため今回これらの新DB正負例は未実施。過去SQLへの回帰試験と混同しない。本番/Stage適用・マージ・配信は禁止のまま。
