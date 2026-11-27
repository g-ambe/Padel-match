# TASK-08-02 / #262: 招待機能 DB/API 契約・候補03 (review only)
 
基準 main: 5fd308eea4f7d673c2a3e170c934876634154d94。承認: [基本仕様](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7157860703)、[認証分離・複数招待](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7166012903)、[付け替え](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7182981350)、[内部設定](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7183006329)。[候補02](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7182312203) と [実配送試験](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7182152763) を参照。以下はレビュー候補、実行・適用・リリース承認ではない。新規 migration は未配置。

## 最終仕様の優先順位

**最新正本：末尾の2026-11-27 修正06と承認記録 [#7206101373](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7206101373)。修正05によるイベント固有対応撤回は維持。以下の旧候補・未承認・最新等の当時の記載は履歴であり、新しい承認を優先する。**
候補02の認証・送信・同意の契約を維持し、異メール付け替えと承認済み数値は以下で上書きする。矛盾は本節優先、未確定は安全側で停止して報告。
- 200試行/rolling24h、仮所属3/日、宛先3/日、管理者10/日、グループ20/日。予約済み全状態合算、JST日付境界、仮所属および宛先60秒。管理者再送は実操作管理者、本人再送は元招待者。通常Auth送信は現行制限維持、招待導線の認証再送は合算。Gmail全体の送信保証ではない。settings初期OFF、global_24h_limit=200。
- 検索は明示招待操作時だけ、管理者単位・グループ横断20回/10分、ticket5分。入力時の検索、通常ログイン、再送、付け替えは対象外。既存検索RPCを使った制限の迂回可能性はレビューで評価し、既存契約変更は別承認。
- 招待7日(168h)、Auth認証1h、送信予約/処理lease各2分、終端暗号文/リンクhash消去、最小監査30日。期限掃除・監査の正確な保持対象/参照整合・鍵rotation・匿名IP制限の実装値は安全性レビュー対象。未確定のまま有効化しない。
- 既存アカウントのメール/PW/プロフィール名を変更しない。現世代の有効なグループ招待リンクを持つ別メールの確認済み既存アカウントは追加OTPなしで当該1件だけ明示的に付け替え可。リンクは当該招待のbearer credentialとなり、転送・漏洩時は別人による連携リスクがある（ユーザー承認済み）。第三者に共有しない注意書き。追加メールなし、期限延長なし、旧リンク失効、既存通常連携申請には適用しない。

## 付け替えの契約（候補02への必須差分）
- `POST /api/invitations/rebind/preview` 有効リンク＋確認済みauth.uid()で現在の自分のアカウントと元宛先マスクのみ。GET/メールプレビューで消費しない。リンク生値はfragmentからPOSTし即除去、URL query/ログ/Referer禁止。未認証・無効・他人の情報は中立応答。
- `POST /api/invitations/rebind` (operationId, inviteId, generation, secret, consent=true) → authenticated wrapper `rebind_club_invite`。本人実JWT、現在のauth.users/email確認＋正規プロフィール確認、CSRF対策、共有serialize_operationsと行ロック、現世代・hash・pending・期限・発行者権限・対象役職・source/club・競合・inflight不在を再照合。元宛先のメール所有証明とは扱わない。別メールの場合のみ。CASでbound_auth_id, bound_email_digest, bound_at, bound_generation, bind_operation_id を一度だけ設定し email_ciphertext/recovery_digest=NULL。元email_digestは監査用として不変。bind_operation_idは本人・invite・世代・入力整合を確認した冪等応答の識別子であり権限の根拠ではない。二重消費は拒否。通知・戦績統合はこの時点では行わない。
- 全recipient入口（list/preview/accept/reject/resend/claim）を統一条件で検証。unbound: 現在の確認済みメールdigestが元email_digestに一致。bound: auth.uid()=bound_auth_id かつ 現在確認済みメールdigest=bound_email_digest、bound_generation一致。元の宛先一致だけではアクセス不可。旧リンク、他招待、別アカウントは拒否。付け替え先のメール変更時fail closed。付け替え済みは元宛先へのメール再送不可。取消→明示再申請は回復候補、仕様拡張せず確認。管理者取消は現役職で可能。送信中は付け替えを拒否し、試行終端を待つ。reserve/claim/rebindは同一lockで競合を制御。
- 最終承認は既存named approvalを使い、各招待独立transaction。元メール一致の他招待を一括付け替えしない。本人に宛てられた有効な通常招待は従来どおり複数選択可。既存merge/監査、グループ名/公開選択CAS、戦績保持、同意必須。付け替え自体は所属連携ではない。

## 既存候補02 RPC契約（以下の旧記載は上記で上書き）
### 4. RPC・API契約（名前は候補。完全PL/pgSQL未作成）
認証付きRPCは本人JWTでauth.uid()を使用。WorkerのAPI経由だけの送信/匿名参照はpublic wrapperをservice_role限定EXECUTE（private schema非公開、direct table/内部関数拒否、固定search_path、明示REVOKE/GRANT）。service-only actor idはgetUser検証済みユーザーのみ、外部bodyのactor/role/宛先の上書きを拒否。所有者・prosecdef・ACLをカタログで独立確認。例外に生メール/tokenを含めない。ブラウザへservice_role/鍵を送らない。
- POST /api/groups/[clubId]/members/[memberId]/invite/check → check_club_invite_account(club,member,email): auth.uid、active club、対象未連携source/role制限、10分20回案をDB内で消費（拒否のカウンタをrollbackさせない）、同一宛先完全一致、確認済みAuth＋profilesかを判定。短命ticket（5分案、32byte乱数hash、manager/club/member/source/email digest/target bind）。返却は registered/signup_required + opaque ticket、ID/名前/宛先全体を返さない。既存検索RPCは契約変更しない。send時再照合、状態が変われば再check。
- POST .../invite/send {operationId,email,ticket,confirmRegistered}: registeredは明示確認必須。本人JWTでconsume_club_invite_lookupを実行しticket/現在target/権限/競合をlock内再照合、既存 public.request_player_profile_link(club,member,target)を実auth.uid()で呼びticket消費・結果link_idを同transaction保存。既存通知維持。二重操作は同じ結果、別payload拒否。signup_requiredはservice-only reserve_club_invite_send(...verifiedActor, operationId, ticket, email) → HMAC一致/再分類/期限/対象検証→招待/予約を原子的作成。既登録に変化した場合は勝手に送信せず再check。外部SMTPはcommit後のみ。
- GET .../invite: auth.uid/対象role再検証、状態・マスク宛先・期限・再送可能時刻・当日回数のみ。その他のグループ情報・メール/tokenなし。
- POST .../invite/resend {operationId,inviteId,generation}: 管理者の現権限/本人メール一致/現在世代の復帰参照のいずれか適切な認証を要求。期限内は同じinvite/期限、generation+1、旧hash消去、同じ宛先でのみ予約。期限後は管理者明示新規（旧invite expired、新7日、quota継続）。宛先訂正は明示取消→新check。拒否・取消を自動復活させない。inflightは待機、強制リセットなし。未認証復帰はPOSTのみ、任意宛先不可、IP/参照/宛先制限、invalidは中立応答。
- POST .../invite/cancel {inviteId,generation}: 現管理者権限・対象role・CAS、pending→cancelled、暗号文/hash消去。reservedはfailed/cancelled_before_claim、既にsendingは停止保証なし、finalizeは試行のみ更新。仮所属/戦績/Authは保持。
- claim_club_invite_send(operationId): service-only。共有lock→reservation CAS・期限・世代・設定ON・source/club/発行者＆管理者再送者現権限・メール固定・既存競合再確認。reserved→sending/claimed_at。group_inviteならfresh recovery hashを現在inviteへ設定。commit成功時のみ宛先/新参照/固定template用の現在グループ名等を返却。auth_confirmationなら固定宛先で通常auth.resend({type:'signup',email,options:{emailRedirectTo:固定許可URL}})用の限定payload、既存確認済みなら送らない。二重claimでは秘密を再返却しない。group SMTP/authの外部通信はDB transaction外、1回限り。
- finalize_club_invite_send(operationId,generation,result): service-only、sendingかつ当該operation/generationのCAS。SMTP250=sent(受諾、受信保証なし)、明確な拒否/確実なDATA前失敗=failed、結果不明=unknown、raw SMTP errorを記録しない。Auth API成功はSMTP配送保証ではない。旧世代/取消済みでも試行の監査結果だけ更新し招待復活不可。reserved timeoutはfailed(not_claimed)、sending timeoutはunknown(claim_timeout)、再claimなし。遅延応答でunknownをsentに戻さない。lease案 reserved 2分、sending 2分（SMTP全体タイムアウト20秒候補、Worker/API制限を隔離検証後決定）。通信中の取消は保証できない。再送は明示操作だけ。
- /auth/invite: GETは無害な画面、fragmentをPOSTで検証し直ちにURLから除去。未ログインは既存signup/loginへ。確認済み本人とメール一致した時だけ詳細取得、他アカウントのセッションには自動紐づけしない。登録中断/リンク期限切れは通常signup確認メール再送を案内。招待画面からのAuth確認再送は上記同quota(kind=auth_confirmation)、有効招待/固定宛先/未確認Authを再確認し、グループ招待世代は変更しない（候補。通常Auth経路の既存制限は保持）。Auth初回signupの確認メールは既存処理のまま。招待7日とAuth1hは独立。
- GET /api/invitations → list_my_club_invites(): 確認済みauth.uid＋profiles＋現在メールdigest、対象/発行者権限/期限/世代照合、該当本人の招待のみ。正規プロフィールが未生成なら既存整備へ案内。本人が別経路ログインした時も最新招待一覧可。非所属者へ他グループ戦績詳細は返さない。
- POST /api/invitations/[id]/preview → preview_my_club_invite(id,generation): 同本人/現在メール再検証、scope guard、既存 profile_link_private.scoped_preview(source,user,club) と raw club_display_name CAS値、visibility、本人用の表示名初期値、既存review_tokenの契約。公開ON/OFFは本人明示選択（既存public choiceを利用）。未認証/他人は404相当。
- POST /api/invitations/[id]/accept {generation,reviewToken,expectedClubDisplayName,expectedVisibility,clubDisplayName,publicConfirmation,inheritanceConsent:true}: public.accept_my_club_invite はauthenticatedのみ、auth.uid実本人。同じ共有advisory lockを取得し、既存lock_referencesと同一順で参照ロック、招待行FOR UPDATE、対象club有効・現在visibility一致・source仮所属/未連携/唯一の所属/履歴scope・発行者現在role/対象role・本人確認済みメール/正規profile・競合pending join/linkを再検証、明示同意/世代/期限/preview/名前CAS。内部で既存形式のlink_requestを生成し、公開RPC public.review_player_profile_link_named(link_id,review_token,chosen_name,expected_name,public_confirmation)をauth.uidを偽装せず同一transactionで実行。approved時のみ招待approved, recipient_auth_id, link_request_id, decided_at保存・暗号文/hash消去。通知は既存承認側を再利用し二重通知しない。既存mergeのrestore監査保持。成功済みは同じ本人/操作に結果のみ返す、違う本人/メール等へ情報を出さない。失敗は全rollback、他inviteは別transaction。
- POST /api/invitations/[id]/reject: 同本人/メール/世代/期限、pending→rejected/終端消去、仮所属・既存履歴保持。管理者の再承認なし。複数選択は個別acceptを順次呼ぶ（UIの各行 consent, displayName, publicChoice必須）。一部失敗は成功を戻さず個別結果、未選択保留。旧previewの対象変化時409で再確認。HTTP 429 quota、409 stale/conflict、404 unauthorized/not found、503 disabled、配送結果は送信状態を分離し個人情報なし。

### 5. 承認処理の主要SQL断片（前提：上記の全検証・ロックを済ませた同一transaction、変数はDB由来。独立レビュー対象、単独実行不可）
```sql
INSERT INTO public.player_profile_link_requests
 (club_id, source_club_member_id, source_player_profile_id,
  target_auth_user_id, expected_target_player_profile_id,
  requested_by_auth_user_id, expires_at)
VALUES (v_inv.club_id, v_inv.member_id, v_inv.source_profile_id,
        auth.uid(), v_canonical, v_inv.inviter_auth_id, v_inv.expires_at)
RETURNING id INTO v_link;
v_result := public.review_player_profile_link_named(
  v_link, p_review_token, p_club_display_name,
  p_expected_club_display_name, p_public_confirmation);
IF v_result->>'status' IS DISTINCT FROM 'approved'
 OR nullif(v_result->>'merge_id','') IS NULL THEN
  RAISE EXCEPTION '連携を完了できません';
END IF;
UPDATE club_invite_private.invitations
 SET status='approved', recipient_auth_id=auth.uid(),
     link_request_id=v_link, decided_at=clock_timestamp(),
     email_ciphertext=NULL, recovery_digest=NULL
 WHERE id=v_inv.id AND status='pending' AND generation=v_inv.generation;
IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='再確認してください'; END IF;
```
既存reviewは既存共有lock、元管理者role、対象所属、canonical、preview、merge、表示名CAS、公開choice、監査after snapshotを既に処理。新規直接merge禁止。旧コードの一部関数はmigration後の現DB定義が異なる可能性あり、最新pg_proc/hashをリリース前に再照合。新規承認入口から既存original private関数を直接呼ばない。visibility競合検出を追加、merge範囲の安全性は隔離DBテストで確認。



## SQLファイル・作業境界
01_schema_quota_review_candidate.sql は候補01基盤、候補02 DDL差分、承認済みglobal200、付け替え列と制約、quota helperを統合した**レビュー用のみ**。末尾ROLLBACK、公開RPCなし、migration runner対象外。構文・実行試験未実施。完全RPC本文、鍵・認可・role/lock確認、期限/監査cleanup、匿名制限、legacy lookup境界、冪等性の全ケース、実環境カタログ差分は未完成。独立レビューで欠落を確認し、完全SQLをこのbranch/PRに追記する。既存app/DB変更なし。SQL適用・deploy・merge・実メールは未承認。

## 検証ゲート
既存候補02の試験計画に追加: valid bearer+別確認済みログイン/明示同意成功、無効/旧/期限切れ/取消/別invite/未ログイン/未確認/CSRF拒否、50並行で1回だけbind、同時再送/取消/accept、元メール本人のアクセス拒否、別アカウントでのbind replay拒否、bound本人のメール変更、他招待非開示、bindのみでは所属/戦績変化なし、拒否/期限切れで既存データ維持、30日掃除でquota回避不可。実配送成功1件・CPU0.816msは既存証拠、統合負荷/並行/SQLは未検証。既存認証/通常連携/グループ公開設定の回帰試験必須。既存アプリ本実装はSQL独立レビュー後。 


## 2026-11-26 統合候補04 自己レビュー修正01（最新差分）
- 正本は `04_integrated_review_candidate.sql` の修正01（SQL commit `994e90087dc1b68a3d7a9ed58bf80c0be52079bc`）。既存01〜03ファイルは歴史資料。未実行、独立レビュー前、送信OFF・ROLLBACKのみ。
- rebind preview のDTOに `account_review_token`（当該招待・世代・現auth.uid・正規profile・確認済みメールHMAC・現復帰hashを束ねた鍵付きfingerprint）を追加。POST rebindに `accountReviewToken` 必須、RPC `public.rebind_club_invite(uuid,uuid,integer,text,boolean,text)` の末尾 `p_account_review_token` に渡す。表示後にアカウント/メール/正規profileが変化した場合は再表示・再同意。追加OTPやメールは不要。既存5引数版は作成しない。tokenはログ/URLに載せない。最終戦績引継ぎの同意とは別。
- 検索counterを消費した後のsource check・分類・鍵・ticket生成失敗を同一subtransactionに収める。Auth照合はSTRICTで行数変化時conflict。予約時刻は分類・権限等の再確認後に更新し、最終承認が期限を越えたら全承認subtransactionをrollbackする。仕様値の変更なし。
- NO-GO: 未承認の匿名再送閾値と付け替え後回復（30日purge後含む）、旧lookupの独立枠、固定10分窓の境界、匿名counterの例外rollback、チーム戦eligible snapshotとscope/lockの競合、登録済みの既存申請発行後のscope変化、実DB定義/ACL・構文・実行・並列試験。現候補から直接アプリ実装/適用に進まない。既存機能変更・権限緩和・実DB/メール・本番/正式Stage/mergeは禁止。既存API契約との差分は上記のみ（同意時のCAS強化）。


## 2026-11-26 自己レビュー修正02：登録済み連携の最終guardと乱数ラウンド互換性
SQL候補04 commit `844f285fde08874cd9fb6006870e02ce6fa618f1`（レビューのみ）。
- 0039のmerge_profilesは監査merge行をINSERTしてからsource参照を書き換える。登録済み招待が生成した既存link requestを消費済みticketのresult_link_idで特定し、新規BEFORE INSERT triggerで最後のscope/権限/対象/確認済みAuth/宛先/期限を再検査する候補。旧named RPC・merge本体・既存直接申請/joinの処理を置換しない。marker無しは即RETURN NEW。既存public.player_profile_mergesに新規trigger1個を追加するため、既存DBオブジェクト一切不変更という意味ではない。新規FKなし。監査行INSERT前の拒否により同一transactionをrollback。結果link_idに一意indexを追加。markerの期限は通常申請7日より長い30日、異常に長く有効なpendingが残るときはmarkerを削除せずrelease blockerとして扱う。既存direct RPCによる迂回は別評価。既存登録済み申請はAuth UID基準であったところ、**新招待経由のみ**現在メールdigest変化時に再確認を求める案。メール変更後の回復/取消再申請と誤拒否は要レビュー。
- 0045 event_team_rounds.eligible は生成時 roster JSON（source, key=profile:UUID, profile_id等）。lib/friendly-team-rounds.ts:67–72 はsource:keyで休み連続回数を計算する。app/team-matches/[id]/page.tsx:264–280,320 は終了済みイベントの再開を明示サポート。閉鎖済みであってもsource IDが残ったままmergeすると再開後の休憩公平性が崩れる可能性。既存mergeはeligibleを更新/復元しない。**現候補はeligibleにsourceを含む全ラウンド（終了済み含む）を一時拒否する。恒久仕様として未承認であり、正式版にそのまま入れない。** 既存試合/戦績/eligibleは直接書き換えない。
- 解決案（独立レビュー対象）: 保存済みeligibleをそのまま保持し、既存の未復元merge履歴を使ってチーム戦のfairness入力にだけsource→canonicalを反映する読み取り時正規化。対象club/元所属side/正規profile/復元状態/時系列・重複・連鎖・ID不整合を検証。過去snapshot本体や既存スコアを変更せず、restore時の挙動も維持する。これを安全に実装可能か、または対象限定の更新＋既存復元監査拡張が必要か、Codexが独立検証する。実装は承認待ち。全乱数ラウンドの招待拒否、旧イベント再開禁止、無監査のsnapshot書換えは勝手に確定しない。
- lock_accept_scopeは既存lock_references順序を維持した後、clubs/app_admins/events/event_team_sides/event_team_rounds/official_eventsにNOWAITの追加lockを取得する草案。長時間ブロックを回避する意図だが、旧関数のロック・同時ラウンド生成・行ロック・直接DML・Auth更新・PGRST timeoutを含む実並行検証は未実施。trigger経由の例外が既存named RPC全体をrollbackすること、旧直接申請/通常joinの無影響を証明する。
- 現段階は独立レビューに渡せる候補であり、アプリ実装・SQL適用・リリースのGOではない。匿名再送閾値、bound後回復、30日削除後の回復、旧lookup経路、cron/鍵、隔離実行は継続NO-GO。Codexはread-onlyレビューで指摘・最小修正案・隔離試験計画をPRへ記録し、仕様の決定や実装・DB/メール・マージは行わない。


## 2026-11-26 独立レビュー修正03と残る仕様決定

独立レビュー [PR #273](https://github.com/g-ambe/Padel-match/pull/273#issuecomment-7185769923) / [Issue #262](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7185775453) のNO-GOを受領。候補04の修正03 SQL commit `285fd1f1bf77a3201fdbcfa06c118116991cd0d4`。未実行・未適用・送信OFFを維持。

### 1. 構文と検索制限
- guard_registered_invite_merge の単独ドルを対応する名前付きドル引用に修正。全体の文字列・コメントを除いたドル引用の対応48組、関数名45本重複なし、ROLLBACK/COMMITの静的検査のみ。PostgreSQL parser/PLpgSQL compileは未実施。
- 検索制限は、任意の連続10分間（左端を含めず右端を含む）で最大20回という厳しい解釈を候補とする。管理者1名につき最大20時刻のみをprivate tableの配列に保持。共有serialize_operations、行ロック、DB時刻により直近10分の件数を確認し追加。検索拒否時に新時刻を追加しない。権限ある対象への不正メール入力も計上し、例外時に計上を失わない既存subtransaction維持。グループ横断。最終許可時刻から10分経過後にcleanup。旧検索RPC・匿名制限は未変更。固定窓からの変更は仕様文言を安全側に解釈したレビュー候補であり、利用者確認待ち。実SQLの境界/並行試験が必要。

### 2. チーム戦: 保存履歴を保持する解決設計案（履歴・修正05で撤回済み）
0045 team_rounds_private.snapshot は、現所属のroster、実試合枠matches、過去rounds.eligible、sidesを返す。get_friendly_team_round_context と create_friendly_team_round の双方がsnapshotを使い、同一JSONのmd5をrevisionにする。createは新しいeligibleとして現rosterを保存する。0039 mergeはclub_membersの同じ行IDを維持し、event_team_matchesのprofile_idを更新するが、eligibleは変更しない。TS generateTeamRound はsource:keyで出場/休憩を集計し、現在のrosterのkeyと過去eligibleを照合。終了後の再開あり。

推奨: 新招待側だけで完結できると仮定せず、既存team_rounds_private.snapshotのrounds.eligible返却部分に限定した読み取り時正規化を別途レビューする。既存の保存JSON、スコア、試合・統合/復元監査、現roster、ゲスト、出場計算、乱数ロジック自体は書き換えない。既存の公開RPC引数・返却shape・認可を維持し、管理者の既存event権限の下だけで実行。merge履歴をブラウザに返さず、専用private helperで変換。get/create/editの共通snapshotを使い、正規化結果がrevisionに含まれるようにする。移行中の既存revisionは409/40001再生成を案内、操作ID再送による二重生成なし。既存承認・招待承認双方で整合。

変換条件の候補:
1. eligible rowのsourceがteam_a/team_b、key='profile:'||profile_id、guest_id NULL、member_id有効であること。ゲスト/変更なしのプロフィールはそのまま。sourceから当該eventのside clubを確定し、別側・別clubへ勝手に移さない。
2. 未復元mergeのsource→targetを追う。各edgeは当該club、round.created_at以前の誤対応を避ける時系列（snapshot作成後の統合）、既存merge_changesのclub_members行IDとbefore/afterのprofile_id/club_idが一致する証拠を要求。同じmember_idを使うだけで同一人物とみなさない。merge時刻同値やclock/transaction時刻境界は隔離試験で検証し、曖昧なら停止。連鎖は有限深さ・循環/複数候補拒否、終点は現rosterの同じsource/member_idと現在profile_id、正規プロフィールの有効性を確認する。現rosterにいない選手は公平性の集計対象外として元記録維持（後日参加時に再評価）。
3. 変換はeligibleのkeyとprofile_idのみ。source/member_id/name/guest_idは保持。変換後の同じsource:key重複、試合枠の重複/不明な所属、復元で矛盾したmappingは黙って統合しない。既存両所属選手のside別扱いを維持し、試合は1人1回の制約を変えない。対象イベントの生成を安全に停止し、データ補正の要否を報告する。既存戦績の閲覧/終了/再開を禁止しない。
4. 本方式を隔離検証・承認後に実装し、旧IDを持つ正常なeligibleについて新招待の一律拒否を撤去。source_in_scopeには元所属side/club/member_idの妥当性と他clubへの巻込み防止を残す。旧snapshotに含まれるだけで招待拒否しない。現候補はまだ一時拒否を保持し、送信OFFのまま。既存snapshotの実定義・署名・owner/ACLを照合してから最小差分SQLを設計する。現候補に未検証のCREATE OR REPLACEを追加しない。
5. 比較案: eligible本体をmerge時に監査付きで更新し復元対応を拡張する方法は、過去snapshotの不変性と復元処理の変更が大きいため優先しない。読取時の整合検査が成立しないと判明した場合に再検討。

必須試験: 休憩していた元選手の連携→次roundで休憩回数・streakが同一人物として継続、出場していた元選手の連携→誤休憩0、active/closed/reopen、対決/混合の元side、manual/削除court/欠席/途中参加/ゲスト/両所属、同一人物重複・別club・不正member/旧ID・連鎖・循環・復元、同時生成/保存/連携、旧revisionの拒否、操作ID再送、既存戦績・保存eligible・merge audit不変、アクセス負例、未連携選手の従来生成結果不変。

### 3. 付け替え誤操作と30日削除（履歴・後続承認を参照）
- pendingの付け替え済み招待を元宛先へ戻す操作・同じ招待ID/世代の復活・元アドレスへの再送は許可しない。
- 管理者に現権限があり本人連携が未成立の場合だけ、明示取消→対象/戦績の再検査→正しい宛先を再入力し新check→別invite ID・新token・新7日期限で明示的に再招待する案。元ID/旧hashを復活させない、元宛先の自動再発行はしない。旧試行も日次/rolling24h/cooldownに計上。管理者が異なる場合は現操作管理者枠。既に承認済みの連携は取消ではなく既存の復元手順・別承認。メール変更でbound本人がアクセスできない場合も同じ管理者経由の取消・新規。
- 30日後に最小監査を消す。永久に元宛先への新規招待を禁じる要件にはしない。古い招待の復活はIDとtoken消滅により常に不可、明示的な新規招待とは別。無期限の識別子を保持しない。ユーザー承認後、現候補のbound_recovery_blockedを適切に見直し、削除前後で同じ新規発行条件にする。現時点では回復方式未承認につき既存の一時ブロックを維持、機能有効化禁止。

### 4. ロックと残る実行ゲート
別グループ書込みでNOWAIT競合する指摘は妥当。既存mergeはそもそも全参照表をSHARE ROW EXCLUSIVEでlockする。今回追加の親/role/round表について、対象行lockだけでは新規履歴のphantomやrole追加/side変更を防げない場合がある。書込み側の既存lock規則を全件照合してから絞る。現段階でlockを外さず、追加lockあり/対象行案の安全性と通常経路回帰・失敗時完全rollbackを隔離試験で比較。既存の通常join/link/restoreのロックを変更しない。匿名再送閾値・IP信頼、旧検索経路、鍵/cron、実DBカタログ、SQL parser/compile、認可/並行/保存/restore試験は継続NO-GO。正式実装・リリース承認なし。


## 2026-11-26 承認仕様反映・修正04（履歴・チーム戦部分は修正05で撤回）
承認 [Issue #262](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7185930180)。SQL commit `0e4fe8d659dd4584d3b72a5ef9b2e7fd0ef7f683`。候補04はROLLBACK専用、実SQL/アプリ未適用、送信OFF、隔離試験・独立再レビュー待ち。
- 検索: 管理者単位・グループ横断・任意の連続10分間20回を確定。修正03のrolling配列を維持（最大20時刻、行/共有lock、時刻境界、例外時計上保持）。通常Auth、旧検索RPC、匿名再送は無変更。
- 回復: 未連携のbound pendingは元宛先への再送/付け替え戻し禁止、現権限管理者が取消して新check、新operation、新invite ID、新7日、fresh secret。終端行の一時的なbound_recovery_blocked関数とcheck/consume/reserveの3判定を撤去。取消済み・拒否済み・期限切れのID/世代を復活させず、終端後の明示的な新規操作だけ許す。旧quota行を維持、30日削除前後で同じ再招待条件、旧リンク永久無効、承認済みは既存復元の別承認。通常の登録済み連携申請ルートも新check＋確認を再要求。旧招待の再送は引き続きpending/unbound/current-generationのみ。
- チーム戦: source_in_scopeのeligible一律拒否を、元profile ID/key/member ID/guest/side/club/event_modeの不整合時のみ拒否へ変更。新規private INVOKER STABLE helper normalize_team_eligibleは、既存イベント権限下の共通snapshot内でのみ実行。保存済みeligibleの順序/その他項目/現roster/試合枠/スコア/統合・復元監査は変更しない。未復元mergeとmerge_changesの同一member/clubのbefore/after証拠、side、時系列、有限16段・循環拒否、現rosterと正規profileの照合を経て、返却eligibleのprofile_id/keyのみ変換。ゲスト/active mergeなしは従来どおり。欠席・退会等で現rosterに対象がいない場合は元履歴を維持。別memberで同一終点、重複、曖昧な履歴は自動補正せずエラー。
- 0045のteam_rounds_private.snapshot(uuid)だけを既存関数として置換するレビュー候補。0045から取得した元prosrc全文と実定義・owner/volatility/search_path・anon/auth EXECUTEを事前照合し、差異があれば全rollback。変更はrounds.eligible返却式のみ。既存get/create/update RPCの引数・権限・revision契約・request ID冪等を維持。新旧revision差異は既存再生成を利用。新規public RPCなし、既存snapshotのACL変更なし。他の既存関数やRLS/戦績データを変更しない。適用は同一transactionで行う候補であり、source一律拒否撤去だけを単独適用しない。
- 独立レビュー必須: 旧profileと既存canonicalが過去同一roundに存在する場合の衝突・承認前検査の要否、退会再加入でmember IDが変わった場合、同時刻/連鎖/復元・closed再開、欠席中の旧履歴、既存通常連携でのscope異常による生成エラー、既存revision/冪等と並行変更。現候補では曖昧な履歴は生成時に停止し、事前にすべて検出できるとは保証しない。既存書込/lock規則と追加NOWAIT lockの別group競合を隔離試験で確認。現候補をリリース可と扱わない。
- 未承認/未解決: 匿名再送閾値とIP信頼、旧検索別枠、cron・鍵・rotation、実カタログ差分、SQL parser/PLpgSQL compile、正負/並行/回帰/実Auth・HTTP試験。旧仕様の変更や本番/正式Stageへの適用は別承認。独立レビューでは承認済み3点を再度仕様決定しない。


## 2026-11-26 修正05：ユーザー承認によるイベント固有対応の除外（維持・運用仕様は修正06で確定）
[承認記録](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7186410956) が修正04以前の乱数ID正規化・再開時の公平性対応・関連テスト要求を上書きする。SQL commit `1f7dac2e788f3a0feabf68d9e4e05d23e7fa3311`。
- 招待の入口・本人同意・既存プロフィール統合が今回の目的。イベント開催状態による連携制限、eligibleの有無/内容による追加拒否、読み取り時ID正規化、team_rounds_private.snapshotの置換・pre/postflight、event_team_roundsへの追加ロックを撤去。乱数生成の既存コード・RPC・保存済み履歴に変更なし。既存同一試合重複検査はそのまま。連携後に同一開催を継続・再開した場合の旧eligible由来の公平性差異や同一round別courtの重複という既存の限定的リスクは追加対応しない。別Issueも作らない。
- 実際の統合対象であるclub_members、event_participants、通常試合、event_team_matchesの元所属side/club、公式戦、private/media等のscope検査、登録済み招待由来の承認直前guard、既存named本人承認、既存統合と復元は維持。他clubの戦績を巻き込まないため、events/event_team_sides/official_events等の親表検査/追加NOWAIT lockは維持し、別group競合は隔離検証。event statusによる制限は新設しない。
- 管理者横断rolling20/10分および取消・明示新規招待は承認維持。#7186015901 の取消前ticket再利用指摘を修正：既存terminal secret triggerがpending→終端時に同一sourceの未消費ticketを全て削除（発行管理者・宛先にかかわらず）。消費済みticket・送信試行・quota・既存registered markerは維持。新checkはカウンタ計上後のsubtransaction内でsettle_staleを先に実行して自然期限切れを確定してから発行。registered consumeもserialize後、ticket読取前にsettle_stale。initial reserveは既にsettle済み。取消/期限/拒否/承認とfresh check/consume/reserveの同時操作、旧ticket拒否、新ticket成功、旧消費済み操作の冪等結果と監査維持、lookupカウンタとquota保持、終端30日削除前後を検証する。DB未実行。
- 旧修正04のnormalize_team_eligible、snapshot置換、16段制限、生成時PT409、関連する追加前提・試験は全て撤回。既存イベント機能の回帰確認は必要最小限（既存SQL/RPC不変、既存統合が従来の戦績を引継ぐこと）。独立レビューの焦点は今回の招待・本人確認・権限/戦績のscope・quota・回復・構文・既存承認互換。匿名閾値/IP、旧検索経路、鍵/cron、実カタログ、追加親lockの競合と実試験は未解決のまま。ROLLBACK専用・送信OFF・Draft、SQL適用/本番/正式Stage/merge禁止。


## 2026-11-27 修正06：残存運用仕様6項目の承認反映（最新正本）
[ユーザー承認](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7206101373)、SQL commit `c6cf80539c5e76d5809d8d187838ba711636fb3b`。修正05の機能/イベント除外、検索rolling20/10分、明示取消→fresh check→新規招待、既存プロフィール統合・権限・戦績scope・7日・全送信quotaは維持。正式migrationではない。実SQL/鍵/cron/Worker/本番/正式Stageへの適用なし。

### 1. 匿名再送
- IP単位10回、招待ID単位3回、各subjectの最初の計上から固定10分（600秒経過で新枠）。全体/日次/60秒/同時送信の従来quotaとAuth制限も適用。既存のtake_anonymous_limitの計上順序を維持：形状が有効なbearer再送でIP枠を先に、現在の有効bearerを検証後に招待ID枠。quota拒否も正常returnなら計上保持。期限/世代不一致・秘密不正は招待ID枠を消費させず、IP枠で抑制する。SQL例外でtransactionがrollbackした場合のカウンタも含め、Worker入口での濫用対策・fail closedを結合試験で確認する。未確定の例外時永続化方式を勝手に追加しない。
- settingsの初期値10/3、送信OFFのhard CHECK維持。NULLは対応する匿名枠を閉じる。両枠とWorker信頼境界確認前は匿名再送を有効化しない。匿名の不正/制限応答は同じnot_found、具体的な理由・他group情報を返さない。
- Cloudflare公式 https://developers.cloudflare.com/fundamentals/reference/http-headers/ に基づき、信頼できる直接入口のCF-Connecting-IPを使用。body/query/X-Forwarded-For/x-real-ip等の自己申告値を使わない。same-zone Worker subrequestのx-real-ip書換、cross-zone共通IP、Pseudo IPv4等を考慮し、直接入口と確認できない/欠落・不正時は匿名再送を拒否。IPv4/IPv6の同一アドレスを正規化し、Worker側の用途専用HMAC-SHA256 secret（設計上の実装案、未作成）でdomain-separated digestのみservice-only RPCへ渡す。生IP/鍵/招待secretは保存・ログ出力しない。既存2種Vault鍵をWorkerへ持ち出さない。鍵の配置・信頼経路を実装時にレビュー。

### 2. 鍵管理
- 既存key_bytesの専用Vault名 padel_club_invite_hmac_v1 / padel_club_invite_encryption_v1、独立32byte乱数、base64・一意・互いに異なる鍵、欠落/不正でPT503を維持。既存Auth/他機能鍵変更なし。自動rotationなし。鍵の設置・保管/復旧は別途承認、変更時は送信停止・未終端招待・既存digest・rolling quota・監査の整合を確認し別手順。鍵の値をIssue/commit/ログに記録しない。

### 3. 自動削除
- 終端最小監査は720時間保持し、その後cleanup_retentionで削除。毎日03:00 JST、schedulerがUTCなら `0 18 * * *`。Supabase Cron/pg_cronでowner-only cleanupを定期実行する設計（https://supabase.com/docs/guides/cron および https://supabase.com/docs/guides/cron/quickstart）。本番/Stageのcron timezone/拡張/実行role/重複job/失敗履歴は設定前に照合。既存jobやtimezoneを変更しない。正常時の削除遅延最大約24h、失敗時は秘密を含まないエラー記録を確認し次回実行で再処理。cleanupの依存中の登録済みpending marker保護は維持し、異常延長を発見したら報告。既存所属/戦績/統合監査/通常Authは削除しない。ジョブ作成SQLは候補本体に含めない。

### 4. 中立表示/API
- get_club_invite_statusのmember_attempts_today/cooldown_until/inflightは自groupの対象memberに限定。delivery_statusは対象inviteの試行のみ。masked_email/期限/世代/付け替え状態等の既存自group情報は維持。別groupの同一宛先の試行でこれらのDTOが変化しないこと。
- reserve_club_invite_send / reserve_club_invite_resend のquota拒否は認証済み経路で共通status `temporarily_unavailable`（実装用コード名の決定）、匿名bearerでは従来の `not_found`。内部quota_check/send_quotaの理由・カウンタ・拒否判定を変更しない。Worker/画面は他groupの状態、理由、待機時刻、宛先等を返さない。文言「現在、招待メールを送信できません。しばらくしてから再度お試しください。」。自身の招待状態と厳密一致した既存operationの冪等応答は維持。送信可否からの副次的推測は残る。新機能のみの未実装API契約更新で、旧アプリ/RPC変更なし。

### 5. ロック競合
- 既存lock_references/追加lock_accept_scopeを変更しない。短い待機・一時拒否・再試行を許容、失敗時に入力値を失わず再試行案内（スコアは既存UI挙動確認のうえ必要最小限）。データ消失、二重処理、部分承認、継続的阻害は不可。操作IDの再利用は同一payloadの安全な再試行のみ。既存イベント固有対応を復活させない。過去の合成試験は限定的で、残る実Auth/HTTP・既存通常join/restore・同時操作を確認する。

### 6. 既存検索
- 旧検索RPC・通常ログイン・既存通常Auth・連携フローは変更しない。新招待検索のみrolling20/10分/manager。旧経路が別枠であるためアプリ全体の検索上限とはならない残存リスクを受容。

### 7. 検証・引継ぎ
- 修正06の変更はsettings初期値/postflight、reserve 2本のquota拒否status、get_statusの集計範囲、注記のみ。6表/14 public RPC/30 private functions、引数/ACL/既存関数/lock/cleanup本文/統合/戦績は維持。原本ROLLBACK・送信OFF維持。
- 既存 isolated-evidence/ のrunnerは旧修正05 SHA256に固定されており、修正06では意図的にhash不一致で停止する。過去の証跡を変更せず保存。Codexは新候補のhashをレビュー後に対応する試験runner/期待値を更新し、前回「匿名閾値NULL」の負例は試験用DBで明示NULL設定して確認する。新規初期10/3、両閾値境界/固定枠更新/並行/欠落IP、匿名応答中立、同一宛先で別group予約中の自group DTO不変とquota中立拒否、同group自身の状態表示、既存quotaと冪等性を重点検証。Worker IP偽装/secret非公開は実装時ゲート、cron schedule/owner/失敗再処理は別途設定承認後。実Auth/PostgREST・既存通常加入/復元等の残試験と統合し、変更のない過去PASSを無条件に再実行しない。
- 修正06 parser/DB/HTTP実行未実施。正式SQL確定・アプリ実装・本番適用は引き続きNO-GO。新規Issue/PRなし、既存PR Draft維持。

## 2026-11-27 招待メールの対応形式（候補・未適用）

Issue #262の追加指定により、招待用はASCII dot-atomのローカル部とASCIIドメイン（Punycodeを含む）を使用する。SMTPUTF8を要するローカル部・quoted local・Unicodeドメインは対象外。既存の `normalize_email` と既存アカウント照合は変更せず、招待の確認・予約・再送前に別の `supported_delivery_email` で検査する。非対応入力は検索枠・送信枠に計上しない。過去に非対応形式で作られた招待があれば、その宛先への再送は拒否される。これは候補SQLの変更であり、過去の検証証跡は旧SHAの結果として維持し、新たなSQL/RLS独立レビューと必要な再検証が必要。

- 04 SHA256 `e9e2e0caba1d3c0b895c1feb54fe0569a87ebb48695de42c5adfcb8631832989`
- 05 SHA256 `0fa5f54a8bde06567b2608bb1e06b89008cf8739f71fbb1df383a1a3dfe7f7bf`
- 09 SHA256 `a26b0e66466efb7a37ddb37ef33147dc11a84182d72489ba8d445b809de8239d`（08から再生成。正式適用承認ではない）
- 配送・匿名再送はOFFのまま。本番・正式Stageへ適用しない。
