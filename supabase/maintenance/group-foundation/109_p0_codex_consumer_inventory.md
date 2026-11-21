# TASK-08 / P0-H25: アプリDB消費者の現行ブランチ再調査（第1版・リリース判定不可）

確認日: 2026-11-20（JST）  
確認対象: `g-ambe/Padel-match`、既存ブランチ `codex/task-08-group-foundation`、PR #265、調査開始時HEAD `8eaa2331a24074bd8b8157a2b8a06e61a38f3666`。  
根拠: AGENTS.md / Issue #264 / `104_p0_compatible_cutover_sequence.md` / `105_p0_codex_anon_access_consumer_audit.md` / `108_p0_0040_0043_shadow_security_rollback_result.md`。

> **第1版はGitHub上の現行ソースを直接参照した主要入口の棚卸し。** すべての `from()` / `rpc()`、全呼出し元、DB関数本体、実JWT・正規共有token・ブラウザ動作まで通した網羅的安全性証明ではない。特に実行時のRLS/ACLと本番互換は別途検証する。**本番P0は未解消、PR #265はDraft維持、マージ・本番DDL/DML/GRANT/REVOKE・デプロイ禁止。**

## 0. 先行Codex bot報告の反映状況

PR #265への `@codex` 依頼（コメント `7031788947`）に対し、`chatgpt-codex-connector[bot]` は調査とローカルコミット（例: `90dd5e0`、`c1cfe77`）を報告した。一方、GitHub APIで**現行PR HEAD `8eaa2331`に本ファイルが存在しないことを確認**し、報告コミットも現行GitHubの参照先から取得できなかった。botの「ローカル作成」を「PR反映済み」とみなさない。本書はその穴を埋めるため、現在アクセス可能なソースから別途作成した第1版であり、bot文書の原本を取得・統合したものではない。

## 1. 対象入口・実装された取得経路

