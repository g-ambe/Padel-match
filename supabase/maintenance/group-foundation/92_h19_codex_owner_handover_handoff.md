# TASK-08-03 / H19：Codex向け — 本人承諾付きグループオーナー引継ぎ

2026-11-20。**Issue #264のユーザー確定A案が正本**。既存Draft PR #265、既存ブランチ `codex/task-08-group-foundation` のみ。**GPT＝DB/Supabase Stage/RPC検証、Codex＝アプリUI・関連テスト**。新規ブランチ/PR・mainマージ・Prod SQL・Cloudflare本番デプロイは禁止。

## 決定済み仕様を維持

- 現オーナーが**メイン管理者権限のある本人アカウント連携済み在籍者**へ引継ぎを**申請**する。候補者本人が明示的に「引き受ける」まで`clubs.owner_id`は不変。候補者は「辞退」でき、現オーナーは「申請取消」できる。
- 候補者は同一グループの**active / status=active / role=main_admin / linked**に限定。サブ・一般は既存の役職変更機能で先にメイン管理者へ昇格し、**本人アカウント連携が完了してから**候補へ表示。
- 引受後の新オーナーはmain_adminを維持。旧オーナーの役職と在籍は維持し、**自動退会・自動降格しない**。旧オーナーは引継ぎ後に別の既存「本人退会」操作で自発的に退会可能。
- 最後のmain_admin保護を維持。現オーナー本人の降格・在籍無効化・所属解除は**引継ぎを完了するまでDBが拒否**。2回送信、通知の再使用、古い所有権・役職、候補者の退会・降格時の引受は拒否。
- **有効期限／自動承諾／自動辞退はまだ決定されていないので絶対に追加しない**。待機は本人の応答・オーナーの取消まで続く。過去イベント・プロフィール・戦績・他グループ・チーム戦には触れない。オーナー未設定の旧クラブは自動補完しない。
- 既存グループの確定3タブ（概要／メンバー／戦績）と「通常フレンドリー3タブ」は変更しない。

## GPT DB 実装済み契約（Codexは変更しない）

正式Migration：
1. `0062_owner_transfer_recipient_approval.sql` — 原子的なowner引継ぎ/本人通知/役職ガード。
2. `0063_owner_transfer_uuid_aggregate_fix.sql` — PostgreSQLで`min(uuid)`が使えないため集約を修正。
3. `0064_owner_transfer_decline_after_demotion.sql` — 候補者が降格後でも辞退は可能、承諾は拒否。

**すべてStageのみ適用済み**。0062を書き換えて履歴を潰さない。Prod未適用。

新しいアプリから呼ぶRPC：
- `get_club_owner_transfer_candidates(p_club_id uuid)` → `[{member_id:uuid,display_name:text}]`。**現オーナー本人だけ取得可**。候補者のauth_user_id、メール、ロール以外のプロフィール情報は返さない。
- `request_club_owner_transfer(p_club_id uuid,p_to_member_id uuid)` → request UUID。本人オーナーのみ。**1グループにつきpendingは1件**。重複＝HTTP409 / code `PT409`。**送信直後にはowner_idを変更しない**。
- `list_my_club_owner_transfers()` → `[{id,club_id,club_name,status,created_at,responded_at,is_sender,is_recipient,target_display_name}]`。ログイン本人が送信者か受取人の依頼のみ、最大100件。statusは`pending|accepted|declined|cancelled`。他者の情報・auth UUIDは返さない。
- `respond_club_owner_transfer(p_request_id uuid,p_decision text)` → `"accepted"|"declined"`。候補者本人だけ。acceptedではオーナー・所属・役職・連携を再検証し、**単一トランザクション**で`clubs.owner_id`を候補本人へ変更。declinedは所有者不変。候補者降格後も辞退できるが引受は不可。取消済・辞退済・引受済・古いオーナーの申請は`PT409`等で拒否。再送時は状態を再取得。
- `cancel_club_owner_transfer(p_request_id uuid)` → `"cancelled"`。当初の依頼送信者で、**今も現オーナー本人の場合のみ**取消可。本人承認済の依頼は取消不可。
- `public.club_owner_transfer_requests`のraw SELECT/UPDATE/INSERTは**直接禁止**。RLS有効で直接GRANTなし。受信者・送信者の一覧は専用RPCのみ使用。匿名EXECUTEは禁止。

通知は既存`public.notifications`に新列 `related_owner_transfer_request_id`（UUID）で関連付け。通知種別は `club_owner_transfer_requested`（候補者へ）、`club_owner_transfer_accepted` / `club_owner_transfer_declined`（旧オーナーへ）、`club_owner_transfer_cancelled`（候補者へ）。通知本文に本人のメールやトークンは含まない。既存の通知SELECT自己限定と既読更新ルールを維持。

