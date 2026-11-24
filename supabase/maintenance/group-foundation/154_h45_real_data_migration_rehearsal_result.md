# TASK-08 / H45：本番の実グループ・所属データを使った無償のPhase1→Phase2移行検証

日付：2026-11-22（JST）。実行：[**GitHub Actions #44953743963 — SUCCESS**](https://github.com/g-ambe/Padel-match/actions/runs/44953743963)。対象：既存Draft [PR #265](https://github.com/g-ambe/Padel-match/pull/265)／[Issue #264](https://github.com/g-ambe/Padel-match/issues/264)。

**結論：選択した実本番データと同じグループ・所属関係を、無料GitHub Actionsの隔離PostgreSQLへ読み取り専用で取得し、Phase1(6工程)→Phase2(11工程)を連続適用してPASS。** 元の列の全行JSONハッシュ照合、Phase1の参照名簿バックフィル、Phase2の公開同意初期値、実公開クラブの名簿/人数RPCまでPASS。**本番DBへMigrationを反映したわけではない。**

## 1. 本番DBから取得した実データ

| テーブル | 本番から取得した行数 | 検証に使用した列 |
| --- | ---: | --- |
| `public.clubs` | **13** | ID、グループ名、オーナーUUID、公開設定、有効/削除状態、日付、施設ID |
| `public.club_members` | **41** | ID、グループ/選手/アカウント参照、役割、所属状態、日時 |
| `public.player_profiles` | **84** | ID、選手表示名、連携ユーザーUUID、有効状態、作成日時・作成者UUID |
| `public.profiles` | **7** | ユーザーUUID、表示名のみ |
| `public.join_requests` | **3** | グループ、対象所属、申請者ID、状態・日付、公開名同意に関する参照 |
| `public.player_profile_link_requests` | **3** | リンク元/先ID、申請・審査IDと状態・日時 |

**除外**：`auth.users`、メール、パスワード/ハッシュ、JWT、セッション、紹介文、プロフィール画像、アバターURL、イベント名・試合・得点、動画トークン、通知の本文、本人連携の詳細スナップショットなど。6表の指定列以外は取り込んでいない。グループ名と最小限の表示名は検証のため一時的に扱うが、ログ・Artifacts・リポジトリへ出力しない。

## 2. 実行工程と結果

| 順 | 検証内容 | 結果 |
| --- | --- | --- |
| 1 | 本番に`REPEATABLE READ READ ONLY`で接続し、Prod schema/権限/関数/Migration登録と上記6表の最小列のみ取得 | **PASS** |
| 2 | ネットワーク隔離PostgreSQL17へ本番schemaと、上記の実行データを一時復元。元6表の指定列のJSON/SHA-256ダイジェストが取得時と一致 | **PASS** |
| 3 | Phase1の6工程を同一DBで適用、名簿参照`group_read_private.directory_refs`の登録件数が元所属**41件**と一致 | **PASS** |
| 4 | Phase1後も、取得した6表の元の指定列が全行ハッシュで一致。試験DB内のPhase1履歴登録後、Phase2適用資格が真 | **PASS** |
| 5 | Phase2の11工程を連続実行、指定した6表の元の列データが全行ハッシュで一致 | **PASS** |
| 6 | 新`club_display_name`と本人確認日時は既存41所属で全てNULL。匿名`club_members`直接SELECT不可、Owner引継ぎリクエスト表は新設/初期0件 | **PASS** |
| 7 | 実在する**公開グループ2件**のそれぞれについて、試験用認証済みJWT UUIDで`get_public_club_member_count`と`get_public_club_directory`を呼び出し、実データから算出した件数と照合 | **PASS** |
| 8 | 移行履歴：Phase1=1件、Phase2=1件、両フェーズ再実行不可の判定 | **PASS** |
| 9 | Runnerの一時領域と隔離DBコンテナを削除、StageやProdへ確定DDL/DMLなし | **PASS** |

**公開名簿の実データ結果（合計）**：有効公開グループ2件、対象所属**14名**、そのうちアカウント連携済み**4名**は移行直後の公開表示名・本人同意がNULLなので一時非表示、未連携の**10名**は公開名簿に表示。人数RPCは**14名**を返し、名簿の掲載件数10名と別管理する現仕様に一致。

**オーナー未設定の有効グループ**：移行元スナップショットでは**0件**。過去の「Wytel Bule Owls」のOwner NULLはユーザー指示で解消済みであり、検証データにも現在の状態が反映された。

## 3. データ取り扱いと費用

- 本番からの読み出しはホスト外Runner上の既存の読み取り専用バックアップDB接続で実施し、DBへ書き込まない。
- 行は**6表・限定列のみ**。実レコードはジョブのプロセス内メモリとネットワーク隔離Docker PostgreSQLでだけ処理し、個人名・個別UUID・メール・行データをログに出力しない。
- `SET LOCAL session_replication_role=replica`による一時データインポートは**隔離コンテナ内だけ**。本番環境ではこの操作を実施しない。このため全FK・authユーザー行を含む完全な本番復元テストではない。
- GitHub標準Runner（公開repo）を利用。**Supabase有料Preview Branchは未作成、追加のホストDB課金なし**。ジョブのfinally＋`if:always()`削除ステップが成功。

## 4. 未検証・本番GO判定

本H45は**データを含むグループ移行SQLの正当性の一部がPASS**した段階。次はこれまでの検証と混同しない：

- **実Authによる本人退会・Owner引継ぎの業務操作**を、移行前後の実メンバーを利用した隔離DBで試すにはauthセッション/RLSを安全に再現する追加fixtureが必要。今回の初期名簿・公開人数検証とは別。
- **試合521件・結果351件、固定ペア、写真、施設、通知/連携履歴の完全バックアップと回帰は未実施**。今回の実データは6表のみ。元データ全件維持は本番移行前後の別ゲートでも監視する。
- Cloudflare本番のmain自動デプロイとMigration順序、COMMIT後の旧UI復旧、匿名基底SELECTの残件、TASK-08未実装の同クラブ写真・メール招待は残る。
- PR #265はDraft/未マージ。**今回、ProdまたはStageのMigration履歴やアプリ配信は変更していない**。

## 5. 実装・証拠

- [`153_h45_real_group_data_migration_rehearsal.py`](153_h45_real_group_data_migration_rehearsal.py)：6表のカラムホワイトリスト、行数上限、源データと元カラムのハッシュ照合、実公開クラブRPC、履歴拒否の検証
- 既存ワークフロー `.github/workflows/task08-staging-b0-auth-http.yml` の`H45_REAL_GROUP_DATA=1`でのみ実行
- [Actions #44953743963](https://github.com/g-ambe/Padel-match/actions/runs/44953743963) で行数・PASSのログ確認。行の内容は出力されていない。

**判断：H45実グループデータ／Phase1＋Phase2＝PASS。ただしTASK-08全体の本番リリース判定は現段階ではNO-GO。**
