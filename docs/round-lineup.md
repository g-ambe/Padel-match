# 乱数Roundのメンバー変更

通常フレンドリーの自動生成Roundを対象とする。メンバー変更 → 選手 → 入替相手 → 保存。各コートの既存ヘッダーにボタンを置き、緑／青のペアを維持する。同コートのA/B、別コート、当該Roundの参加可能な休憩者と交換できる。保存前はコピーを編集し、取消で元のカードを維持する。スコア済みカードは変更できず、他の未入力カードだけ変更できる。同じペア内の表示順変更は構成変更として扱わない。

PR #180の `4eb48d1` のゲスト試作を再利用し、最新mainへ必要部分だけを統合した。古い開催詳細ファイル全体は復元していない。手動Roundの既存編集、チーム戦、公式戦は対象外。

## 保存と競合

### ゲスト

`lib/guest-round-lineup.ts` でイベント全体の期待値、開催中・auto、当該Round全カード、各ペア2名・4名・重複なし・参加状態・既存スコアを検査する。同期sessionStorage書込み1回でイベント全体を確定し、再読込みで確認する。書込み拒否なら元データを維持し、確認だけが失敗した場合の再試行は同じ保存結果を返して二度書き込まない。結果が不明な状態を自動で巻き戻さない。

編集の開始から終了まで既存boardOperationでスコア・生成・終了等と排他する。既存の履歴非参照のゲスト生成器は変更しない。変更後の出場履歴を保存することと、次Roundの公平性改善は別の問題。

### ログインイベント

0041の `replace_friendly_round_lineup` がイベント行をロックし、参加者行をSHAREロックして、期待スナップショット・現在の権限・開催状態・固定／参加履歴・構成・スコアを再検証する。全変更を1トランザクションで確定する。

`match_players` の行ID・match_id・teamスロットを保持し、必要なカードのparticipant_idだけを更新する。DELETE→INSERTはしない。試合・Round・日時・動画・結果・所属・プロフィールを変更しない。全カードの重複、他イベント、人数不足、対象変化は例外で全体ROLLBACKする。

`friendly_round_lineup_state` にRoundの版数、`friendly_match_operations` に操作ID・実行者・対象・要求・変更前後・基本試合表の更新行数・時刻を保存する（版数・監査表の行は件数に含めない）。操作ID再送は同じ結果を返し、別本人・別内容の再利用は拒否する。表示だけではこれらの行を作らない。監査を持つイベントの物理DELETEは参照制約で拒否し、既存画面の論理削除は維持する。監査消失・開催ID再利用を防ぎ、保管期限と将来の物理削除は別途レビューする。

## スコア保存の期待値

自動生成イベントだけ新しい `save_friendly_match_score` を利用する。構成・Round版数・結果の期待値をイベント行ロック後に比較し、結果行とcompletedを一括保存する。既存結果が複数なら管理者確認として拒否する。スコア範囲・勝敗計算・集計式を変更しない。

`ScoreInput` の追加オプション `captureCommit` は、入力開始時の送信関数を保持する。再試行は元のキューに残した関数を使用し、最新表示の選手へ期待値を差し替えない。ScoreSaveProviderとキュー本体は変更しない。手動・チーム・公式では従来の動作を維持する。

競合時も入力値を保持する。「最新データを確認」で正本を読み直し、選手・結果を見て得点を再入力する明示操作で新しい要求を作る。単なる再試行やモーダルの開閉で期待値を新構成へ更新しない。

## 固定ペアと参加・休憩履歴

- 対象Roundのeffective/applied/split固定履歴があれば編集不可。解除後も履歴と理由を保持する。
- 固定0組の生成監査がある場合、当時のeligible_idsと現在の参加可能者の共通部分だけを交代候補とする。後から加入した選手を過去の既知の参加機会へ補わない。
- 出場変更に合わせてその監査のplayed_idsだけを更新する。eligible_ids・元の生成要求・固定設定・有効／適用／分割履歴・used_fixed_pairsは保持し、変更前後も別監査へ残す。
- 監査がない過去Roundには参加機会を推測して作らない。現在の参加状態を検証し、変更後の通常の対戦履歴を保存する。
- 入替時に固定状態の版数も進め、古い生成要求を拒否する。固定設定・利用済み印は変えない。

## 生成・終了・旧クライアント

生成器は変更しない。ログインイベントの保存アダプターだけ `create_friendly_round` に切り替え、**履歴取得前**の入替版数と最新Roundを検証する。グループでは0040の既存保存実装を利用し、グループなしも全カードを原子的に保存する。要求IDを既存の保留生成保存に保持して応答喪失時に再送する。

旧 `create_fixed_pair_round` の実装本体は非公開スキーマへ移し、公開名は未編集イベント限定の互換ラッパーにする。入替後に固定版数だけを取り直して古い履歴で生成する経路も拒否する。既存RLS・IDガード・固定保護の定義は緩和しない。

旧直接スコアは編集済みRoundで拒否する。終了・生成はイベント行、参加状態は参加者行で直列化する。先行する操作を保存し、後続の古い期待値は安全に拒否する。旧複数リクエスト削除との競合では一方がデッドロック等で失敗する場合があり、再取得が必要。自動で削除を継続しない。

