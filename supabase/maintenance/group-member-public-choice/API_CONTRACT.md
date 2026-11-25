# TASK-08-03 / #264 — グループ内表示名・公開選択 API契約（ChatGPT候補）
2026-11-25 / base main 19592bc79a94fe64ed52903ca317cad7fb025ec6

## 状態・担当
01_chatgpt_candidate.sql はChatGPT作成の未検証原文。正式Migrationではない。
02_restore_compat_candidate.sql は監査履歴を変更しない保守復旧手順の修正候補。自動実行禁止。
Codexは原文を独断修正せず、独立レビュー1回と隔離検証を行い、問題をChatGPTへ返す。
本番SQL適用・マージ・配信禁止。ChatGPTが別途承認後に正式Migration確定・適用前後照合を担当。
仕様正本：Issue #264本文11/25、コメント7150614206（UI）、7150662242（DB調査）、7150679704（担当）、7150715145（限定検証）。
新規Issue・PR重複禁止、作業ブランチ codex/task-08-member-public-choice を継続。

## DB契約
club_members.club_name_public_choice: NULL（旧・未選択）、default_on（移行由来/初回初期化）、on/off（本人選択）。
旧club_display_name_public_confirmed_atは明示ONの確認時刻。移行で捏造しない。旧timestampあり・choice NULLは旧明示ON。
外部公開=有効な公開グループ、有効所属・有効プロフィール・連携済み、別名あり、選択ON/default_onまたは旧確認あり。未連携仮メンバーの既存公開挙動は維持。
非公開グループ・退会・無効・削除は外部公開しない。ON/OFF選択は可視性変更時に上書きしない。本人プロフィール・既存別名・他グループ・戦績・IDを保持。
移行は有効グループ/所属、正規本人プロフィール一意、auth存在、妥当な名のみ。直近本番READ ONLYでは8対象、未設定名5（公開4/非公開1）、公開未確認4、既存確認3。件数は再確認。未連携/欠落/対象外14連携は変更しない。
新規列への直接書込みを防止するため既存table INSERT権限を踏まえたinvoker triggerを追加。ACL/RLSを広げない。既存owner/guest insertは新しい公開設定を直接指定しない。
未選択などの内部状態をユーザー向けUIに表示しない。

## 自動保存RPC
public.save_club_member_field_v2(p_club_id uuid,p_member_id uuid,p_field text,p_name text,p_public boolean,p_expected_name text,p_expected_choice text,p_expected_confirmed boolean,p_expected_visibility text) -> jsonb
- name: p_name=新しい別名（trim、1〜120文字、制御文字不可）、p_public=null。
- public: p_name=null、p_public=true/false。公開グループの連携済み本人のみ。
- expectedは最新の在籍者向けrosterの生値。表示上のフォールバック名をp_expected_nameに渡さない。raw choiceのNULLをfalseへ変換しない。expected_confirmedは旧timestamp有無。expected_visibilityはpublic/private。
- 戻り値 member_id,club_display_name,public_name_choice,public_name_confirmed（旧確認の有無）,public_name_enabled（外部公開可否）,group_visibility。
- authenticated EXECUTEのみ、本人/権限をDBで再検証。仮メンバー名は既存管理権限のみ、公開トグル不可。役職変更は既存処理を再利用。
- 原則別項目を上書きしない。例外: 未設定の新規公開所属の初回名前入力はdefault_on、未設定名の初回公開トグルは正規プロフィール名で初期化する設計候補。初回ONの明示とオートセーブ順序が一致すること、OFFを選ぶ途中で一瞬公開しないことをレビュー。既存別名で未選択のケース（非公開→公開等）は名前変更だけで公開にしない。新規グループ作成の既存直INSERT自体は変更しない。
- 旧save_club_member_display_nameは連携済み本人の更新をPT409で停止し最新版を要求（旧クライアントからOFFをONへ上書きしない）。未連携管理者の旧名変更は維持。旧read DTOは維持。
- 同一メンバーの名前・公開自動保存をクライアントで直列化。各成功応答で生値を更新し、次の操作を最新スナップショットから送る。エラー/競合/応答不明なら最新状態の照合と入力保持、未確認の自動再送禁止。旧応答で別メンバー/グループのUIを更新しない。

