# TASK-08 / H48：実本番レガシー4,279行を隔離DBに復元してPhase1・Phase2適用前後の全行保持を確認

実施日：**2026-11-22 JST**。対象は既存Draft [PR #265](https://github.com/g-ambe/Padel-match/pull/265)／[Issue #264](https://github.com/g-ambe/Padel-match/issues/264)。
採用実行：[**GitHub Actions #44958408725 — SUCCESS**](https://github.com/g-ambe/Padel-match/actions/runs/44958408725)。

## 1. 結論とスコープ

**H48 PASS**：本番の実イベント・試合・チーム戦・公式戦・固定ペア・画像管理・施設の**18テーブル4,279行**をREAD ONLYスナップショットで取得し、無料GitHub Actionsの**ネットワーク切断済み**一時Supabase PostgreSQL17に復元。H45のグループ管理6テーブル（13クラブ・41所属・84選手・7プロフィール・3加入申請・3本人連携申請）も同一隔離DBへ復元したうえで、元の全18テーブルの**全列**を移行前→Phase1(6工程)後→Phase2(11工程)後で検査。各段階でJSONB正規化値のSHA-256照合が一致し、既存のスコア例外・参照整合・RLS・匿名アクセス規制も変わらなかった。

**重要な制限**：DB行レベルの保全試験。R2の実際の画像ファイル、Cloudflare Workerのブラウザ動作、実ログイン・JWT、動画外部サイトへのアクセス、実本番へのMigration適用は含まれない。

## 2. 18テーブルのデータセットと範囲

| 区分 | 本番のテーブル・実行数 |
| --- | --- |
| 通常開催/ラウンド/参加者 | `events` **91**、`rounds` **336**、`event_participants` **626** |
| 試合/参加枠/結果 | `matches` **521**、`match_players` **2,084**、`match_results` **351** |
| チーム戦 | `event_team_matches` **8** |
| 公式イベント/公式試合 | `official_events` **4**、`official_matches` **15** |
| 固定ペア | `event_fixed_pair_state` **10**、`event_fixed_pairs` **2**、`event_fixed_pair_rounds` **78** |
| 試合編集操作 | `friendly_match_operations` **125** |
| プロフィール画像・private管理 | `player_profile_private` **1**、`profile_media_objects` **1**、`profile_media_operations` **1**、`profile_media_attempts` **1** |
| 施設 | `padel_facilities` **24** |
| **H48追加の合計** | **18テーブル / 4,279行** |

これにH45のグループ関連**6表151行**を加え、隔離DBの対象は**24表4,430行**（表間重複なし、行数の単純合計）。すべての本番テーブルを複製したわけではない。R2ファイル・`auth.users`・セッション等は未取得。

### 実データの安全な扱い

- H48はユーザーが実データ利用を了承したため、実際の試合・選手名・URL・イベント共有token・非公開画像objectキー・media attempt ticket等を**データ行の一部としてGitHub runner上のプロセスメモリ**と**隔離Docker DB内部**で一時利用した。これらは検証専用であり、値を出力・永続ファイル化・GitHub Artifactsアップロード・Issue記載・Stageコピーしていない。
- Prodは`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`で取得。書き込み対象は`b.LocalRestore`でガードされたDocker内PostgreSQLのみ。復元時の`SET LOCAL session_replication_role=replica`は**隔離DBのみ**で、実本番の制約やトリガーは変更していない。
- 一時的に秘匿すべきトークン類も扱うため、**この検証コードを一般のPR・fork・公開成果物へデータ添付する形で転用しない**。GitHub workflowは既存の本家repo・専用ブランチ・明示トリガー・読み取り専用接続に限定。
- GitHub Actions `if: always()`のclean-upがPASS。一時DBコンテナと作業領域は削除済み。画像ファイルの実バイナリ自体はコピーしていない。

## 3. 実行ステップ・ログに基づく事実

| ステップ | 検証範囲 | 結果 |
| --- | --- | --- |
| 読み取り専用スナップショット | 本番schema・migration履歴・グループ6表・追加18表の本番実データ取得 | PASS |
| 隔離DB初期化・取り込み | H45のgroup側6表を復元、`profiles=7`/`player_profiles=84`/`clubs=13`/`club_members=41`/`join_requests=3`/`link_requests=3`を照合 | PASS |
| 追加実データ復元 | **18表4,279行**を一時DBへロードし、復元直後に元のレコード値の集合ハッシュ一致 | PASS |
| `before_phase1` | 元18表の全旧列の値、得点/固定ペア/公式/画像の参照整合とRLS/anon権限 | PASS |
| `after_phase1` | Phase1の6工程後に同じ旧列、整合と権限を再検証。H45名簿参照41行のバックフィルも一致 | PASS |
| `after_phase2` | Phase2の11工程後に同じ旧列、整合と権限を再検証 | PASS |
| H45追加検証 | 公開グループ2件の公開人数/表示同意・Owner NULLなし、移行履歴の登録と再実行防止 | PASS |
| 後片付け | Docker・一時ファイル削除（永続Artifactなし） | PASS |

証跡となるGitHub Actionsログ：
- 22:47:49Z「**H48 full legacy snapshot imported and hash-matched: tables=18 rows=4279**」
- 22:47:49Z「**H48 PASS: before_phase1**」
- 22:47:50Z「**H48 PASS: after_phase1**」
- 22:47:50Z「**H48 PASS: after_phase2**」
- 22:47:50Z「**H45 ALL PASS**」
- 22:47:50Z「isolated test cleanup: no hosted DB writes」

ログの時間はUTC。チェックサム・生の名前/UUID・URL・token・実スコア行はログに出していない。

### 失敗と修正も記録

- [初回run #44958331284](https://github.com/g-ambe/Padel-match/actions/runs/44958331284)：`unexpected_UnboundLocalError`でテスト起動に失敗。H45関数内の局所的な`import importlib.util`が、先に追加したH48のモジュール読み込み時の`importlib`を隠すPythonのスコープ競合だった。**本番SQL実行より前に停止**。
- 修正コミット`6a92e88dfd7f`：H45の不要なローカルimportを整理。DB migrationの本体を修正したものではない。
- [再実行 #44958408725](https://github.com/g-ambe/Padel-match/actions/runs/44958408725)：**SUCCESS**。Phase1/Phase2の実データ全件保持テストを完走。

## 4. 既存異常と保全判定の限界

- H47の本番READ ONLY監査では、旧スコアに**同点2-2で勝者Bの5試合**、削除済みイベントに**6対-1の試合1件**が存在する。H48はこれらを**自動修復せず、値と整合の前後比較**としてそのまま保持した。これらがTASK-08で新たに発生したとは判定していない。
- H48は本番schemaで実際の行を復元した隔離DBに対しSQLを実行したもの。**本番運用中の並行更新・R2メディア本体・認証ユーザー全表の実復元・Cloudflare公開後の旧UI兼用動作**を確認したわけではない。
- H47の304自動テスト、H45の公開名簿、H46の本人退会/Owner移管は別の既存検証。H48の全表保全と結びつけて本番GOとみなさない。

## 5. 次の作業と判定

**判定：H48のレガシー実データ保全はPASS、TASK-08全体の本番リリースはまだNO-GO。**

次はCloudflareの`main`マージ時の自動配信・旧画面が参照する`club_members`の匿名権限・Phase2の権限カットオーバー、二重Migration履歴防止、COMMIT後にアプリ切替が失敗した場合の安全な復旧順を最優先に確認する。

PR #265の既存作業ブランチ内に`159_h48_real_legacy_data_preservation.py`とH45検証からの`H48_REAL_LEGACY_TEST=1`専用起動を保存。**Prod/Stage DB、main、Worker、PRマージへの変更なし**。
