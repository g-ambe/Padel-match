# OTHER-02 / TASK-01-21：Codex独立レビュー・隔離検証

2026-11-25 JST。候補作成者：ChatGPT、独立レビュー/アプリ実装：Codex。
対象：既存Draft PR #269、`codex/lineup-home-court-selection`。
レビュー基点：`167dcdba14fd7b24019b5c6998b0ea6a7ae71c1b`。
正本：[#267契約](https://github.com/g-ambe/Padel-match/issues/267#issuecomment-7148697896)、[#258契約](https://github.com/g-ambe/Padel-match/issues/258#issuecomment-7148698654)。

## 判定

**両候補の独立契約レビュー・下記隔離検証：PASS。範囲内にCritical/High指摘なし。**
候補は一切編集していない。正式Migration・本番適用の承認を意味しない。
本番/Stage接続・SQL適用、mainマージ、Cloudflare配信は未実施、Draftを維持する。

| 候補 | SHA256 |
| --- | --- |
| 01_nonfixed_lineup_candidate.sql | a8c3c182a915d0669a5e8d56f388a74b843ad31b33d7f2902ee79d492ec1b54c |
| 02_home_court_master_only_candidate.sql | 853c08b84a8ed2c4f205751bf1e3cf338ca74f5041bc1f2d84714ec7ccc03bd2 |

## 既存関数との差分・認可境界

| 対象 | 照合結果 |
| --- | --- |
| snapshot | 0042の全体禁止を生成時3履歴の保護配列へ置換。履歴の形/UUID/参加者/eligible包含・effectiveとapplied/splitの包含・ペア重複を検査。不明履歴のblocked_reasonは維持。参加資格/名前/カード/現在設定/監査等の既存snapshotに版1と保護IDだけを追加 |
| replace | 0041の既存署名・ロック・停止/終了・本人/操作ID・全snapshot CAS・カード/スコア/資格/重複制約を維持。サーバーsnapshotの保護配列を使い、各カードの保護選手の(participant_id,team)集合が不変であることを検査。別試合/チーム/休憩への移動、固定ペア全体の移動を拒否。クライアントの保護配列改ざんは先にCAS拒否 |
| 固定履歴 | effective/applied/splitの和集合なので両方休憩も保護。設定解除後も当該Roundの履歴を使用。元から一時停止だった固定は追加保護しない。played_idsと既存版/操作監査以外を更新しない |
| 旧save_my_home_court | 0051から非空名拒否(22023)を追加。空文字/NULL/btrim後空で明示解除。owner/consume、CAS40001、既存返却JSON維持 |
| 新save_my_home_court_selection | facility=NULL+非空名を拒否。施設ありはFOR SHAREで実在/閉業を確認しマスター名を採用。本人/ticket/CAS/返却JSON/画像枠と同じ既存処理 |
| 所有者/SECURITY DEFINER/search_path/ACL/RLS | CREATE OR REPLACEのみ、署名/所有者・SD・volatile属性・空search_path・EXECUTE、表/列ACL・RLS/policy・既存ガードtriggerと他関数は隔離カタログで前後一致。新規GRANT/スキーマ公開化なし。既存の参加者ID直接更新ガードも拒否を維持 |
| 適用自体の既存行保全 | 固定設定/生成監査/得点済み試合を含めた既存イベント・選手・出場・結果・履歴・操作監査、および旧ホームコート行・グループ施設参照が適用前後で不変。候補に既存データの一括UPDATEなし |

既存4関数のprosrc MD5は、リポジトリの0041/0042/0051から構築した隔離DBでpreflightと完全一致：snapshot `010f705b9679387987c4cf8de06a7074`、replace `08dc4dc64dc91cbc4bd043690bfc603c`、旧home `616651b00b92b2ec52f0d2f12907c656`、selection `a2ba8834ad9d738b40c8c01cacf03a5a`。候補をそのまま実行し、preflightを削除/変更していない。本番の指紋一致はChatGPTの上記Issue記録を参照し、今回Codexが本番をライブ再取得したとは扱わない。

## 実施した検証（タスク別）

### OTHER-02

- `node --test --test-isolation=none tests/lineup-candidate-db.test.cjs`：**17/17**（親含む）。同一/別コート/休憩入替、複数固定、片方/両方休憩・設定解除後の保護、固定全体移動拒否、固定0・4人以下/明示休みの一時停止、偽造期待値・重複・資格変更、在籍役職/super正例と別グループ/退会/匿名/直接DML拒否、操作ID・CAS、得点済み/終了/停止、スコア/正規削除、途中例外rollback、生成監査だけのグループなしと未知履歴拒否、不正固定監査を確認。played_idsが再読込・次Round生成の履歴に反映され、他の固定履歴・設定・使用済み印・スコアが不変。
- `NODE_PATH=/tmp/lineup-home-tools/node_modules node tests/integration/lineup-candidate-concurrency.cjs`：**実PostgreSQL17、3項目成功**。異なる要求の競合CAS40001、同一操作IDの同時再送（監査1件）、入替と参加状態変更の行ロック直列化。pg_stat_activityで2本目が実際にLock待機することを確認。loopback専用・使い捨て・架空データのみ。
- `node --test --test-isolation=none tests/round-lineup-client.test.cjs tests/guest-round-lineup.test.cjs`：**14/14**。版/UUID/配列型/重複/順序/未知参加者のfail closed、swapの固定拒否、成功済み再送結果に新DTOがなくても成功、既存のスコア/削除期待値・操作ID/再送とゲスト回帰。
- `node tests/browser/nonfixed-lineup.cjs`：**375pxライト/ダーク成功**。実React＋候補01実SQL/PGlite、合成Auth/REST。固定出場/片方休憩/両方休憩を（固定）表示・選択不可、非固定入替・保存/再表示、応答喪失後に同一要求で再試行、保護情報欠落/未知版/不正UUID/未知参加者なら全選手と保存を無効化、外部通信なし。
- 既存 `tests/browser/round-lineup.cjs` は候補適用と新しい固定選手の期待に追従。過去の全操作/画面幅/スクリーンショット検証は今回再実行していない。

### TASK-01-21

- `node --test --test-isolation=none tests/home-court-candidate-db.test.cjs`：**8/8**（親含む）。候補02をそのまま適用し、旧新RPC直接自由入力の22023、既存値/施設参照保全、偽名無視・施設改称・不明/閉業拒否、CAS40001、旧空文字/NULL・新未設定解除、他人/匿名/複数連携/直接UPDATE拒否、ticket再利用/短時間制限、画像・Instagramとの相互保全、途中失敗rollbackを確認。
- 先行UI/APIの施設ID・空name・期待版、成功/応答喪失照合は候補02の既存署名・返却値と一致。候補02はAPIを経由しない旧新RPC自由入力も塞ぐ。先行のプロフィール/グループ設定UI・APIコードは今回不変のため、前回375/320px・両テーマの成功証跡を再利用し、再実行しない。

### 適用安全性・共通

- `node --test --test-isolation=none tests/candidate-release-safety.test.cjs`：**2/2**。両候補でpostgres以外の実行・基線の違い/二重適用を拒否。末尾に障害注入した試験変種ではCREATE OR REPLACEを含め全体rollbackし、原文正常適用時も既存行と既存ACL/RLS/ガードが不変。原文を変更した正式候補として扱っていない。
- TypeScript `npx tsc --noEmit`：成功。
- `npm run cf:build`：Bun1.2.15 / Next15.5.29 / OpenNext1.20.17でWorker生成まで成功。合成loopback URL/公開キーのみ。設定・依存関係/lockfile変更、デプロイなし。
- 初期のSQLテストfixtureは同一ペア内の順序だけを入れ替えて「変更なし」となり、4人時に固定を新規作成して拒否された。前者を実際に異なるチーム/コート間で入替、後者を5人で設定後1人明示休みにする既存フローへ修正して再検証した。候補SQL/判定を緩和していない。
- 既存のworkerd compatibility_date警告、Node MODULE_TYPELESS_PACKAGE_JSON警告あり。無関係な設定変更はしない。

## アプリ差分

`lib/round-lineup.ts`に入替専用の保護DTO読取/検証と選手ガードを追加。`readRoundLineup`自体やスコア/削除のsnapshot処理は変えず、ゲストへDB契約を要求しない。`app/events/[id]/page.tsx`のDB入替POPだけへ保護ID/禁止理由を渡す。`components/round-lineup-editor.tsx`で固定選手を出場/休憩とも無効化し、swap処理でも拒否。既存の操作方法・スコア/生成/戦績/固定設定/ゲスト保存処理は変更しない。`lib/tutorial-content.ts`の共有説明に固定/非固定の操作を同期。

## 限界・残件

- PGlite/ローカルPGは実SQLだがAuthは合成SQL claims。ブラウザは合成Auth/RESTであり、実GoTrue/PostgREST・本番全スキーマ/RLS・本番Worker/物理iPhoneの受入試験ではない。
- 本番カタログ/履歴/配信状態は今回は未取得。最新の権限状態、正式SQL・履歴パッケージ・採番・バックアップ/復旧と適用の明示承認はリリース時の別ゲート。
- 採番・適用順序・停止/復旧は [RELEASE_PLAN.md](RELEASE_PLAN.md)。候補の正式Migration登録・履歴変更はまだ行っていない。
- Project #2は既存のアクセス制限のためIssue/PRで結果を保持し、同期済みとは主張しない。
