# TASK-08 / H48：本番の実イベント・戦績・固定ペア・画像関連データ4,279行でPhase1→Phase2連続移行を検証

日付：2026-11-22 JST。既存[Draft PR #265](https://github.com/g-ambe/Padel-match/pull/265)／[Issue #264](https://github.com/g-ambe/Padel-match/issues/264)。

**採用検証：[GitHub Actions #44958408725](https://github.com/g-ambe/Padel-match/actions/runs/44958408725) → SUCCESS。** 有料Supabase Preview Branchを作らず、既存GitHub-hosted runnerの**ネットワーク切断済み一時PostgreSQL17**で実施した。本番は`REPEATABLE READ READ ONLY`接続のみ。Stage/ProdのDB変更・Cloudflareデプロイ・main/PRマージなし。

## 1. H47からの追加検証の狙い

H47は本番22表の**READ ONLYハッシュ監査**とアプリ304テストPASS、H45/H46は本番実グループ関係6表の**限定列**でMigrationの継続実行をPASS済み。

H48では、H45の6表に加えて、これまで本番データを使ったMigration前後の比較が未完了だった**18の既存業務表・全元列の全行**を同じ隔離DBに復元し、Phase1(6工程) → Phase2(11工程)で一切変わらないことを確かめた。

### 実際に取り込んだ18表

| グループ | テーブル・実件数 |
| --- | --- |
| イベント | `events` 91、`rounds` 336、`event_participants` 626 |
| 通常試合とGPの基礎 | `matches` 521、`match_players` 2,084、`match_results` 351 |
| チーム戦 | `event_team_matches` 8 |
| 公式戦 | `official_events` 4、`official_matches` 15 |
| 固定ペア | `event_fixed_pair_state` 10、`event_fixed_pairs` 2、`event_fixed_pair_rounds` 78 |
| 操作履歴 | `friendly_match_operations` 125 |
| 個人画像管理 | `player_profile_private` 1、`profile_media_objects` 1、`profile_media_operations` 1、`profile_media_attempts` 1 |
| 施設 | `padel_facilities` 24 |
| **合計** | **18表／4,279行（全元列）** |

加えてH45の6表（`clubs`13/`club_members`41/`player_profiles`84/`profiles`7/`join_requests`3/`player_profile_link_requests`3）も限定列で同時復元、Phase1/2前後の列ハッシュ・人数RPCなどのチェックを再PASS。H45側の6表は**全元列ではない**ので、18表と区別する。

## 2. 実行方法と監査結果

`159_h48_real_legacy_data_preservation.py`を追加、既存`153_h45_real_group_data_migration_rehearsal.py`と登録済み`.github/workflows/task08-staging-b0-auth-http.yml`から、明示フラグ`H48_REAL_LEGACY_TEST=1`でのみ起動。

1. **Source READ ONLY**：Prodの実スキーマ／権限／RLS／Migration名・versionとH45六表の限定列、およびH48十八表の**全元列・全行**を同じREPEATABLE READ Snapshotで取得。行数上限、存在するテーブル/列、最低件数を照合。
2. **隔離復元**：本番スキーマとACL/RLS/関数を隔離Postgresへ復元し、本番スキーマのメタデータ一致PASS。6表の限定列＋18表の全列をDocker内へ復元。インポート時の`session_replication_role=replica`は**ローカルコンテナ内だけ**で用い、`auth.users`実データなしでも既存FK参照を持つ業務行を復元した。
3. **移行前**：18表の各元全列JSONBからSHA-256ハッシュを照合して**PASS**。元の通常/チーム/公式試合・固定ペア/画像参照・既存スコア異常・RLS/anon ACLの監査結果を記録。
4. **Phase1：6工程SQL実行**。H45名簿バックフィル41件と権限の前提PASS。**18表全元列の全行SHA-256一致**、スコア・固定ペア・画像参照/RLS値一致→**PASS**。
5. **Phase2：11工程SQL実行**。H45公開名簿の人数/本人同意とMigration履歴再実行防止PASS。**18表全元列の全行SHA-256一致**、スコア・固定ペア・画像参照/RLS値一致→**PASS**。
6. **後片付け**：一時SQLと実データをGitHub Artifact/Repo/Stageへアップロード・保存しない。`finally`とActionsの`if:always()`でRunner一時ディレクトリ・Dockerコンテナを削除→**PASS**。

### 監査上の主要条件

- 通常`match_results`親試合欠落/二重保存/完了状態と結果の不一致 → 0
- チーム戦/固定ペアstate/pairs/roundの親イベント欠落、固定roundのround参照欠落 → 0
- 公式試合の親イベント欠落 → 0
- 画像オブジェクトと非公開プロフィールのアバター参照・本人所有者不一致 → 0
- 固定ペア・メディアオブジェクトのRLS=true、匿名の直接SELECT=falseのまま
- 既存`同点なのにB勝ち`5件、`負得点`1件は**移行前後で変わらず**。勝者やスコアの値を勝手に書換えない。

## 3. 途中の失敗と原因

| Actions | 結果と修正 |
| --- | --- |
| [#44958331284](https://github.com/g-ambe/Padel-match/actions/runs/44958331284) | 初回FAIL。`H45`スクリプト内のH46専用ローカル`import importlib.util`が、新規H48の事前importと同名の局所変数に解釈され`UnboundLocalError`。**Migration/本番データの検証処理へ未到達**。局所importを除去し、トップレベルimportを共用。 |
| **[#44958408725](https://github.com/g-ambe/Padel-match/actions/runs/44958408725)** | **SUCCESS**。ローカルデータの復元4,279行、移行前、Phase1後、Phase2後の18表全元列SHA照合と参照・権限の監査、H45六表の限定列チェック、後片付けがすべてPASS。 |

**アプリ機能・既存Migration SQL・本番データは修正なし。検証スクリプト／ワークフローの opt-in のみ修正。**

## 4. 実データ取り扱いと限界

- **実データ許諾に基づく対象**。18表を全元列で取り込むため、**ゲスト名・共有トークン・動画URL・固定ペア操作データ・画像のR2オブジェクトキーなども一時的に**GitHub-hosted runnerのメモリとネットワーク切断済みDocker DBで扱う。**レコードはログに出さず、GitHubのArtifact/Release/リポジトリに保存しない**。CIのSecretsは既存のREAD ONLY DB URLだけ。R2接続や画像ファイル自体のダウンロードは行わない。
- 本番スキーマを再現したDBでのSQLと元列保持検証であり、**実際のCloudflare R2オブジェクトや動画先サイトの稼働、App画面のHTTP/ブラウザ操作を保証するものではない**。画像の参照整合はDBメタデータまで。
- H45六表の限定列以外のすべてのDB表や`auth.users`を完全復元したわけではない。隔離DBへの初期データ注入時はトリガー/FK検査を一時無効にしている。**完全な本番DBを使った実HTTP/RLSのE2E検証ではない**。
- 本番は稼働中のため、正式リリース時には再度最新の本番スナップショットで保全確認が必要。事前/事後の差分が通常のユーザー操作による変更か、Migrationによる変更かを区別する。

## 5. 最終状態と次の判断

成功Actionsの実ログから、グループ公開数2／対象所属14／本人同意待ちの連携済み4／公開対象未連携10を含むH45の挙動も継続PASS。

事後の本番READ ONLY：Migration **22**、クラブ **13**、所属 **41**、イベント **91**、試合 **521**、試合結果 **351**、公式試合 **15**、固定ペア登録 **2**、画像オブジェクト **1**。新共有RPCは未導入。Stage Migration **74**、クラブ3／イベント0。既存PR #265は**Draft/未マージ**、Worker未デプロイ、Preview Branch費用なし。

**H48実データ保全はPASS。ただしTASK-08本番GOはまだ保留**：次は本番の旧UIとPhase1/2新RPCの依存、`main`自動Cloudflareデプロイ順、COMMIT後復旧・SQL Migration履歴の正式適用手順、実HTTP/画面確認を最終点検する。TASK-08未実装の同グループ画像表示／メール招待等は別途残る。