| 入口と現行コード位置（行番号は調査開始HEAD基準） | 対象利用者 / 取得・書込先 / 必要最小情報 | ACL/RLS依存・fallbackと匿名SELECT遮断の影響 | 判定 |
| --- | --- | --- | --- |
| `app/share/events/[token]/page.tsx:36-56` | token所有者・ログイン不要。専用anon clientで `get_shared_event(p_token,p_kind='event')`、共有イベント・参加者表示名・試合・動画等の最小DTO | 画面からのbase-table SELECTや失敗時の旧表fallbackを確認せず。匿名の基底表SELECTを閉じても専用RPCのEXECUTE・内部関数・token検証が正常なことが必須。通常/チーム/混合DTOの正規tokenの実HTTP正例が未完了 | **画面のbase-table改修不要（現行確認範囲）／実HTTP要検証** |
| `app/share/official-events/[token]/page.tsx:40-60` | token所有者・ログイン不要。`get_shared_event(p_token,p_kind='official')`で終了済み公式結果・対戦相手を取得 | 画面から公式基底表SELECTにfallbackせず。Prodの現行official匿名SELECTは別問題であり、本RPCをProdに導入・正規token/無効token両方検証してから遮断が必要 | **画面のbase-table改修不要（現行確認範囲）／本番RPC未移行** |
| `app/groups/discover/page.tsx:22-30` | 認証済みの公開グループ検索。`auth.getUser`後、本人所属RPCと `clubs.select(id,name,description,is_active,visibility)` | 匿名の直接SELECTを前提としない。今後authenticatedのSELECTも閉じる設計なら専用検索RPCが必要になる可能性。anonだけを遮断する現計画では必須の移行と断定しない | **authenticated列権限・公開範囲を保護** |
| `app/groups/[id]/page.tsx:237-295`、`lib/group-read.ts:13-35` | 認証済み。本人所属を `get_my_club_memberships` で確定、`clubs`最小概要。未所属・公開の場合は `get_public_club_directory`（reference/display_name/is_unlinked）と `get_public_club_member_count`（非負整数）、所属済みの場合のみ `get_club_roster`、管理者限定RPC、開催/戦績 | RPC失敗時に公開名簿から内部名簿/プロフィール表へfallbackしない。匿名は冒頭でログイン要求。人数0は正常、エラーなら不明。**未所属への内部開催/画像/戦績取得を増やさない** | **H21/H22の境界維持／本番RPC導入前は画面公開不可** |
| `lib/group-detail.ts:10-24` | 認証済み・所属者だけ。`events(id,name,created_at,status,event_mode)`、`official_events(id,title,created_at,status)`の開催メタ情報 | `internal=false`ではDBアクセスなし。所属者が利用するauthenticated基底表の必要権限を維持。公開未所属への開催一覧の掲載同意・安全な最小DTOは未確定。匿名公開へ拡張しない | **認証済み機能の回帰対象** |
| `lib/member-groups.ts:5-11` | 認証済み本人の所属一覧。本人所属RPCを起点に対象 `clubs(id,name,description,is_active,visibility)` を取得 | 本人用RPC + authenticatedの最小列許可が前提。匿名公開不要。共有用に広げない | **認証済み機能の回帰対象** |
| `lib/player-profiles.ts:46-72,105-150,169-228` | 本人プロフィール読取/保存は `get_my_player_profiles` / `save_my_player_profile`、本人利用件数は `club_members`・参加者・加入申請・チーム/公式試合の必要列をauthenticatedで参照。管理可能な所属更新も基底表 UPDATE を利用 | 匿名を閉じても本人の列SELECT/UPDATE、更新CAS/管理権限を壊さない。直接table呼出しを理由に匿名SELECTを残してはいけない。既存プロフィールテストの12失敗は別件で未解消 | **authenticatedの列/RLSを個別照合** |
| `lib/friendly-event-access.ts:9-49`、`lib/official-matches.ts:13-45` | 認証済み通常/公式イベントの所属・管理者権限。本人認証/本人所属RPC/`app_admins(id)`/`clubs(id,name,is_active,is_deleted)` | `clubs.is_deleted/is_active`の存在差分だけを処理する列fallbackあり。匿名base-tableへの権限fallbackではないが、認可を維持してStage/Prod差分を解消すること。安易にOR型PERMISSIVE policyを追加しない | **authenticated機能回帰・スキーマ差異ゲート** |
| `app/events/[id]/page.tsx:284-432,538-616,668-917,1040-1167` | 認証済み通常・チーム開催の本体。イベント属性/参加者/試合/結果/動画をbase tableから取得・更新し、一部は専用RPC。固定ペアは `lib/event-fixed-pairs.ts:25-45` のRPCを使用 | 認証済み運営者のSELECT/INSERT/UPDATE等の現行権限を保持。匿名base-tableだけを遮断する際に既存運営を壊さないか実Authで検証。H25 Stage固定ペア0040〜0043はROLLBACK検証のみで**確定導入なし** | **本番切替前の重要回帰** |
| `lib/round-lineup.ts:12-61` | 認証済み運営の次ラウンド・ラインアップ・試合削除・スコア保存。`get_friendly_lineup_versions`、`get_friendly_round_lineup`、`replace_friendly_round_lineup`、`delete_friendly_match`、`save_friendly_match_score` | 列/権限のほか、正規操作・競合・編集不可・スコア保存の実Auth確認が必要。RPC未導入のStage E2E不能をアプリ不具合/PASSと混同しない | **固定ペア/ラウンドStage移行ゲート** |
| `app/official-matches/[id]/page.tsx:121-154,176-318` | 認証済み公式イベント。イベント/対戦相手/試合履歴・結果取得と更新・動画計測/共有ON/OFF | 認証済みの必要なCRUDを維持。共有ページのanon専用RPCと本来の編集画面のbase-tableアクセスを分ける。公式共有token 正負例と編集者の操作回帰を別に実施 | **本番切替前の重要回帰** |
| `lib/profile-media/server.ts:14-45`、`app/api/profile-media/[id]/route.ts:7-39`、`app/api/profile-media/[id]/image/route.ts:6-16` | Bearer JWT・`auth.getUser(token)`、本人所有 `player_profiles(id,linked_auth_user_id,is_active)`、本人 `player_profile_private`、`profile_media_operations`、Cloudflare private `PROFILE_IMAGES` の読み書き | 画像URLを匿名汎用公開しない。現在の本人限定認証とprivate R2を維持し、Stage専用R2/secret/binding/DB-RPC・GC/競合を別ゲートで実測。グループ所属者相互の画像表示は**未実装**で、今は追加禁止 | **Stage画像機能未導入／本人限定維持** |

