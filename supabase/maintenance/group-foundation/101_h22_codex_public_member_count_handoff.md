# TASK-08 / H22：Codex向け公開グループ所属人数RPC接続と開催情報の公開保留（2026-11-20）

**対象**：既存Draft PR #265、`codex/task-08-group-foundation`。AGENTS.md／Issue #264およびH21コミット`efb8d81`の確定3タブを維持。GPTはDB/Stage/Migration・認可検証、CodexはNext.js UI/関連テスト。**新しいPRやブランチ、マージ、Prod DB・Cloudflare本番変更は禁止。**

## H22でStage DBに追加済み

- 正式Migration **`0065_public_club_member_count.sql`**（GPTによる既存PR追加／Stageのみ適用、Prodは未適用）。
- 新RPC：**`public.get_public_club_member_count(p_club_id uuid)` → `bigint`（Supabase JSで整数のスカラー値）**。現在の`get_public_club_directory`と同様に**認証済み本人だけ利用可**。公開中・有効・非削除のグループにだけ返却。private／非存在／非公開／匿名は拒否。SELECT/GRANTは変更なし。名前、ID、役職、内部リンク、戦績、画像キー、総人数以外の情報は返さない。
- 件数は`club_members.is_active=true AND status='active' AND player_profiles.is_active=true`の**有効な所属行数**。linked本人の`club_display_name_public_confirmed_at`有無とは独立。**公開していない本人名も人数として数えるが、その名前は一切出さない**。`get_public_club_directory`の同意付き名簿3列契約は無変更。
- `99_h22_public_member_count_rollback_probe.sql`：Stageだけ、合成公開/非公開/0人クラブを使って**10/10真、BEGIN/ROLLBACK**。linked2人の一方は名前を公開していない状況で、人数2、公開名簿は人数より少ないことを確認。private/不明/NULL/anon拒否。
- 実JWT/PostgRESTの読み取り専用CI：`100_h22_public_count_real_auth_readonly.mjs` を追加。`.github/workflows/task08-staging-b0-auth-http.yml`でB0/TypeScriptに加えて実行。CI結果は `STAGING_HTTP_PLAN.md`のH22節を参照。全Stage公開クラブ、匿名、privateを検証するため**本番やStage実データを変更しない**。

## Codexによるアプリ側の次改修（小範囲）

1. `lib/group-read.ts`に専用の型付き`readPublicClubMemberCount(db,clubId)`を追加。戻り値は安全な非負整数を検証。不正DTOや通信失敗で画面全体をエラーにするかは既存H21のfail-closed方針に揃える。**他のRPCを変更しない**。
2. `app/groups/[id]/page.tsx`の「概要」。**未所属・ログイン済み・公開グループ**の時だけ新RPCでcountを取得し、`公開メンバー N人`＋差異注記を、正しい**`所属人数 N人`**に置き換える。取得失敗は「所属人数を取得できませんでした」と再読み込み導線を表示。**公開ディレクトリ配列の件数で代用してはならない**。所属済みは引き続き既存rosterと従来権限の表示を維持する。
3. 非公開グループ・認証なし・他者の名簿・画像・戦績を公開側から要求しない。非メンバーの`get_club_roster`・`loadStats`・`events/official_events`直接fetchは依然禁止。StageでRPCがエラーでも基底表SELECTへfallback不可。
4. 別のclub IDへ遷移・前画面へ戻る・通信中の再読み込みの際、古いcount応答が新グループに混ざらないように現在の`loadVersion.current`/`valid()`チェックを流用する。
5. 関連単体/375pxライト・ダーク合成ブラウザ試験：①公開メンバー表示数1 vs 実在籍2でもUIは2、②公開同意なし本人名は決して出さない、③非公開/未ログイン/メンバーには無関係なRPCを呼ばない、④RPC通信失敗→不明を示し偽の人数を表示しない、⑤H15〜H21回帰、TypeScriptとCloudflare互換ビルド。
6. `lib/tutorial-content.ts`は現行文に矛盾が生じる部分だけ更新。CodexはDB/Migration/`.github/workflows`を変更しない。

## 未実装：公開グループ概要の「直近開催」DTO

Stageの`events`には`created_at`があるが**通常イベントの独立した開催日列がない**。`official_events`には`event_date`がある。`events`・`official_events`の`share_enabled`は**既存のリンク共有の許可**であって、全公開グループ検索訪問者への**一覧掲載同意とは同義ではない**。共有トークン・イベントID・タイトル・日時を、公開名簿に無条件で開示しない。

**現時点で公開開催RPCは追加していない。** 今後、運営者がイベントごとに「公開グループの概要に掲載する」を明示設定すること、そのデフォルトOFF／過去イベント不遡及、通常/公式で開催日の意味、閲覧可能な公開詳細リンクの範囲をユーザーが承認してから、GPTが最小DTO/DBとStage負例を設計する。H21の現行「開催情報は所属後に確認できます」は安全な暫定表示として維持し、勝手な公開掲載や匿名共有GRANT追加は禁止。

## 本番ゲート

StageでのRPC作成／SQL rollback／実Auth検証が済んでも**Prodには0065および0054〜0064未導入**。Prod匿名base SELECT・Stage/Prodテーブル差分を解決するまではmainマージ／本番Cloudflare／Prod SQLは禁止。旧プロフィールテスト12件・スコア不一致6件は別件・勝手に修正しない。