## Roster・申請/連携
get_club_rosterの既存player_profiles JSONにpublic_name_choice, public_name_enabled, group_visibilityを追加。旧public_name_confirmedは旧確認有無のまま。未所属者向けget_public_club_directoryは既存3フィールドだけ、公開判定条件のみ更新。
submit_public_club_claim_namedの既存p_public_confirmationを「公開ON/OFF選択」として渡す（NULL拒否）。内部named join関数は直接実行権限を付与しない。加入申請では選択を保持し承認triggerで所属へ反映。既存別目的の所属・引継ぎ同意を変更しない。
review_player_profile_link_namedも既存boolを公開選択として扱い、publicでfalse許容。privateではfalseのみ、外部非公開。既存の本人同意・token・スコープ・merge/rollback境界・after snapshot同期を維持。
旧unnamed申請経路/直接RPCの既存挙動は変更しないが、新UIは必ずnamed gateway使用。旧経路が新OFFを迂回しないことを独立レビュー（安全性不足なら差し戻し）。古いクライアントで連携済み名前の更新が停止するのは意図した互換上の制約。
将来のメール招待#262はこの選択仕様へ整合するが今回実装しない。

## 画面契約（Issue #264が正本）
表示名: 鉛筆→その場で入力→Enter/blur（IME中/毎文字保存なし）。
役職: 鉛筆→リスト選択→既存権限/確認に従い自動保存。
公開: ON/OFFトグル→自動保存。現在のステータスを詳細に表示。既存選択を保持。
成功応答後のみ控えめな緑のcircle-check 2〜3秒。独立保存ボタン、編集POP、成功文章なし。失敗表示・入力保持・二重操作防止。非表示/退会は最下部で既存確認/保護維持。
同一サイクルのその他UI（総合pt info、不要成功文整理、グループ管理リンク削除、戻るボタン、SHUFFLE/CUSTOM/TEAM MATCHの確定文言、PADEL MATCH共通ヘッダー、グループ詳細ヘッダー、すべて見る、アイコン統一）をIssue本文どおり。関連チュートリアル・ヘルプ同期、英字タイトルは承認済み例外。

## 限定検証（独立レビュー1回、無関係な全件試験なし）
1. productionと同じ定義/権限を持つ無料隔離DBで01を実行。関数baseline hash不一致は停止（勝手にpreflight修正しない）。対象数は合成fixtureを別途明示。本番の29履歴/5件/4件は適用前のライブ照合であり隔離値ではない。
2. 移行: 未設定のみ、既存別名/旧確認/明示OFF/他所属/本人名/無効/削除/未連携を保持。二重適用拒否、失敗時transaction rollback。直接INSERT/UPDATEによるchoice/確認日時の偽装拒否、既存owner/guest作成正常。
3. 本人ON/OFF・名前変更、明示OFF→名前編集/旧RPC/可視性変更でもOFF維持、仮メンバー管理者名変更可/公開選択不可、他人/匿名/非所属/退会/偽ID拒否、競合PT409・別項目保護。初回操作で意図しない公開が生じないこと。
4. 未所属DTOは3フィールド、OFF/非公開/無効拒否、従来仮名表示・所属者の写真機能維持。加入/本人連携ON/OFFの承認、拒否/期限/競合/他グループ不正/既存履歴保全、旧unnamed経路確認。
5. 02は旧04の復旧ゲートを維持。新NULLキーだけの差異は許容し、実際の新選択や従来のalias等の差異は拒否。旧DBの既存4件の不一致は無断補正しない。新旧snapshotの隔離fixtureで正負確認後のみ実際の04へ反映。02自体の本番実行禁止。
6. UI関連のみ: 320/375px明暗、IME、名前/公開/役職保存成功・失敗・連続操作、既存操作権限、ヘルプ、TypeScript、Cloudflare互換ビルド。実行環境とHEADと結果を記録。

## リリースゲート
候補01は未検証。候補02は保守スクリプト候補でMigration対象外。Codexは本番SQL実行・再送、main merge、配信禁止。
ChatGPTは独立レビュー結果と実テスト証跡を確認し、対象ACL/関数/制約/履歴/更新候補集計、最新バックアップ又は別途承認済み保全範囲、旧新Worker互換・停止条件を確定してから本番承認を得る。
適用は本番Migration記録の自動採番、同一SQL blob確認、事後照合、正式ファイル登録、承認済みmain merge/Worker配信確認。旧クライアントの編集拒否の時間窓はリリース順に明示。バックアップ・復旧・本番承認の省略を勝手に継承しない。