## Codex担当の最小UI改修

1. `app/groups/[id]/page.tsx`：既存「概要」側のグループ管理導線に、**本人の現オーナーにだけ**「オーナーを引き継ぐ」を設置。本人が現オーナーかどうかを安全に判定（クライアントUIだけで認可しない）。オーナー情報がないlegacyクラブを勝手に修復しない。選択候補は上記RPCから取得し、**メンバー一覧から自由入力したIDを送信しない**。
2. 既存共通POPの確認操作を使う。候補者選択→「この人に引継ぎを依頼します。引き受けられるまでは所有者は変わりません」→送信。送信後はpending状態と「取消」を表示。候補がいない場合は「メイン管理者への昇格と本人連携が必要」と案内。自動で昇格・本人リンクしない。
3. 候補本人には通知/自分宛のpending申請一覧から**「引き受ける」「辞退する」**導線を設置。通知詳細は本人限定のRPCから取得する。明示POPで再確認してから`respond_club_owner_transfer`を送る。表示するのは対象クラブ名、候補者自身、申請時の説明、状態程度（他グループ・他人のAuth IDなど不要）。旧owner本人に承諾代行ボタンを付けない。
4. `components/notifications-content.tsx`：通知取得のselectに`related_owner_transfer_request_id`を追加し、対象の通知を本人限定の申請確認導線へリンク。既存プロフィール連携・加入申請通知の導線と既読機能を壊さない。通知元の情報は新RPCで確認、通知テキストだけで承諾したことにしない。
5. 元のownerがメイン管理者のまま役職編集・自主退会ボタンを操作してもDB側では拒否。画面上で先に「引継ぎが必要」と表示し、不要なrole更新要求は避ける（ただし権限をUIだけで制御しない）。引継ぎ成功後の旧ownerは既存`leave_my_club`で本人が選んで退会できる。owner変更だけで他操作を自動で走らせない。
6. 409/`PT409`、42501、期限のないpending、二重送信・通信切断・再取得時の状態変更を処理。**自動再送せず**、選択候補/POP入力を保持し、手動「再読み込み」で最新依頼/役職を照合する。選んだ候補が失効した時は申請・引受ボタンをdisabled、理由を案内。
7. `lib/tutorial-content.ts`の関連初回チュートリアル/「使い方・ヘルプ」を操作に合わせて修正。確定済みメンバー1人1行・チームA緑/B青・試合編成・GP・チーム戦など他要件は変えない。
8. 単体/合成ブラウザ試験（375pxライト/ダーク）：ownerのみ候補表示、候補なし・non-linked排除、request pending中owner不変、本人承諾→owner UI更新、辞退/取消、重複409・失効・通信失敗で入力保持、通知の本人限定、旧owner退会は別操作。TypeScript・Cloudflare OpenNext互換ビルドも実行。既存プロフィールテスト12件はベースライン別件として修正しない。

## GPTが済ませたStage検証／継続リスク

- `85_h19_owner_handover_rollback_probe.sql`：15判定すべてtrue、同一BEGIN/ROLLBACK（owner申請→本人辞退→再申請→本人承諾→owner置換→旧owner退会／他人拒否／owner役職ガード／通知・権限整合）。
- `86_h19_owner_handover_negative_rollback_probe.sql`：11判定すべてtrue（匿名/非owner送信、候補降格で承諾拒否、取消・再使用拒否、owner不変）。`87_h19_demoted_recipient_decline_rollback_probe.sql`：5判定true。
- `90_h19_real_auth_owner_transfer_once.mjs`：本物のStage JWT/PostgRESTで18/18 PASS（専用fixture 88、厳密cleanup 89）。**実HTTPでは所有権の承諾処理は永続化しない**。実HTTPで作成されたpendingを`91_h19_real_http_pending_acceptance_rollback.sql`でowner承諾→旧owner退会まで9/9 true、全体ROLLBACK。テスト用データ・通知はSQL89で削除。
- `tests/h19-owner-transfer-db.test.cjs`をStageの通常read-only CIへ追加。実連続2接続の競合ストレス/アプリ実ブラウザの本人承諾E2Eは別受入として残し、未実施ならPASSと呼ばない。Stageのもともとowner_id NULLのlegacyクラブ1件は修正しない。
- 新テーブルのRLSは有効だが意図的に**直接SELECTポリシーもGRANTも与えない**。Supabase Security Advisorが`rls_enabled_no_policy`（INFO）とauthenticated経由の明示的に権限検証するSECURITY DEFINER RPC（WARN）を報告することは把握済み。匿名EXECUTE禁止を検証している。本番権限切替/P0は依然別工程。

**本番DB・本番デプロイ・PRマージは明示的な最終承認まで禁止。**