## 検証

- `tests/round-lineup-db.test.cjs`：PostgreSQL互換DBでRPC・権限・監査・旧経路・部分失敗・固定・適用／停止SQLを実行する。
- 同じ試験を隔離PostgreSQL 17で複数接続実行。pg_stat_activityで実際のロック待機を確認し、入替同士、スコアとの両順序、旧スコアとの両順序、参加状態・生成・終了との両順序を検証する。
- `tests/round-lineup-client.test.cjs`：元期待値・操作IDを保持するキュー再試行、応答喪失、ゲストの確認失敗後の冪等性。
- `tests/browser/round-lineup.cjs`：ゲスト・ログイン・グループなしの入替・取消・応答喪失・スコア競合・明示再入力、固定使用済み拒否、320/375/390px両テーマ。
- 既存のスコア・タブ・固定・生成モード・戦績・プロフィール連携・削除・ナビの回帰を実行する。新保存に対応する試験の通信対象だけ更新し、手動保存の旧安全性検査も残す。

隔離PostgreSQLでの再実行は空の専用DBが必要。`LINEUP_PG_URL` はlocalhostの `lineup_test` 以外を拒否する。`pg` は試験端末に別途導入し、アプリの依存へ追加しない。

```sh
# 新規の隔離コンテナを使用する。同名コンテナがあれば用途を確認し、無断で削除しない。
# 以下のパスワードはローカル合成DB専用。実接続情報を使わない。
npm install --prefix /tmp/padel-lineup-pg-client --no-audit --no-fund pg@8.16.3
docker run --rm -d --name padel-lineup-pg -e POSTGRES_PASSWORD=local-lineup-test -e POSTGRES_DB=lineup_test -p 127.0.0.1:55440:5432 postgres:17-alpine
# pg_isreadyで準備完了を確認してから試験する。
docker exec padel-lineup-pg pg_isready -U postgres -d lineup_test
NODE_PATH=/tmp/padel-lineup-pg-client/node_modules LINEUP_PG_URL='postgresql://postgres:local-lineup-test@127.0.0.1:55440/lineup_test' node --test tests/round-lineup-db.test.cjs
# 自分が起動した試験用コンテナだけを停止する。
docker stop padel-lineup-pg
```

## 検証結果

- 全単体テスト340件成功。既存の取得エラー・重複増殖防止・手動保存の安全性・戦績再計算の検査を維持した。
- 隔離PostgreSQL 17は27件成功。11通りの競合順序と、同じ入替／スコア要求の同時再送を含む。
- 個別復旧テンプレートは未承認停止、ROLLBACKによるプレビュー、合成データでの承認COMMITを検証した。
- TypeScript、Next.js本番ビルド、OpenNext Cloudflare Worker生成に成功。本番SQL・デプロイは実施していない。

## リリース前の保留

[手動適用・バックアップ・復旧の手順](../supabase/maintenance/round-lineups/README.md)をレビューする。0041は初期状態で入替無効。SQL適用 → 検証 → 別途マージ承認・新アプリ反映 → 検証 → 手動有効化の順序を守る。本番の最新カタログ、DB外バックアップ実ファイルの復元、本番JWT／実iPhone・Safariは未確認。本PRでは本番SQL・マージ・デプロイを行わない。

[375pxライト](assets/round-lineup/light.png) / [375pxダーク](assets/round-lineup/dark.png)。合成データのローカルChromium表示。実機の画像ではない。

## 変更ファイル一覧

```text
app/events/[id]/page.tsx
components/round-lineup-editor.tsx
components/score-input.tsx
docs/assets/round-lineup/dark.png
docs/assets/round-lineup/light.png
docs/friendly-rounds.md
docs/member-lineup-handover.md
docs/round-lineup.md
lib/event-fixed-pairs.ts
lib/guest-round-lineup.ts
lib/round-lineup.ts
supabase/maintenance/round-lineups/01_preflight.sql
supabase/maintenance/round-lineups/02_backup.sql
supabase/maintenance/round-lineups/03_verify.sql
supabase/maintenance/round-lineups/04_disable.sql
supabase/maintenance/round-lineups/05_enable.sql
supabase/maintenance/round-lineups/06_recover_reviewed.sql
supabase/maintenance/round-lineups/README.md
supabase/migrations/0041_atomic_round_lineups.sql
tests/browser/event-detail-tabs.cjs
tests/browser/event-fixed-pairs.cjs
tests/browser/friendly-scoreboard.cjs
tests/browser/match-navigation.cjs
tests/browser/round-lineup.cjs
tests/event-fixed-pairs.test.cjs
tests/fixtures/navigation-app.cjs
tests/fixtures/stats-helpers.cjs
tests/friendly-balance-history.test.cjs
tests/guest-round-lineup.test.cjs
tests/match-autosave.test.cjs
tests/round-lineup-client.test.cjs
tests/round-lineup-db.test.cjs
tests/score-input.test.cjs
tests/stats-history.test.cjs
```
