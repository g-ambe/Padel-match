# H16：既存所属メンバーのグループ内表示名・アプリ実装

正本：Issue #264 / [引継ぎ65](65_h16_codex_app_handoff.md)。
作業開始時のPR head：`25452077b5ef5d3d99ce00aca3aa02437565b656`。
既存 `codex/task-08-group-foundation` / Draft PR #265を更新する。

## 変更した挙動

- 内部ロスターの`player_profiles.club_display_name`と`public_name_confirmed`を型へ追加。
  本人プロフィール名とraw aliasを別に保持し、メンバー行は「グループ内表示名（本人プロフィール名）」を表示。
  旧linked+NULLは未設定と表示し、本人に設定ボタンを出す。初期入力は空で、本人名を勝手に保存しない。
- linkedの編集は本人だけ。管理者/superでも他人のlinkedは編集できない。
  unlinkedは既存の対象役職制限を使用。退会・無効選手・status非active・別グループは編集対象にしない。
- 共通AppDialogで編集。public+linked本人には指定の公開確認文とチェックを必須にする。
  private/unlinkedは公開確認trueを送らない。保存先は`save_club_member_display_name`のみ。
  CASはロスターのraw alias（初回NULL）で、グローバル名のfallbackを送らない。
- キャンセルで破棄。エラー/40001では入力とPOPを維持。利用者が「最新の状態を確認」を選ぶと、
  ロスターだけ再取得し、入力を保持したまま最新raw CAS値を採用する。公開チェックは再確認する。
  保存中の二重送信を防ぎ、他グループへ移動した後に遅延応答で新しい編集状態を閉じない。
- 保存成功時は対象メンバー行のalias/確認フラグだけを反映する。プロフィール本体・他グループ・
  戦績/スコア・加入申請/管理処理に使う既存の本人名は変更しない。
- 公開名簿は既存3列のRPC結果だけを使用。省略された未確認linkedを補完せず、内部名簿/旧表へfallbackしない。
  「使い方・ヘルプ」の関連説明だけ同期。初回体験にalias改名操作はなく、疑似体験ステップは変更しない。

## 確認結果

- `node tests/club-display-name.test.cjs`：新規8件成功。
  本人/他人/main/sub/super、未連携の対象役職、NULL、public/private、120文字/制御文字、CAS、
  同一選手のグループ別保存、RPC不正応答/失敗/通信断、公開3列/空一覧の非補完を確認。
- `node --test tests/group-read-client.test.cjs tests/h15-self-withdraw.test.cjs`：2ファイル成功。
- `node tests/browser/club-display-name.cjs`：375×812、Chromiumのdark/light両ケース成功。
  実際のアプリ画面で本人編集、他人linked/一般による仮メンバー編集UIなし、管理者の仮メンバー編集入口、
  キャンセル、public確認、二重送信防止、40001と入力保持/再確認、private、公開旧linked省略を確認。
  横はみ出しなし、POPと保存ボタンの44px領域を確認。スクリーンショットは撮影していない。
  **全通信はローカル/合成APIへ固定。Supabase実Auth・Stage RPC試験ではない。**
- 最終差分の`tsc --noEmit --incremental false`、`npm run cf:build`成功。
  Worker生成とNext/assets BUILD_ID一致を確認。Cloudflareへの手動配信は行っていない。
- 既存`player-profiles.test.cjs`：42件中30成功・12失敗。
  変更前2545207の関連lib/同テストを一時ディレクトリへ取り出し再実行しても、同じ12件が失敗。
  既存H10の本人取得/更新RPC化に対するGET/PATCH前提のfixture/期待値不整合が残る。
  今回のalias実装で同テスト・本人プロフィール処理は変更せず、成功扱いもしない。

## DB担当への追加対応・未検証事項

1. 新規加入時の名前確認を、加入申請/承認と公開確認にどう原子的に保存するかは未完了。
   アプリ側で加入申請の前後にalias保存を別送したり、本人名を自動コピーしたりしていない。
2. 旧仮メンバーの本人連携時のalias引継ぎ・明示同意・公開確認と、既存review_token/
   consent_snapshot/統合処理の一貫性が必要。既存統合確認文との整合も含めDB担当へ返す。
   不確定な引継ぎをアプリや追加Migrationで推測実装していない。
3. 旧linked未確認者の完全移行方針は未完了。公開名簿で省略される現行仕様を維持する。
   今回は在籍者本人が個別に設定・公開確認できる入口だけを実装し、一括バックフィルはしない。
4. 0056は`is_active AND status='active'`を要求するため、その条件に合わない旧復帰行は改名できない。
   データの自動補正はしていない。復帰データの不整合があればDB担当で確認する。
5. 本アプリとStage 0056の実RPCを接続したHTTP受入は未実施。GPT側のDB/Stage試験記録と、
   今回の合成ブラウザ/クライアント試験を区別する。実機の主観的な見やすさ確認も別途。
6. 本番anon SELECT遮断・0056 preflight・既存P0の適用順/安全ゲートは未解消のまま維持。
   本アプリだけを本番へ先行配信しない。関連既存プロフィールテスト12件の是正も別途必要。

## 変更していないもの

0056・64のSQLは変更なし。DB接続/SQL適用/データ更新はしていない。
0056 SHA-256：`91098d4a1cbc802e3ef326a5efb3a570a8f18d979f030c2ca4866e57f32d564e`。
64 SHA-256：`ee8013f5eaca147e973481a919a44d06691d2186f135d31803a3969bb0208b2d`。
H15本人退会、役職・復帰処理、戦績・スコア式、試合編成、画像、招待、ユーザーID、3タブ構成は変更なし。
mainへのコミット/マージ、本番SQL適用、本番デプロイは行わず、Draftを維持する。
