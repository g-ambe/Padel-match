# TASK-08-03 H18：Codexへのアプリ実装指示 — 管理者発信の本人連携とグループ別名

2026-11-20。正本 [Issue #264](https://github.com/g-ambe/Padel-match/issues/264) と `AGENTS.md`。既存Draft PR **#265**・ブランチ **`codex/task-08-group-foundation`** だけを更新する。担当分離：**GPT＝DB/Stage SQL・実JWT検証**、**Codex＝Next.js/UI/アプリ側テスト**、ユーザー＝本番リリース判断。

## DBが実装した契約（Codexでは修正しない）

- 正式Migration **`supabase/migrations/0061_receiver_named_profile_link.sql`** は**Stageのみ適用済み**。既存の本人連携申請`request_player_profile_link`、拒否/取消/旧承認`review_player_profile_link`、既存プロファイルマージ・同意snapshotは変更せず、受信者専用機能を追加。
- `get_player_profile_link_request(p_request_id uuid)`の返り値は既存のJSONB。**`is_recipient=true`・`detail_scope='recipient'`・pendingで未期限切れのときだけ**既存previewに以下3フィールドが追加：
  - `group_display_name_suggestion: string`：既存`club_members.club_display_name`があればそれ、NULLなら仮登録`player_profiles.display_name`。これは**本人の正規プロフィール名ではない**。
  - `group_display_name_current: string | null`：当該所属の保存済み**生の**`club_display_name`。nullを含め初期取得時点の値をCAS用に保持する。
  - `group_visibility: "public" | "private"`：公開同意チェック要否。管理者向けレスポンスには一切追加しない。
- **新規受信者専用承認RPC**：
  `public.review_player_profile_link_named(p_request_id uuid,p_review_token text,p_club_display_name text,p_expected_club_display_name text,p_public_confirmation boolean)`。
  戻り値は既存の `{status:"approved",merge_id:string}` に `club_display_name:string` と `public_name_confirmed:boolean` を追加したJSONB。**承認専用**。`approved/rejected/cancelled`の判定値は引数に送らない。
- `p_review_token` は**現在の**既存previewの`review_token`。既存の本人引継ぎ件数・所属・戦績の確認同意も必須のまま。期限/権限/他グループへの影響/正規プロフィール/元選手の統合可否は内部の旧`review_player_profile_link`で再検証される。
- `p_expected_club_display_name` は取得時のraw `group_display_name_current`（未設定なら**null**）をそのまま渡す。入力値や`group_display_name_suggestion`を代わりにCASへ送らない。差異は **HTTP 409／code `PT409`**、入力・POPを保持し手動再取得を案内。自動再送は禁止。
- `p_club_display_name` は受信者自身が確認・任意編集した**当該グループ専用の表示名**。trim後1～120文字/制御文字なし。**公開グループでは`p_public_confirmation=true`が必須**、未確認ならDB拒否。非公開グループでは`false`のみ送付し、公開済み扱いにしない。既存の「仮登録選手と所属・戦績を本人が引継ぐ」チェックとは**別の確認**。
- 承認時は受信者本人の選択名・公開確認時刻を当該`player_profile_link_requests`と`club_members`へ**同じDBトランザクション**で保存。プロフィール本体や他グループ・試合/戦績は変更せず、既存の`player_profile_merges`/ `merge_changes.after_row`に最終所属行が反映される。旧承認経路は互換維持し、**公開同意がない既存linked名は公開名簿へ出さない**。
- **DBをCodexから変更しない**。Migration 0054〜0061、Stage maintenance SQL、CIのDB検証コードはGPT管理。

## CodexのUI/API作業対象

1. **`app/profile/links/[id]/page.tsx`**：受信者のpending連携確認画面に「グループ内表示名」編集欄を追加。初期値は`group_display_name_suggestion`、既存仮登録名とプロフィール名を混同しない。public時は「承認後、この表示名が公開グループのメンバー一覧に表示されます」と明示した**公開確認チェック**を追加。private時は公開チェックを要求しない。既存の`ProfileMergeSummary`と「この仮登録選手が自分であり、所属・戦績の引継ぎに同意」チェックを保持。
2. **`lib/profile-links.ts`**：受信者専用の`ProfileLinkDetail`型に新フィールド（pending時だけ）を追加し、新named承認RPCを呼ぶ明示的ヘルパーを追加。`reviewPlayerProfileLink`は**拒否/取消/旧経路互換**のため残す。承認だけは新named RPCを使用。
3. 入力/チェックの成立前は承認をdisabled。成功時は既存表示と戻り導線を維持。DB拒否(42501)・入力制約(22023)・CAS(PT409)・古いpreview token・通信失敗・既に承認済みは、**内容を消さず、本人同意/公開確認を勝手に外さず、POPまたは画面の入力を保持**し、手動「再読み込み」を促す。**自動再送禁止**（連携が成功した後に通信が切れた可能性を考慮）。
4. 管理者向け申請一覧/詳細は既存の`detail_scope='manager'`のデータだけを使い、他グループpreviewや受信者の選択名・公開確認/連携トークンを表示・取得しない。管理者が本人の表示名・公開同意を代行する機能は禁止。
5. `rejected` と管理者`cancelled`は既存の`review_player_profile_link`を維持。公開グループ検索からのH17加入／本人申請とは別導線なので、新`submit_public_club_claim_named`は呼ばない。
6. 関連`lib/tutorial-content.ts`と初回チュートリアル/「使い方・ヘルプ」を実画面に一致する範囲だけ更新する。`AGENTS.md`順守・375px明暗・共通UI利用。既存の親機能の確定3タブ・戦績/ランキング・GP・チーム戦・旧スコア不一致6件、H15退会/H16改名/H17加入を勝手に変更しない。
7. 単体/合成ブラウザ試験：public/privの初期名と公開同意の分岐、linked受信者本人だけが承認、既存本人引継ぎチェックとの二重確認、token/CASの失敗時入力保持、manager詳細の非開示、拒否/取消と旧互換。TypeScript/Cloudflare OpenNextビルド成功を報告。既存プロフィールテスト12件は別件で、勝手に修正しない。
8. 新規ブランチ・重複PRを作らない。**既存Draft PR #265だけを更新**し、未マージ維持。**本番DB Migration・Cloudflareデプロイ・mainマージ禁止**。変更ファイル、テスト、未解消DB契約、差分SHAを報告。

## GPTのStage側の受入

- `78_h18_receiver_named_link_rollback_probe.sql`で**18判定すべてtrue、単一ROLLBACK**：公開/非公開、本人/他人、公開同意、CAS PT409、旧token、保存名と本人プロフィール名・別グループ隔離、旧承認の名前非公開、merge監査`before_row/after_row`。SQL適用後の既存Stage値は不変。
- 実JWT/PGRSTの独立試験は `79_h18_real_http_fixture_setup.sql`〜`82` に記録する。これはブラウザE2Eそのものではない。Codex UI実装後、GPTがRPC契約と統合レビューを行う。

**現時点ではProdは未移行／anon基底表ACL問題が残るため本番公開禁止。**
