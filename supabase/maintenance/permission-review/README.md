# 一次再レビュー：既適用clubs／未適用events INSERT

2026-10-30、ユーザーが推論モードを「中」に切替後に実施。高モードや別エージェントで独立レビューしたという意味ではない。
本番では定義・権限のREAD ONLY参照のみ。DDL/DML/権限変更は未実施。

## 結論

適用済みclubsは4操作の意図したRLS定義を維持し、既存のローカル検証・ユーザー画面確認を無効にする新規不具合は今回確認していない。ただし保護範囲を超えた全体安全性は保証しない。
events INSERT案はSQL自体が直接INSERTを制限することと切り戻しを再確認できた。一方、残すUPDATEから所属/作成者を付け替えられるため、今の案だけを「無断の開催作成を防止する完成した対策」として本番適用しない。ID付け替え対策との順序を再設計する。
131件の成功には以下の**残存リスクが再現することを確認する4件**が含まれる。131件で安全性を認証した意味ではない。

## R1：events INSERT制限をUPDATEで迂回できる

本番にはdev_all_eventsが残り、eventsのユーザートリガーは0件。提案SQLも他操作維持のためUPDATE USING(true) WITH CHECK(true)を残す。
合成DBで直接の他グループINSERT拒否を確認した後、非所属ユーザーが本人のグループなし開催を作成し、club_idとcreated_by_auth_user_idを対象グループ/他人へUPDATEする操作が成功した。
これは今回新たに導入した権限拡大ではない。既知のUPDATE課題を、INSERT対策の効果を制約する具体的な経路として追加検証したもの。

次は通常の終了/再開/スコア処理を止めず、所属・作成者等の不正な付け替えを先に閉じる最小案を設計する。アプリで正当な所属変更が必要な経路がないかも調べる。INSERTだけ先に適用して全体対策完了とはしない。

## R2：RLS対象外のTRUNCATE権限が残る

本番clubs/eventsでanon/authenticatedにTRUNCATEの実効権限があることを読み取りで確認。ACLでも両ロールへの直接付与だった。両ロールはsuperuser/bypassrlsではない。
合成の外部キーなしテーブルでSELECTもDELETEも拒否されるロールにTRUNCATEを与え、RLSに関わらず全行が消えることを確認。合成DB内で権限を剥奪すると42501で拒否された。
**本番ではTRUNCATEを実行していない。** 本番は外部キー制約や追加テーブルの権限があるため、この合成結果だけで本番の実行可能性を断定しない。
通常のPostgRESTテーブルAPIに任意SQLを実行する経路があると確認したわけでもない。対象スキーマ内の関数本文とリポジトリをTRUNCATE文字列で検索し、該当なし。文字列検索は動的SQLや全API経路の安全性証明ではない。
次の候補は1テーブルずつの不要なTRUNCATE権限剥奪（REVOKE）と対応するGRANTの切り戻し。別の明示承認を受けるまで本番変更しない。通常の画面はTRUNCATEを使わないため影響を限定しやすいが、外部の管理処理は別途確認する。

## 他の確認と限界

- clubs UPDATE/DELETE/INSERT/SELECTの合成許可・拒否、共有名スカラー取得、切り戻しは既存100件で再実行。
- 所有者本人が所属登録前から読める、所属解除後もowner_id本人なら読める仕様は現行SELECT条件どおり。所属だけに限定した仕様ではない。
- club_members/player_profiles・eventsと子表の広い閲覧/更新、公開イベントからの共有トークン列挙、既存スーパー管理者のメール特例は今回も未解消の範囲。
- 127件は独立した127機能ではなく、既存clubs等100件＋今回events27件。テストを実装と同じAIが用意したこと、本番と合成スキーマの差も判断に含める。
- アプリ変更を伴わない再レビューのためTypeScript/Cloudflareビルドは再実行していない。

## 再現と記録

```powershell
node supabase/maintenance/rls-clubs-update/test-local.cjs --events-insert --review
```

PGlite 0.3.14 / PostgreSQL 17.5。前127件とリスク再現4件で131件。test-results.jsonに記録。既存の受入127件の結果ファイルは上書きしない。
production-readonly.jsonは本番メタデータの保存であり、本番書込みテストの結果ではない。

## 次工程のモード

利用可能なSol・中／Astra・低を確認したため、現在はSol・中を推奨。「高」必須という前の案は更新する。eventsの付け替え防止とINSERT制限の順、不要TRUNCATE権限の扱いを具体的に検証し、別途承認を得て本番適用する。

公式根拠：[PostgreSQL 17 RLS（TRUNCATEは対象外）](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)、[PostgRESTのテーブルAPI](https://docs.postgrest.org/en/v12/references/api/tables_views.html)。
