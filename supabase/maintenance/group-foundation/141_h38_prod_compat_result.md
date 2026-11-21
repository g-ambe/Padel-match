# TASK-08 / H38：本番グループ名・所有者移管・本人連携の移行互換候補（2026-11-21）

**既存PR #265のみ更新。Stage/Prodの確定DB変更は今回ゼロ。本番デプロイ/マージなし。**
本番に未導入の新RPCを入れる際、既存機能を壊さないために必要な**最小限の差分**を整理した。セキュリティ対象を追加していない。

## 本番で確認された差分と最小対応

| 分野 | 本番の既存状態 | 対応候補 | 運用制約 |
| --- | --- | --- | --- |
| 最後のメイン管理者 | `public.guard_group_last_main_admin()`＋`guard_group_last_main_admin` triggerが有効。DELETE・role・is_active・club_idを保護。ただしstatusのみの変更を対象としない | `136_h38_prod_last_main_status_bridge_candidate.sql`。Stage H09の関数を**status更新のみ**で呼び、既存トリガーを変更・重複登録しない | `54_h12_prod_compatible_rpc_candidate.sql`で `security_private` schemaを先に作る。Prod専用なのでStageの`task08_block_last_main_departure`名を無理に移植しない |
| 本人退会 | `leave_my_club(uuid,uuid)`が本番にない。元H15はStage専用トリガー名を要求 | `137_h38_prod_self_withdraw_candidate.sql`。H15の**関数本体は変更せず**、Prod既存トリガー＋status bridgeを前提にしたガードに差し替え | `0062`のowner移管より先に追加。旧ownerの無断退会禁止、歴史記録非変更を維持 |
| グループ内表示名・本人公開同意 | 本番 `club_members` には匿名**表SELECT**があり、匿名列専用GRANTはなし。元`0056`はここで停止する | `138_h38_prod_alias_atomic_cutover_candidate.sql`。**単一トランザクション内**で匿名表SELECTをREVOKEしてから、既存`0056`のDDL/関数/本人同意処理を**本文無変更**で実行 | **新アプリ公開と同じリリース工程のみ**。旧匿名グループ画面は切替まで一時的に使えなくなる可能性がある。途中コミットを単独実施しない |
| 本人連携申請の確認 | 本番には `profile_link_private.scoped_preview(uuid,uuid,uuid)` がなく、`get_player_profile_link_request`は旧`to_jsonb(request)`と全previewを利用。元`0061`の前提チェックが停止 | `139_h38_prod_link_scoped_preview_candidate.sql`。Stageで使うprivate scoped helperを新設し、既存`16_link_detail_staging_apply.sql`の本人/管理者表示範囲で既存詳細RPCを置換 | 本番の旧確認画面が期待するDTOを変えるため、`0061`および新UI公開に合わせて適用。変更前に実利用者画面の互換検証が必要 |

**特に重要**：本番の既存最後のmain管理者ガードを「存在しない」と扱い、同じDELETE/role/is_active/club_idトリガーを重複追加しない。必要なのはstatus列の差だけ。

## 実施済み検証（本番変更なし）

- 2環境共通の `140_h38_prod_cutover_readonly.sql` を実行：Prod 既存main trigger 1件・anon club_members SELECTあり・status bridgeなし・scoped previewなし・owner移管なし。Stageは新しいRPC/機能あり。本番データは clubs13 / members41 / events91 / official events4 の件数のみ照合。
- StageトランザクションのROLLBACK試験で、136のstatus-onlyトリガー・内部関数のコンパイルPASS、137の本人退会RPC本体のコンパイルPASS（匿名EXECUTEなし）、138相当の匿名GRANT→REVOKEの原子的復帰PASS。
- `139`のprivate helperと置換後リンク詳細RPCは、StageでCREATE OR REPLACEによる構文・実体チェックをROLLBACK実行してPASS。ソースのSQL終端を補修済み。
- 既存Stage実振る舞い `61_h15_self_withdraw_rollback_probe.sql`：オーナー/他人/重複退会拒否、本人/サブ管理者退会、歴史保持が全判定true。
- 既存Stage `85_h19_owner_handover_rollback_probe.sql`、`86_h19_owner_handover_negative_rollback_probe.sql`：候補本人の承諾/辞退/取消、第三者拒否、二重承諾拒否、通知整合など全判定true。
- **試験はROLLBACKのみ**。ProdへのDDL・GRANT・REVOKE・データ更新は実施していない。

## 最短の適用順序（まだ実施しない）

1. **先行追加できる候補**：既存 `54_h12_prod_compatible_rpc_candidate.sql`（共有取得/private schema）、`133_h37_prod_video_click_additive_candidate.sql`（動画token3 RPC）、元`0054`→`0055`（グループ取得）。既存の匿名SELECT/旧クリックはこの段階では残す。
2. **Owner準備**：`136`（Prod既存の最後のmainトリガーは残す）→`137`（本人退会の互換RPC）。
3. **新アプリ公開に合わせた切替**：`138`（匿名メンバーSELECT停止と`0056`同一トランザクション）→元`0057`～`0060`→`139`（scoped preview/連携詳細）→元`0061`～`0065`。この途中状態で新旧いずれの画面も完全動作すると**仮定しない**。リリースウィンドウと途中失敗時の復旧順を確定して一括実施する。
4. **PR #265のアプリとCloudflare配信**：本番に必須RPCが揃い、通常/公式/チーム戦・固定ペア・写真・プロフィール・グループの代表動線が動くと判断できた後だけ。現段階ではDraft維持。
5. **後処理**：新しい共有UIが配信された後にH35の旧動画クリックRPCの匿名実行権限を閉鎖。基底表の他の匿名公開権限は利用者影響を確認して対象限定、無差別REVOKEをしない。

## 未完了（本番GO条件）

- Prodスキーマ実体上での`0054`～`0065`連続DDL・RLS・実HTTP/ブラウザ互換検証は未実施。Stageだけの成功を本番相当の全PASSと扱わない。
- 本番の固定ペア・画像・施設24件、イベント・スコア/GP・プロフィールと既存運営画面は保持する。Stageへその全データをコピーすることは必須にしない。
- 本番用正式Migrationの登録・適用、切替の旧画面互換/短時間の停止時間、異常時の復旧方針、PR本番反映の許可は別判断。**`supabase db push`による無差別一括適用は禁止。**

## コード変更の担当
今回はDB互換候補だけなので**Codexの新機能実装は不要**。次の段階は本番切替パッケージの依存チェックと連続DDLの範囲を確定する。UIの動作不整合が見つかった場合だけ、既存PRに対象限定でCodex修正を依頼する。