## 2. 匿名ACL遮断による影響の整理

- **画面側ですでにtoken専用RPCを使うもの**: 通常・チーム共有、公式共有。ここで直ちに新しいbase-table代替実装を増やさない。ただしStage正規token・混合DTO・Prod RPC存在確認は未通過。
- **匿名ではなく認証済みで現在もbase-tableが必要なもの**: `clubs` の検索・概要・施設、本人プロフィール利用件数、グループ所属者の開催履歴、通常/公式イベントの参加・編集・スコア、プロフィール非公開画像API。単にanon権限を遮断しても、authenticated側の必要列GRANT/RLSと実Auth試験を失ってはならない。
- **存在が判明したfallback**: `lib/friendly-event-access.ts` と `lib/official-matches.ts` の `clubs.is_deleted/is_active` スキーマ互換用のSELECT列切替。認可権限失敗時に匿名権限を求める経路ではない。公開ディレクトリ/人数RPCと共有tokenRPCについてはbase-table fallbackを確認せず。
- **P0事実**: 本番で匿名の所属・プロフィール・アカウント・公式イベント等に可視行があったというH20監査は未解消（Issue #264/104参照）。ただしこの監査文書は本番で再試験していない。

## 3. 今後のアプリ変更候補とDB側対応は分離

### Codex/アプリ側（今は実装しない）
1. 本文で参照した主要入口以外の呼出元も含めて、実HEAD基準で全 `.from()` / `.rpc()` を追加棚卸しし、匿名・認証済・本人/所属/運営の区別を固定する。
2. Stageで通常・チーム/混合・公式共有を本物の正規tokenで表示してDTO不足・無効token・共有OFF時の拒否を検証し、必要な差分があれば**その差分だけ**別のCodex指示で修正する。
3. 本人・運営者向けの固定ペア、得点、公式戦、R2画像の実Auth・ブラウザ回帰を残す。新規「所属者相互の画像表示」や未同意の公開直近開催を追加しない。

### GPT/DB・Stage側（アプリ改修と独立）
1. Issue #264/104/107/108に沿って、Stageの0040〜0043固定ペア・ラウンド導入前の現行認可互換、DB外バックアップと復元経路を確定。H25 ROLLBACK成功だけで正式適用の許可としない。
2. 別ゲートで0048〜0051画像系のStage専用R2/secret/bindingとリカバリを検証。Prodのsecretや画像を流用しない。
3. 新規安全RPCと本番既存機能の差分を整理し、**RPCを先に本番用意 → 対応アプリへ切替 → 共有/本人実Auth正負例 → 最後に匿名基底表を遮断**する。各本番操作にはユーザーの明示承認が必要。
4. 現行Prod上の正当な固定ペア/結果/画像データは削除・初期化しない。Stage/ProdでMigration番号だけを比較して原本再適用しない。

## 4. 検証と未完了

- 今回実施: GitHubでPR #265の現在HEADおよび上表のソースを読取り、現行コード位置・アクセス先を整理。**アプリテスト、TypeScriptビルド、Supabase SQLの実行、Cloudflare実機受入は未実施**（Markdown調査のみ）。
- 未完了: 監査対象の完全網羅／botローカル監査成果物との統合／Stage固定ペア・画像正式移行／DB外バックアップ・復元／本物の正規tokenを用いた共有正例／本番新RPC導入と匿名P0対策／実機受入。
- 作業禁止: 新ブランチ・新PR、アプリ/SQL/RLS/Cloudflareの無断変更、PRマージ、本番DB・Cloudflare操作。
