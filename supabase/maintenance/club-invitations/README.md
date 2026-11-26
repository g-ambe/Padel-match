# TASK-08-02 / #262: 招待機能 DB/API 契約・候補03 (review only)
 
基準 main: 5fd308eea4f7d673c2a3e170c934876634154d94。承認: [基本仕様](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7157860703)、[認証分離・複数招待](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7166012903)、[付け替え](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7182981350)、[内部設定](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7183006329)。[候補02](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7182312203) と [実配送試験](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7182152763) を参照。以下はレビュー候補、実行・適用・リリース承認ではない。新規 migration は未配置。

## 最終仕様の優先順位
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
