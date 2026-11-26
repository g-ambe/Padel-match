# TASK-08-02 / #262 — RPC review drafts, sections 1–5

**REVIEW ONLY / 未実行・未統合。SQLの直接実行禁止。**

Base main: `5fd308eea4f7d673c2a3e170c934876634154d94`; original candidate HEAD: `7573413b14c43ef0d547272cdedcbe1fc6264a3c`.

This file preserves the seven original PR #273 comments verbatim, in chronological order, for versioned review. It is not an executable migration, does not supersede the approved requirements, and does not establish that any SQL is valid. The earlier sections' statements about storing comments only are historical. Preview-only permission was subsequently recorded in [Issue #262](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7184025223). No application files, migration runner, workflows, secrets, production/stage settings or DB changes are included. Section 6 (retention/ACL/preflight/postflight), section 7 (integration and contradiction resolution), syntax checks, isolated DB execution and independent review remain pending. Do not concatenate and execute without resolving all listed open items.

---

Source: [PR #273 comment 7183636145](https://github.com/g-ambe/Padel-match/pull/273#issuecomment-7183636145)

## TASK-08-02 / 仕様書⑪ 再開：完全SQL候補の第1区画（未実行・未完成）
基準 main 5fd308eea4f7d673c2a3e170c934876634154d94 / HEAD 7573413b14c43ef0d547272cdedcbe1fc6264a3c。main/branch AGENTS.md同一blob 9d893d7817403278f735fb313aff00706c537b52、#215/#229/#262、指定6承認コメント、候補03の2ファイル、0039/0061/20261125032915を確認。open PRは本件のみ。既存named承認とmerge監査を維持する。PRのCloudflare botコメント #issuecomment-7183066195 に当該HEADのPreview配信成功が記録されている（2026-11-26 13:59 JST）。正式Stage/Prodとは区別するが、追加pushのPreview自動配信条件が未確認のため、ユーザーの配信禁止指示に従いcommit/pushせず、暫定的に本コメントへSQL草案を記録。既存branch/PRは保持。

### SQL差分草案：予約lease/期限の終端化と送信確定
候補03のROLLBACK直前に統合する想定。単体で実行しない。構文/実行未試験。期限内再送/accept/bindの前に共通lock下で呼ぶ。p_nowは外部入力とせず、lock後にDB時刻を取得。送信中取消は外部通信の停止保証なし。送信結果は試行だけに反映する。既存Auth/プロフィール/戦績/RLSは変更しない。

```sql
-- review candidate only, inside candidate 03 transaction, before ROLLBACK.
CREATE UNIQUE INDEX club_invite_member_inflight
  ON club_invite_private.send_attempts(member_id)
  WHERE status IN ('reserved','sending');

CREATE FUNCTION club_invite_private.settle_stale()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz;
BEGIN
  PERFORM profile_link_private.serialize_operations();
  v_now := clock_timestamp();
  UPDATE club_invite_private.send_attempts
     SET status='failed', finished_at=v_now, failure_code='not_claimed'
   WHERE status='reserved' AND reserved_at<=v_now-interval '2 minutes';
  UPDATE club_invite_private.send_attempts
     SET status='unknown', finished_at=v_now, failure_code='claim_timeout'
   WHERE status='sending' AND claimed_at<=v_now-interval '2 minutes';
  UPDATE club_invite_private.send_attempts a
     SET status='failed', finished_at=v_now, failure_code='cancelled_before_claim'
    FROM club_invite_private.invitations i
   WHERE a.invite_id=i.id AND a.status='reserved'
     AND (i.status<>'pending' OR i.expires_at<=v_now
          OR i.generation<>a.generation);
  UPDATE club_invite_private.invitations
     SET status='expired', decided_at=v_now,
         email_ciphertext=NULL, recovery_digest=NULL
   WHERE status='pending' AND expires_at<=v_now;
END $$;
REVOKE ALL ON FUNCTION club_invite_private.settle_stale()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.finalize_club_invite_send(
  p_operation_id uuid, p_generation integer,
  p_result text, p_failure_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_attempt club_invite_private.send_attempts%ROWTYPE;
        v_now timestamptz;
BEGIN
  IF p_operation_id IS NULL OR p_generation IS NULL OR p_generation<=0
    OR p_result IS NULL OR NOT (
      (p_result='sent' AND p_failure_code IS NULL)
      OR (p_result='failed' AND p_failure_code IS NOT NULL
          AND p_failure_code IN ('smtp_rejected','pre_data_failure','auth_rejected'))
      OR (p_result='unknown' AND p_failure_code IS NOT DISTINCT FROM 'uncertain')
    ) THEN RAISE SQLSTATE '22023' USING MESSAGE='Invalid delivery result'; END IF;
  PERFORM profile_link_private.serialize_operations();
  PERFORM club_invite_private.settle_stale();
  v_now:=clock_timestamp();
  SELECT * INTO v_attempt FROM club_invite_private.send_attempts
   WHERE operation_id=p_operation_id AND generation=p_generation FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF v_attempt.status<>'sending' THEN
    RETURN jsonb_build_object('status',v_attempt.status,'updated',false);
  END IF;
  IF (v_attempt.kind='auth_confirmation' AND p_failure_code IN ('smtp_rejected','pre_data_failure'))
     OR (v_attempt.kind='group_invite' AND p_failure_code='auth_rejected')
  THEN RAISE SQLSTATE '22023' USING MESSAGE='Invalid delivery result'; END IF;
  IF v_attempt.claimed_at<=v_now-interval '2 minutes' THEN
    UPDATE club_invite_private.send_attempts
       SET status='unknown',finished_at=v_now,failure_code='claim_timeout'
     WHERE operation_id=p_operation_id AND generation=p_generation AND status='sending';
    RETURN jsonb_build_object('status','unknown','updated',true);
  END IF;
  UPDATE club_invite_private.send_attempts
     SET status=p_result,finished_at=v_now,failure_code=p_failure_code
   WHERE operation_id=p_operation_id AND generation=p_generation AND status='sending';
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Stale operation'; END IF;
  RETURN jsonb_build_object('status',p_result,'updated',true);
END $$;
REVOKE ALL ON FUNCTION public.finalize_club_invite_send(uuid,integer,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_club_invite_send(uuid,integer,text,text)
  TO service_role;
```

追加member inflight一意は候補03の宛先単位一意に加え、取消・宛先訂正中の同一仮所属の並行送信を防ぐ候補。reserve側もmember/email双方のinflightを検査し中立応答にする必要あり。settle_staleの永続化は呼出側が正常な状態応答でcommitする場合に限る。例外rollback後の掃除を完了とみなさない。最終版では全RPCのlock順序、timeout境界、ACL、監査、送信結果enum/API契約を統合試験する。30日削除の自動実行は今回未作成。

### 残る具体的なSQL工程
1. 鍵のVault取得/HMAC/暗号・mask・乱数hash、現在確認済みメール/正規profile、対象役職/club/source scope共通guard。0039 mergeはsourceの全参照を変更するため別club/不明scopeは停止。既存FK allowlistを変更しない。
2. check/consume、5分ticket、20回/10分、エラーで制限カウンタをrollbackしない。旧検索RPCの迂回を評価するが既存契約を勝手に変更しない。
3. reserve/resend/claim/cancel、全quota、operation/actor/request digest、未認証復帰のIP等制限、初期OFF・旧世代無効化。
4. recipient一覧/preview/rebind/accept/reject。bound/unbound共通認可、旧宛先遮断、同意CAS、既存named approval（実auth.uid）再利用、個別transaction。既存ロック順・scope/preview tokenは正式適用済みメンテナンス定義も照合。
5. 期限・30日監査cleanup、鍵rotation、全ACL/postflight、独立レビュー、隔離試験、完全Migration化。
今回のSQLは第1区画のみ、完全Migration/RPC未完成。SQL試験/DB操作/メール送信/merge/deployなし、コミットなし。GitHub Project API未同期。次工程は第2区画の認可・暗号helper作成と全RPCの統合、Previewトリガー確認後に既存PRの候補ファイルへ保存。

---

Source: [PR #273 comment 7183677998](https://github.com/g-ambe/Padel-match/pull/273#issuecomment-7183677998)

## TASK-08-02 完全SQL候補 第2区画：認可・暗号・本人照合（レビュー草案）
前回 #issuecomment-7183636145 の続き。main 5fd308eea4f7d673c2a3e170c934876634154d94 / HEAD 7573413b14c43ef0d547272cdedcbe1fc6264a3c。候補03 README、#262 承認済み契約、0039/0061/20261125032915、実適用パッケージの139 H38 scoped_preview・28 H08 scope・164 H51・168 H52・180 H61運用を根拠とする。既存本番カタログ記録 #issuecomment-7158040704 の pgcrypto=extensions、vault=Vault を前提。現DBには接続しない。以下を候補03＋第1区画の同一BEGIN/ROLLBACK内へ統合予定、構文/実行未試験。
Cloudflare READ ONLY: Prod trigger main、Stage trigger codex/minimal-security-replacement、Stage Worker previews_enabled=true、当該branch preview auto_build=true/auto_delete=true、path_includes=*。追加pushによるPreview自動配信が判明したため、配信禁止を守りコミットせずコメント保存。設定変更なし。

```sql
-- Private only. Technical key names/encoding are candidate conventions.
-- Provision two independent random 32-byte keys as base64 in Vault separately.
-- Do not create or print any real secret in this migration or in tests.
CREATE FUNCTION club_invite_private.normalize_email(p_email text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text:=lower(btrim(p_email));
BEGIN
 IF v IS NULL OR octet_length(v) NOT BETWEEN 3 AND 254
 OR v !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$'
 THEN RETURN NULL; END IF;
 RETURN v;
END $$;

CREATE FUNCTION club_invite_private.key_bytes(p_purpose text)
RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_h text; v_e text; h bytea; e bytea; n_h int; n_e int;
BEGIN
 SELECT count(*),max(decrypted_secret) INTO n_h,v_h
 FROM vault.decrypted_secrets WHERE name='padel_club_invite_hmac_v1';
 SELECT count(*),max(decrypted_secret) INTO n_e,v_e
 FROM vault.decrypted_secrets WHERE name='padel_club_invite_encryption_v1';
 IF n_h<>1 OR n_e<>1 OR v_h IS NULL OR v_e IS NULL
 THEN RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation configuration unavailable'; END IF;
 h:=decode(v_h,'base64'); e:=decode(v_e,'base64');
 IF octet_length(h)<>32 OR octet_length(e)<>32 OR h=e
 THEN RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation configuration unavailable'; END IF;
 IF p_purpose='hmac' THEN RETURN h;
 ELSIF p_purpose='encryption' THEN RETURN e;
 END IF;
 RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation configuration unavailable';
EXCEPTION WHEN OTHERS THEN
 RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation configuration unavailable';
END $$;

CREATE FUNCTION club_invite_private.email_hmac(p_email text)
RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text:=club_invite_private.normalize_email(p_email);
BEGIN
 IF v IS NULL THEN RETURN NULL; END IF;
 RETURN extensions.hmac(convert_to(v,'UTF8'),
   club_invite_private.key_bytes('hmac'),'sha256');
END $$;

CREATE FUNCTION club_invite_private.encrypt_email(p_email text)
RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text:=club_invite_private.normalize_email(p_email);
BEGIN
 IF v IS NULL THEN RAISE SQLSTATE '22023' USING MESSAGE='Invalid invitation address'; END IF;
 RETURN extensions.pgp_sym_encrypt(v,
   encode(club_invite_private.key_bytes('encryption'),'base64'),
   'cipher-algo=aes256,compress-algo=0,disable-mdc=0');
EXCEPTION WHEN OTHERS THEN
 RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation encryption unavailable';
END $$;

CREATE FUNCTION club_invite_private.decrypt_email(p_cipher bytea,p_digest bytea)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;
BEGIN
 IF p_cipher IS NULL OR p_digest IS NULL THEN
  RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation address unavailable';
 END IF;
 v:=extensions.pgp_sym_decrypt(p_cipher,
   encode(club_invite_private.key_bytes('encryption'),'base64'));
 IF club_invite_private.normalize_email(v) IS DISTINCT FROM v
 OR club_invite_private.email_hmac(v) IS DISTINCT FROM p_digest
 THEN RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation address unavailable'; END IF;
 RETURN v;
EXCEPTION WHEN OTHERS THEN
 RAISE SQLSTATE 'PT503' USING MESSAGE='Invitation address unavailable';
END $$;

CREATE FUNCTION club_invite_private.new_secret()
RETURNS text LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT encode(extensions.gen_random_bytes(32),'hex');
$$;
CREATE FUNCTION club_invite_private.secret_hash(p_secret text)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_secret IS NULL OR length(p_secret)<>64 OR p_secret !~ '^[0-9a-f]{64}$'
 THEN RETURN NULL; END IF;
 RETURN extensions.digest(decode(p_secret,'hex'),'sha256');
END $$;

-- No plaintext address in terminal invitations. Mask generated only from
-- a verified decrypted pending address for an already authorized viewer.
CREATE FUNCTION club_invite_private.mask_email(p_email text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN club_invite_private.normalize_email(p_email) IS NULL THEN NULL
 ELSE left(split_part(p_email,'@',1),1)||'***@'||left(split_part(p_email,'@',2),1)||'***' END;
$$;

-- Actor is private and derived from real auth.uid() or server verified JWT.
-- Current role, club validity and target-role ceiling must be reevaluated.
CREATE FUNCTION club_invite_private.manager_ok(p_actor uuid,p_club uuid,p_member uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(p_actor IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.clubs c JOIN public.club_members m ON m.club_id=c.id
  WHERE c.id=p_club AND m.id=p_member AND c.is_active AND NOT coalesce(c.is_deleted,false)
    AND m.is_active AND m.status='active'
    AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor)
    AND (profile_link_private.club_role(c.id,p_actor) IN ('super_user','main_admin')
      OR (profile_link_private.club_role(c.id,p_actor)='sub_admin' AND m.role<>'main_admin'))
 ),false);
$$;

-- Scope follows H08/H38 and H52. Does not modify existing routines/allowlist.
-- Refuse ALL memberships other than original (including inactive), legacy
-- ambiguous ownership, out-of-scope history or source private/media rows.
CREATE FUNCTION club_invite_private.source_in_scope(p_club uuid,p_member uuid,p_source uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(
   EXISTS(SELECT 1 FROM public.club_members m JOIN public.clubs c ON c.id=m.club_id
    JOIN public.player_profiles p ON p.id=m.player_profile_id
    WHERE m.id=p_member AND m.club_id=p_club AND p.id=p_source
      AND c.is_active AND NOT coalesce(c.is_deleted,false)
      AND m.is_active AND m.status='active' AND m.profile_id IS NULL
      AND p.is_active AND p.linked_auth_user_id IS NULL)
   AND NOT EXISTS(SELECT 1 FROM public.club_members m WHERE m.player_profile_id=p_source AND m.id<>p_member)
   AND NOT EXISTS(SELECT 1 FROM public.event_participants ep
     LEFT JOIN public.events e ON e.id=ep.event_id
     WHERE ep.player_profile_id=p_source AND e.club_id IS DISTINCT FROM p_club)
   AND NOT EXISTS(SELECT 1 FROM public.join_requests j WHERE j.requester_player_profile_id=p_source)
   AND NOT EXISTS(SELECT 1 FROM public.event_team_matches t
     WHERE p_source IN(t.team_a_player1_profile_id,t.team_a_player2_profile_id,t.team_b_player1_profile_id,t.team_b_player2_profile_id)
       AND NOT EXISTS(SELECT 1 FROM public.event_team_sides s WHERE s.event_id=t.event_id AND s.club_id=p_club))
   AND NOT EXISTS(SELECT 1 FROM public.official_matches m LEFT JOIN public.official_events e ON e.id=m.official_event_id
     WHERE p_source IN(m.our_player1_profile_id,m.our_player2_profile_id) AND e.club_id IS DISTINCT FROM p_club)
   AND NOT EXISTS(SELECT 1 FROM public.player_profile_private WHERE profile_id=p_source)
   AND NOT EXISTS(SELECT 1 FROM public.profile_media_objects WHERE profile_id=p_source)
   AND NOT EXISTS(SELECT 1 FROM public.profile_media_operations WHERE profile_id=p_source)
   AND NOT EXISTS(SELECT 1 FROM public.player_profile_merges WHERE source_player_profile_id=p_source AND restored_at IS NULL)
 ,false);
$$;

CREATE FUNCTION club_invite_private.source_available(p_club uuid,p_member uuid,p_source uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT club_invite_private.source_in_scope(p_club,p_member,p_source)
 AND NOT EXISTS(SELECT 1 FROM public.player_profile_link_requests r
  WHERE r.source_player_profile_id=p_source AND r.status='pending' AND r.expires_at>clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.join_requests j WHERE j.consent_source_player_profile_id=p_source
  AND j.status='pending' AND coalesce(j.expires_at,j.created_at+interval '7 days')>clock_timestamp());
$$;

-- Require actual confirmed current Auth address AND existing profile.
-- For mutations lock Auth row to prevent concurrent email changes.
-- Call under the shared serialization lock. Canonical must be unique.
CREATE FUNCTION club_invite_private.recipient_identity(p_actor uuid)
RETURNS TABLE(actor_id uuid,canonical_id uuid,current_email_digest bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text; v_pid uuid;
BEGIN
 IF p_actor IS NULL THEN RETURN; END IF;
 SELECT u.email INTO v_email FROM auth.users u JOIN public.profiles p ON p.id=u.id
 WHERE u.id=p_actor AND u.email_confirmed_at IS NOT NULL FOR SHARE OF u;
 IF NOT FOUND OR club_invite_private.normalize_email(v_email) IS NULL THEN RETURN; END IF;
 v_pid:=profile_link_private.canonical(p_actor);
 IF v_pid IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT p_actor,v_pid,club_invite_private.email_hmac(v_email);
END $$;

CREATE FUNCTION club_invite_private.recipient_matches(
 p_inv club_invite_private.invitations,p_actor uuid,p_digest bytea
) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(p_actor IS NOT NULL AND p_digest IS NOT NULL AND
   CASE WHEN p_inv.bound_auth_id IS NULL THEN p_digest=p_inv.email_digest
     ELSE p_inv.bound_auth_id=p_actor AND p_inv.bound_email_digest=p_digest
       AND p_inv.bound_generation=p_inv.generation END,false);
$$;

CREATE FUNCTION club_invite_private.invite_usable(
 p_inv club_invite_private.invitations,p_generation integer
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(p_inv.id IS NOT NULL AND p_inv.status='pending'
   AND p_inv.generation=p_generation AND p_inv.generation>0
   AND p_inv.expires_at>clock_timestamp()
   AND club_invite_private.manager_ok(p_inv.inviter_auth_id,p_inv.club_id,p_inv.member_id)
   AND club_invite_private.source_available(p_inv.club_id,p_inv.member_id,p_inv.source_profile_id),false);
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private
 FROM PUBLIC,anon,authenticated,service_role;
```

### 統合時の重要条件・未検証点
- Vault名・base64形式とマスク形式は内部実装候補（ユーザー承認済みの鍵分離/最小情報原則の具体化）。実鍵作成/取得・鍵ローテーション実行はしない。pgcrypto関数signature/拡張schema、Vault権限、Auth current-email/deleted/anonymous/ban/SSO状態の実カタログと通常アプリ認証契約を隔離レビューで照合。現時点でこれらを完全検証済みとしない。鍵異常は機能を停止し、通常Authを変更しない。
- source profile_id NULL要件は既存authへの曖昧な旧参照を止める安全側候補。正常な既存仮所属を過剰に拒否しないことを隔離fixtureで照合。H08/H38のteam側スコープはイベントに対象club sideがある条件を再利用したが、sourceが反対側にいる異常とevent側の同時変更、固定ペア等の最新参照を追加レビューする。未承認の範囲拡張禁止。
- 上記は共通の予備チェックであり、acceptでは必ず共有serialize_operations→既存lock_references→対象イベント/side/公式イベント・club・Authの適切なlockと再照合→named approval。同時権限変更/メール変更/履歴追加についてロック順とdeadlock/競合試験必須。既存H52 guard/merge/restore/公開設定を変更しない。既存link/joinが優先、新招待側は停止。
- 管理者の状態表示・取消は本人承認のsource_availableと区別する。終端行や連携済み行から元メールを復号/復活させない。bound/unbound両方の認可をrecipient_matchesに統一し、付け替え後の元宛先復活禁止。秘密を返すpublic RPCは定義しない。ログ/例外/DTOに平文を漏らさないWorker対策はCodex実装時も必須。
- 現SQLは未実行。完全Migration化前の静的レビュー用、単体実行禁止。次の第3区画でcheck/consumeの具体SQLを記録する。

---

Source: [PR #273 comment 7183684849](https://github.com/g-ambe/Padel-match/pull/273#issuecomment-7183684849)

## TASK-08-02 完全SQL候補 第3区画：アカウント照合・既存本人同意への接続（レビュー草案）
第1区画 #issuecomment-7183636145、第2区画 #issuecomment-7183677998 と候補03 DDLを前提。同一未適用transactionのROLLBACK前へ統合する。承認 #issuecomment-7183006329 の20回/10分・5分ticket・完全一致・登録済みは管理者明示確認・既存通知/RPC再利用を反映。SQL未実行。直接適用不可。

```sql
-- Internal classification only: exact normalized address, no listing.
-- One confirmed account missing its app profile, or duplicate Auth rows:
-- fail closed instead of creating a signup invite to an ambiguous account.
CREATE FUNCTION club_invite_private.classify_account(p_email text)
RETURNS TABLE(account_kind text,target_auth_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_confirmed boolean; v_count integer;
        v_email text:=club_invite_private.normalize_email(p_email);
BEGIN
 IF v_email IS NULL THEN RETURN QUERY SELECT 'conflict'::text,NULL::uuid; RETURN; END IF;
 SELECT count(*) INTO v_count FROM auth.users u WHERE lower(u.email)=v_email;
 IF v_count>1 THEN RETURN QUERY SELECT 'conflict'::text,NULL::uuid; RETURN; END IF;
 IF v_count=0 THEN RETURN QUERY SELECT 'signup_required'::text,NULL::uuid; RETURN; END IF;
 SELECT u.id,u.email_confirmed_at IS NOT NULL INTO v_id,v_confirmed
  FROM auth.users u WHERE lower(u.email)=v_email FOR SHARE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'conflict'::text,NULL::uuid; RETURN; END IF;
 IF v_confirmed THEN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_id) THEN
   RETURN QUERY SELECT 'conflict'::text,NULL::uuid; RETURN;
  END IF;
  RETURN QUERY SELECT 'registered'::text,v_id;
 ELSE
  RETURN QUERY SELECT 'signup_required'::text,NULL::uuid;
 END IF;
END $$;

-- 20 per fixed ten-minute window, same convention as existing lookup.
-- Saturate at 20 rather than increasing forever. Return normal quota
-- response to persist counter, do not raise after consuming it.
CREATE FUNCTION club_invite_private.take_lookup(p_actor uuid,p_now timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
 IF p_actor IS NULL OR p_now IS NULL THEN RETURN false; END IF;
 INSERT INTO club_invite_private.lookup_limits(manager_auth_id,window_started_at,lookup_count)
 VALUES(p_actor,p_now,1)
 ON CONFLICT(manager_auth_id) DO UPDATE
 SET lookup_count=CASE
    WHEN club_invite_private.lookup_limits.window_started_at<=p_now-interval '10 minutes' THEN 1
    ELSE club_invite_private.lookup_limits.lookup_count+1 END,
 window_started_at=CASE
    WHEN club_invite_private.lookup_limits.window_started_at<=p_now-interval '10 minutes' THEN p_now
    ELSE club_invite_private.lookup_limits.window_started_at END
 WHERE club_invite_private.lookup_limits.window_started_at<=p_now-interval '10 minutes'
    OR club_invite_private.lookup_limits.lookup_count<20
 RETURNING lookup_count INTO v_count;
 RETURN FOUND AND v_count BETWEEN 1 AND 20;
END $$;

CREATE FUNCTION public.check_club_invite_account(p_club uuid,p_member uuid,p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_source uuid; v_email text; v_now timestamptz;
 v_kind text; v_target uuid; v_secret text; v_digest bytea;
BEGIN
 IF v_actor IS NULL OR NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 IF NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_now:=clock_timestamp();
 -- consume before address lookup; invalid input also counts for an authorized target.
 IF NOT club_invite_private.take_lookup(v_actor,v_now)
 THEN RETURN jsonb_build_object('status','lookup_limit'); END IF;
 v_email:=club_invite_private.normalize_email(p_email);
 IF v_email IS NULL THEN RETURN jsonb_build_object('status','invalid'); END IF;
 SELECT player_profile_id INTO v_source FROM public.club_members WHERE id=p_member AND club_id=p_club;
 IF v_source IS NULL OR NOT club_invite_private.source_available(p_club,p_member,v_source)
 OR EXISTS(SELECT 1 FROM club_invite_private.invitations i WHERE i.source_profile_id=v_source
      AND i.status='pending' AND i.expires_at>v_now)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 -- Local exception block preserves outer lookup counter if classification,
 -- Vault or insert fails; never expose the input or internal SQLERRM.
 BEGIN
  SELECT a.account_kind,a.target_auth_id INTO v_kind,v_target
    FROM club_invite_private.classify_account(v_email) a;
  IF v_kind NOT IN ('registered','signup_required') OR v_kind IS NULL
     OR v_target=v_actor
  THEN RETURN jsonb_build_object('status','conflict'); END IF;
  v_digest:=club_invite_private.email_hmac(v_email);
  v_secret:=club_invite_private.new_secret();
  INSERT INTO club_invite_private.lookup_tickets(ticket_digest,manager_auth_id,club_id,member_id,
    source_profile_id,target_auth_id,email_digest,expires_at,account_kind)
  VALUES(club_invite_private.secret_hash(v_secret),v_actor,p_club,p_member,
    v_source,v_target,v_digest,clock_timestamp()+interval '5 minutes',v_kind);
  RETURN jsonb_build_object('status',v_kind,'ticket',v_secret);
 EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','unavailable');
 END;
END $$;

-- Registered route only. For signup_required the service-only reserve
-- RPC will consume the same ticket atomically with the first send attempt.
CREATE FUNCTION public.consume_club_invite_lookup(
 p_club uuid,p_member uuid,p_email text,p_ticket text,
 p_operation_id uuid,p_confirm_registered boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_t club_invite_private.lookup_tickets%ROWTYPE;
 v_hash bytea; v_mail_digest bytea; v_kind text; v_target uuid; v_link uuid;
BEGIN
 IF v_actor IS NULL OR p_operation_id IS NULL OR p_confirm_registered IS NOT TRUE
    OR NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_hash:=club_invite_private.secret_hash(p_ticket);
 IF v_hash IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 SELECT * INTO v_t FROM club_invite_private.lookup_tickets t
 WHERE t.ticket_digest=v_hash AND t.manager_auth_id=v_actor
  AND t.club_id=p_club AND t.member_id=p_member FOR UPDATE;
 IF NOT FOUND OR v_t.account_kind<>'registered'
   OR NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_mail_digest:=club_invite_private.email_hmac(p_email);
 IF v_mail_digest IS NULL OR v_mail_digest IS DISTINCT FROM v_t.email_digest
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT a.account_kind,a.target_auth_id INTO v_kind,v_target
   FROM club_invite_private.classify_account(p_email) a;
 IF v_kind IS DISTINCT FROM 'registered' OR v_target IS DISTINCT FROM v_t.target_auth_id
   OR v_target=v_actor
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 IF v_t.consumed_at IS NOT NULL THEN
  IF v_t.consumed_operation_id=p_operation_id AND v_t.result_link_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM public.player_profile_link_requests r
       WHERE r.id=v_t.result_link_id AND r.club_id=p_club AND r.source_club_member_id=p_member
         AND r.source_player_profile_id=v_t.source_profile_id
         AND r.target_auth_user_id=v_target AND r.requested_by_auth_user_id=v_actor)
  THEN RETURN jsonb_build_object('status','requested','link_id',v_t.result_link_id); END IF;
  RETURN jsonb_build_object('status','conflict');
 END IF;
 IF v_t.expires_at<=clock_timestamp()
   OR NOT club_invite_private.source_available(p_club,p_member,v_t.source_profile_id)
   OR EXISTS(SELECT 1 FROM club_invite_private.invitations i
     WHERE i.source_profile_id=v_t.source_profile_id AND i.status='pending' AND i.expires_at>clock_timestamp())
   OR EXISTS(SELECT 1 FROM club_invite_private.lookup_tickets t WHERE t.consumed_operation_id=p_operation_id)
   OR EXISTS(SELECT 1 FROM club_invite_private.send_attempts a WHERE a.operation_id=p_operation_id)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 -- Existing RPC checks real auth.uid(), target and current role again,
 -- creates request and notification. Never spoof JWT or create a direct merge.
 BEGIN
  v_link:=public.request_player_profile_link(p_club,p_member,v_target);
  IF v_link IS NULL OR NOT EXISTS(SELECT 1 FROM public.player_profile_link_requests r
    WHERE r.id=v_link AND r.club_id=p_club AND r.source_club_member_id=p_member
     AND r.source_player_profile_id=v_t.source_profile_id
     AND r.requested_by_auth_user_id=v_actor AND r.target_auth_user_id=v_target
     AND r.status='pending')
  THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
  UPDATE club_invite_private.lookup_tickets
   SET consumed_at=clock_timestamp(),consumed_operation_id=p_operation_id,result_link_id=v_link
   WHERE ticket_digest=v_hash AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
  RETURN jsonb_build_object('status','requested','link_id',v_link);
 EXCEPTION WHEN OTHERS THEN
  -- Subtransaction rolls back both request and notification on any failure.
  RETURN jsonb_build_object('status','conflict');
 END;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.check_club_invite_account(uuid,uuid,text),
 public.consume_club_invite_lookup(uuid,uuid,text,text,uuid,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.check_club_invite_account(uuid,uuid,text),
 public.consume_club_invite_lookup(uuid,uuid,text,text,uuid,boolean)
 TO authenticated;
```

### 残課題・統合時の注意
- 20/10分は候補03のwindow_started_atに合わせた固定窓（rolling 10分ではなく既存lookupと同じ方式）。境界直前直後の集中試行を独立レビュー。新APIは操作対象/管理権限を毎回検査し、旧find_profile_link_accountの別枠・ID/名前返却は無断変更しない。別経路利用による実質上限増加は既知の残リスク。
- Authの異常重複・確認済みだがプロフィールなしはconflictで停止する候補。通常未確認はsignup_required。既存の本人宛て自己申請も安全側で停止する候補。既存正規プロフィール未生成は従来の本人整備手順を維持。Auth現メール変更/登録raceはreserve/claim/acceptでも再検査する。Auth row shareだけでは不在メールの同時新規作成を防げないため、送信済み招待は本人同意を必須とし、再分類が変わった場合は停止。正式検証でdeadlock/ログの平文露出/不正JWT・anon login・削除済みユーザーも確認。
- consumed ticketの冪等再応答は同じ認証・対象・メール・operation・保存済みrequest一致時のみ。未消費ticketは5分。消費済みticketの保持/削除と冪等期間は30日最小監査/TTL整合の次区画で最終設計（今回保持を自動延長しない）。reserveもoperation ID跨ぎ重複拒否を実装する。登録済み経路はメール送信quota対象外であり、設定send_enabledを変更しない。
- check/consumeは既存直接link APIを置換しない。明示同意のないrequest生成、ユーザーのメール/PW/プロフィール変更、既存RLS変更は禁止。候補SQLの例外マッピング・lock順・auth.uid/ACL・入力サイズ・PGP/Vault依存・有効期限境界は実SQL検証が必要。既存request関数内の現役職再検査・source一致・通知1回はテスト必須。
- 次工程: 第4区画 reserve/resend/claim/cancelの送信状態機械。第5区画 recipient list/preview/rebind/accept/reject。第6区画 cleanup/ACL/postflight/隔離検証計画。今回の第2/3区画はSQL草案のみ、完全Migration未完成。コミット・SQL適用・メール送信・設定変更なし。

---

Source: [PR #273 comment 7183737045](https://github.com/g-ambe/Padel-match/pull/273#issuecomment-7183737045)

## TASK-08-02 第4区画 A：送信予約・再送予約 SQL草案（未実行）
候補03 + 第1〜3区画 #issuecomment-7183636145 / #issuecomment-7183677998 / #issuecomment-7183684849 の続き。同一BEGIN/ROLLBACK内の追加候補、単体適用禁止。HEAD 7573413b14c43ef0d547272cdedcbe1fc6264a3c、Draft継続。承認 #issuecomment-7182312203 / #issuecomment-7182981350 / #issuecomment-7183006329 に準拠。自動Preview配信を避けcommitせずコメント保存。

### 内部差分と送信予約
service-only入口のactorはWorkerがgetUserで検証したJWT由来、bodyからのactor/mode/IP上書き不可。匿名の復帰経路だけbearerを使用。IPはWorkerが信頼できる接続元情報を正規化し独立鍵HMACした32byte値。匿名用閾値は未確定なので設定NULL時は匿名再送停止、通常の認証済み再送と区別する。閾値の設定・鍵作成・実送信は今回なし。

```sql
ALTER TABLE club_invite_private.send_attempts
 ADD COLUMN request_kind text NOT NULL
   CHECK(request_kind IN ('initial','group_resend','auth_resend')),
 ADD COLUMN reservation_auth_kind text NOT NULL
   CHECK(reservation_auth_kind IN ('manager','recipient','bearer')),
 ADD COLUMN reservation_actor_auth_id uuid,
 ADD CONSTRAINT invite_reservation_actor CHECK (
  (reservation_auth_kind='bearer' AND reservation_actor_auth_id IS NULL AND actor_kind='recipient')
  OR (reservation_auth_kind='recipient' AND reservation_actor_auth_id IS NOT NULL AND actor_kind='recipient')
  OR (reservation_auth_kind='manager' AND reservation_actor_auth_id IS NOT NULL AND actor_kind='manager'
      AND quota_manager_id=reservation_actor_auth_id)),
 ADD CONSTRAINT invite_request_kind CHECK (
  (kind='auth_confirmation')=(request_kind='auth_resend')
  AND (request_kind<>'initial' OR reservation_auth_kind='manager'));

-- Anonymous controls remain OFF until limits and Worker IP trust boundary
-- are reviewed and explicitly configured. All settings are private.
ALTER TABLE club_invite_private.settings
 ADD COLUMN anonymous_ip_10m_limit integer CHECK(anonymous_ip_10m_limit>0),
 ADD COLUMN anonymous_ref_10m_limit integer CHECK(anonymous_ref_10m_limit>0);
CREATE TABLE club_invite_private.anonymous_limits(
 scope text NOT NULL CHECK(scope IN ('ip','invite')),
 subject_digest bytea NOT NULL CHECK(octet_length(subject_digest)=32),
 window_started_at timestamptz NOT NULL,
 attempt_count integer NOT NULL CHECK(attempt_count>0),
 PRIMARY KEY(scope,subject_digest));
ALTER TABLE club_invite_private.anonymous_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON club_invite_private.anonymous_limits FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION club_invite_private.request_fingerprint(p_value jsonb)
RETURNS bytea LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT extensions.hmac(convert_to('invite-request-v1:'||p_value::text,'UTF8'),
   club_invite_private.key_bytes('hmac'),'sha256');
$$;

CREATE FUNCTION club_invite_private.take_anonymous_limit(
 p_scope text,p_digest bytea,p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_lim integer; v_count integer;
BEGIN
 IF p_scope IS NULL OR p_scope NOT IN ('ip','invite') OR p_digest IS NULL
 OR octet_length(p_digest)<>32 OR p_now IS NULL THEN RETURN false; END IF;
 SELECT CASE WHEN p_scope='ip' THEN anonymous_ip_10m_limit ELSE anonymous_ref_10m_limit END
 INTO v_lim FROM club_invite_private.settings WHERE singleton AND send_enabled FOR SHARE;
 IF NOT FOUND OR v_lim IS NULL THEN RETURN false; END IF;
 INSERT INTO club_invite_private.anonymous_limits(scope,subject_digest,window_started_at,attempt_count)
 VALUES(p_scope,p_digest,p_now,1)
 ON CONFLICT(scope,subject_digest) DO UPDATE SET
  attempt_count=CASE WHEN club_invite_private.anonymous_limits.window_started_at<=p_now-interval '10 minutes'
   THEN 1 ELSE club_invite_private.anonymous_limits.attempt_count+1 END,
  window_started_at=CASE WHEN club_invite_private.anonymous_limits.window_started_at<=p_now-interval '10 minutes'
   THEN p_now ELSE club_invite_private.anonymous_limits.window_started_at END
 WHERE club_invite_private.anonymous_limits.window_started_at<=p_now-interval '10 minutes'
   OR club_invite_private.anonymous_limits.attempt_count<v_lim
 RETURNING attempt_count INTO v_count;
 RETURN FOUND AND v_count<=v_lim;
END $$;

CREATE FUNCTION club_invite_private.operation_taken(p_operation uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM club_invite_private.send_attempts WHERE operation_id=p_operation)
 OR EXISTS(SELECT 1 FROM club_invite_private.lookup_tickets WHERE consumed_operation_id=p_operation)
 OR EXISTS(SELECT 1 FROM club_invite_private.invitations WHERE bind_operation_id=p_operation);
$$;

CREATE FUNCTION club_invite_private.send_quota(
 p_member uuid,p_digest bytea,p_manager uuid,p_club uuid,p_now timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM club_invite_private.send_attempts
 WHERE member_id=p_member AND status IN ('reserved','sending')) THEN RETURN 'inflight'; END IF;
 RETURN club_invite_private.quota_check(p_member,p_digest,p_manager,p_club,p_now);
END $$;

-- Only a single existing unconfirmed account may receive Auth signup resend.
CREATE FUNCTION club_invite_private.auth_resend_ok(p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*)=1 AND coalesce(bool_and(u.email_confirmed_at IS NULL),false)
 FROM auth.users u WHERE lower(u.email)=club_invite_private.normalize_email(p_email);
$$;

CREATE FUNCTION public.reserve_club_invite_send(
 p_actor uuid,p_club uuid,p_member uuid,p_operation_id uuid,p_ticket text,p_email text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_t club_invite_private.lookup_tickets%ROWTYPE;
 v_a club_invite_private.send_attempts%ROWTYPE; v_id uuid;
 v_now timestamptz; v_email text; v_digest bytea; v_ticket_hash bytea;
 v_actor_digest bytea; v_request bytea; v_kind text; v_quota text;
BEGIN
 IF p_actor IS NULL OR p_operation_id IS NULL
 OR NOT club_invite_private.manager_ok(p_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 v_now:=clock_timestamp();
 IF NOT club_invite_private.manager_ok(p_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_email:=club_invite_private.normalize_email(p_email);
 v_ticket_hash:=club_invite_private.secret_hash(p_ticket);
 IF v_email IS NULL OR v_ticket_hash IS NULL THEN RETURN jsonb_build_object('status','invalid'); END IF;
 v_digest:=club_invite_private.email_hmac(v_email);
 SELECT * INTO v_t FROM club_invite_private.lookup_tickets
 WHERE ticket_digest=v_ticket_hash AND manager_auth_id=p_actor
  AND club_id=p_club AND member_id=p_member FOR UPDATE;
 IF NOT FOUND OR v_t.account_kind<>'signup_required' OR v_t.email_digest IS DISTINCT FROM v_digest
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_actor_digest:=club_invite_private.request_fingerprint(jsonb_build_array('manager',p_actor));
 v_request:=club_invite_private.request_fingerprint(jsonb_build_array('initial',p_club,p_member,
    encode(v_ticket_hash,'hex'),encode(v_digest,'hex'),p_operation_id));
 IF v_t.consumed_at IS NOT NULL THEN
  SELECT * INTO v_a FROM club_invite_private.send_attempts WHERE operation_id=p_operation_id;
  IF FOUND AND v_t.consumed_operation_id=p_operation_id AND v_a.request_digest=v_request
   AND v_a.actor_binding_digest=v_actor_digest
  THEN RETURN jsonb_build_object('status',v_a.status,'operation_id',p_operation_id,'invite_id',v_a.invite_id,'generation',v_a.generation); END IF;
  RETURN jsonb_build_object('status','conflict');
 END IF;
 IF v_t.expires_at<=v_now OR club_invite_private.operation_taken(p_operation_id)
 OR NOT club_invite_private.source_available(p_club,p_member,v_t.source_profile_id)
 OR EXISTS(SELECT 1 FROM club_invite_private.invitations
   WHERE status='pending' AND (member_id=p_member OR source_profile_id=v_t.source_profile_id))
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 SELECT account_kind INTO v_kind FROM club_invite_private.classify_account(v_email);
 IF v_kind IS DISTINCT FROM 'signup_required'
 THEN RETURN jsonb_build_object('status','recheck_required'); END IF;
 v_quota:=club_invite_private.send_quota(p_member,v_digest,p_actor,p_club,v_now);
 IF v_quota<>'ok' THEN RETURN jsonb_build_object('status',v_quota); END IF;
 INSERT INTO club_invite_private.invitations(club_id,member_id,source_profile_id,inviter_auth_id,
  email_digest,email_ciphertext,generation,created_at,expires_at)
 VALUES(p_club,p_member,v_t.source_profile_id,p_actor,v_digest,
  club_invite_private.encrypt_email(v_email),1,v_now,v_now+interval '168 hours')
 RETURNING id INTO v_id;
 INSERT INTO club_invite_private.send_attempts(operation_id,invite_id,club_id,member_id,
  quota_manager_id,email_digest,generation,actor_kind,reserved_at,day_jst,
  kind,request_digest,actor_binding_digest,request_kind,reservation_auth_kind,reservation_actor_auth_id)
 VALUES(p_operation_id,v_id,p_club,p_member,p_actor,v_digest,1,'manager',v_now,
  (v_now AT TIME ZONE 'Asia/Tokyo')::date,'group_invite',v_request,v_actor_digest,'initial','manager',p_actor);
 UPDATE club_invite_private.lookup_tickets SET consumed_at=v_now,consumed_operation_id=p_operation_id
 WHERE ticket_digest=v_ticket_hash AND consumed_at IS NULL;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 RETURN jsonb_build_object('status','reserved','operation_id',p_operation_id,'invite_id',v_id,'generation',1);
END $$;

-- A single service-only RPC for group mail or Auth confirmation resend.
-- p_mode selected by the server route, never caller-controlled identity.
-- No p_email: only the encrypted original address can be used.
CREATE FUNCTION public.reserve_club_invite_resend(
 p_actor uuid,p_mode text,p_invite uuid,p_generation integer,p_operation_id uuid,
 p_kind text,p_secret text DEFAULT NULL,p_ip_digest bytea DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_i club_invite_private.invitations%ROWTYPE; v_a club_invite_private.send_attempts%ROWTYPE;
 v_now timestamptz; v_email text; v_actor_digest bytea; v_request bytea;
 v_current_digest bytea; v_secret_digest bytea; v_quota text; v_manager uuid;
 v_generation integer; v_kind text; v_request_kind text; v_actor_kind text; v_class text;
BEGIN
 IF p_mode IS NULL OR p_mode NOT IN ('manager','recipient','bearer')
 OR p_kind IS NULL OR p_kind NOT IN ('group_invite','auth_confirmation')
 OR p_operation_id IS NULL OR p_invite IS NULL OR p_generation IS NULL OR p_generation<=0
 OR (p_mode='bearer' AND p_actor IS NOT NULL) OR (p_mode<>'bearer' AND p_actor IS NULL)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 v_now:=clock_timestamp();
 IF p_mode='bearer' THEN
  IF NOT club_invite_private.take_anonymous_limit('ip',p_ip_digest,v_now)
  THEN RETURN jsonb_build_object('status','not_found'); END IF;
  v_secret_digest:=club_invite_private.secret_hash(p_secret);
  IF v_secret_digest IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 ELSE
  IF p_secret IS NOT NULL OR p_ip_digest IS NOT NULL
  THEN RETURN jsonb_build_object('status','invalid'); END IF;
 END IF;
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF p_mode='manager' THEN
  IF NOT club_invite_private.manager_ok(p_actor,v_i.club_id,v_i.member_id)
  THEN RETURN jsonb_build_object('status','not_found'); END IF;
  v_manager:=p_actor; v_actor_kind:='manager';
 ELSIF p_mode='recipient' THEN
  SELECT current_email_digest INTO v_current_digest FROM club_invite_private.recipient_identity(p_actor);
  IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,p_actor,v_current_digest)
  THEN RETURN jsonb_build_object('status','not_found'); END IF;
  v_manager:=v_i.inviter_auth_id; v_actor_kind:='recipient';
 ELSE
  IF v_i.status<>'pending' OR v_i.generation<>p_generation OR v_i.bound_auth_id IS NOT NULL
  OR v_i.expires_at<=v_now OR v_i.recovery_digest IS DISTINCT FROM v_secret_digest
  THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF NOT club_invite_private.take_anonymous_limit('invite',
    club_invite_private.request_fingerprint(jsonb_build_array('anonymous-invite',v_i.id)),v_now)
  THEN RETURN jsonb_build_object('status','not_found'); END IF;
  v_manager:=v_i.inviter_auth_id; v_actor_kind:='recipient';
 END IF;
 v_actor_digest:=club_invite_private.request_fingerprint(jsonb_build_array(p_mode,p_actor,encode(v_secret_digest,'hex')));
 v_request:=club_invite_private.request_fingerprint(jsonb_build_array('resend',p_mode,p_invite,p_generation,p_kind,p_operation_id));
 -- Authenticated retries may see the already advanced generation, but can
 -- never schedule a second mail. An old anonymous bearer gets neutral denial.
 SELECT * INTO v_a FROM club_invite_private.send_attempts WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF v_a.invite_id=p_invite AND v_a.request_digest=v_request AND v_a.actor_binding_digest=v_actor_digest
  THEN RETURN jsonb_build_object('status',v_a.status,'operation_id',p_operation_id,'invite_id',v_a.invite_id,'generation',v_a.generation); END IF;
  RETURN jsonb_build_object('status','not_found');
 END IF;
 IF club_invite_private.operation_taken(p_operation_id)
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 OR v_i.bound_auth_id IS NOT NULL OR v_i.email_ciphertext IS NULL
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_email:=club_invite_private.decrypt_email(v_i.email_ciphertext,v_i.email_digest);
 SELECT account_kind INTO v_class FROM club_invite_private.classify_account(v_email);
 IF v_class IS NULL OR v_class='conflict' THEN RETURN jsonb_build_object('status','conflict'); END IF;
 IF p_kind='auth_confirmation' AND NOT club_invite_private.auth_resend_ok(v_email)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_quota:=club_invite_private.send_quota(v_i.member_id,v_i.email_digest,v_manager,v_i.club_id,v_now);
 IF v_quota<>'ok' THEN
  RETURN jsonb_build_object('status',CASE WHEN p_mode='bearer' THEN 'not_found' ELSE v_quota END);
 END IF;
 v_generation:=v_i.generation; v_kind:=p_kind;
 IF p_kind='group_invite' THEN
  v_generation:=v_generation+1; v_request_kind:='group_resend';
  UPDATE club_invite_private.invitations SET generation=v_generation,recovery_digest=NULL
   WHERE id=v_i.id AND status='pending' AND generation=p_generation AND bound_auth_id IS NULL;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 ELSE v_request_kind:='auth_resend'; END IF;
 INSERT INTO club_invite_private.send_attempts(operation_id,invite_id,club_id,member_id,
   quota_manager_id,email_digest,generation,actor_kind,reserved_at,day_jst,kind,
   request_digest,actor_binding_digest,request_kind,reservation_auth_kind,reservation_actor_auth_id)
 VALUES(p_operation_id,v_i.id,v_i.club_id,v_i.member_id,v_manager,v_i.email_digest,v_generation,
   v_actor_kind,v_now,(v_now AT TIME ZONE 'Asia/Tokyo')::date,v_kind,
   v_request,v_actor_digest,v_request_kind,p_mode,p_actor);
 RETURN jsonb_build_object('status','reserved','operation_id',p_operation_id,'invite_id',v_i.id,'generation',v_generation);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.reserve_club_invite_send(uuid,uuid,uuid,uuid,text,text),
 public.reserve_club_invite_resend(uuid,text,uuid,integer,uuid,text,text,bytea)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_club_invite_send(uuid,uuid,uuid,uuid,text,text),
 public.reserve_club_invite_resend(uuid,text,uuid,integer,uuid,text,text,bytea)
 TO service_role;
```

### 連携・安全性の未確認事項
- reserve/resendは同一共有lock＋settle_staleの後に時刻採取、既存quota 3/3/10/20 JST、200 rolling24h、60秒、member/email同時inflight拒否。quotaは予約全状態合算。初回ticketとinvite/attempt作成を原子化。初回7日、期限内再送は期限不変。グループ再送だけgeneration+1/旧hash消去。Auth再送はgeneration変更なし。bound済みは両再送拒否。
- 期限後は管理者の明示的な新規check→send（新規7日、旧quota継続）。終端暗号文消去済みのため旧行の宛先復元不可。宛先の再入力が必要となる安全側候補。拒否/取消済み・付け替え済みの扱いは既存承認仕様に従い自動復活なし。付け替え取消後の新規申請は未確定回復仕様を勝手に有効化しないよう追加ガードを次区画/統合で設計する。
- 未認証経路の固定10分窓・上限設定NULL（未設定では無効）はレビュー案。匿名のHTTP結果は予約成功/失敗含め常に中立、operation/invite/generation/詳細quotaはWorker外に返さない。失敗時のIP計数永続化（例外で全rollbackするケース）を統合時に補強する必要あり。IP/参照の保持・掃除、IP増殖によるDB負荷、秘密鍵の分離/rotation、CF-Connecting-IPの信頼境界をレビューし、未確定のまま匿名再送を有効化しない。
- 既存Auth確認済みへ変化した初回ticketはrecheck_required。送信予約後もclaimで再分類する。既に有効な招待のgroup再送は宛先固定かつ本人同意を保持。Auth再送は未確認アカウントだけ。既存通常Authの制限を変更しない。予約actorが失効した場合claim側で拒否。bearer旧世代リプレイでは秘密/操作結果を返さない。
- request fingerprint/operation衝突、同時予約、key lookup性能、auth状態・同時変更、日時境界、FK/参照scope、例外処理、send_enabledとclaimのACLを実SQLレビュー。第3区画consumed ticketのoperation跨ぎ判定と第5区画bind/acceptのoperation衝突も統一する。コード未検証、DB操作なし。

---

Source: [PR #273 comment 7183746306](https://github.com/g-ambe/Padel-match/pull/273#issuecomment-7183746306)

## TASK-08-02 第4区画 B：送信claim・管理者取消・状態確認 SQL草案（未実行）
第4区画A #issuecomment-7183737045 + 候補03 + 第1〜3区画を前提。同一BEGIN/ROLLBACK内へ統合。既存アプリ/RLS/Auth/戦績の変更なし。単独実行禁止。

```sql
-- Private helper for invalidated reservations. Never updates the invite or
-- makes a previously claimed send available again.
CREATE FUNCTION club_invite_private.fail_reservation(p_operation uuid,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_code IS NULL OR p_code NOT IN ('cancelled_before_claim','config_disabled','not_claimed')
 THEN RAISE SQLSTATE '22023' USING MESSAGE='Invalid reservation result'; END IF;
 UPDATE club_invite_private.send_attempts SET status='failed',finished_at=clock_timestamp(),failure_code=p_code
 WHERE operation_id=p_operation AND status='reserved';
 RETURN jsonb_build_object('status','not_claimable');
END $$;

CREATE FUNCTION public.claim_club_invite_send(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_a club_invite_private.send_attempts%ROWTYPE; v_i club_invite_private.invitations%ROWTYPE;
 v_now timestamptz; v_email text; v_secret text; v_digest bytea; v_kind text;
 v_club_name text; v_member_name text; v_inviter_name text;
 v_enabled boolean; v_expected_binding bytea;
BEGIN
 IF p_operation_id IS NULL THEN RETURN jsonb_build_object('status','not_claimable'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT * INTO v_a FROM club_invite_private.send_attempts
  WHERE operation_id=p_operation_id FOR UPDATE;
 IF NOT FOUND OR v_a.status<>'reserved'
 THEN RETURN jsonb_build_object('status','not_claimable'); END IF;
 SELECT send_enabled AND global_24h_limit IS NOT NULL INTO v_enabled
 FROM club_invite_private.settings WHERE singleton FOR SHARE;
 IF v_enabled IS NOT TRUE THEN
  RETURN club_invite_private.fail_reservation(p_operation_id,'config_disabled'); END IF;
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=v_a.invite_id FOR UPDATE;
 IF NOT FOUND OR NOT club_invite_private.invite_usable(v_i,v_a.generation)
 OR v_i.bound_auth_id IS NOT NULL OR v_i.email_ciphertext IS NULL
 OR v_i.club_id IS DISTINCT FROM v_a.club_id OR v_i.member_id IS DISTINCT FROM v_a.member_id
 OR v_i.email_digest IS DISTINCT FROM v_a.email_digest
 THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
 -- Recheck current reservation actor. Original inviter rights are separately
 -- checked by invite_usable. No spoofed auth.uid() or external actor input.
 IF v_a.reservation_auth_kind='manager' THEN
  IF NOT club_invite_private.manager_ok(v_a.reservation_actor_auth_id,v_i.club_id,v_i.member_id)
  OR v_a.quota_manager_id IS DISTINCT FROM v_a.reservation_actor_auth_id
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
  v_expected_binding:=club_invite_private.request_fingerprint(
    CASE WHEN v_a.request_kind='initial'
     THEN jsonb_build_array('manager',v_a.reservation_actor_auth_id)
     ELSE jsonb_build_array('manager',v_a.reservation_actor_auth_id,NULL::text) END);
  IF v_expected_binding IS DISTINCT FROM v_a.actor_binding_digest
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
 ELSIF v_a.reservation_auth_kind='recipient' THEN
  SELECT current_email_digest INTO v_digest
  FROM club_invite_private.recipient_identity(v_a.reservation_actor_auth_id);
  IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,v_a.reservation_actor_auth_id,v_digest)
  OR v_a.quota_manager_id IS DISTINCT FROM v_i.inviter_auth_id
  OR v_a.actor_binding_digest IS DISTINCT FROM club_invite_private.request_fingerprint(
    jsonb_build_array('recipient',v_a.reservation_actor_auth_id,NULL::text))
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
 ELSIF v_a.reservation_auth_kind='bearer' THEN
  IF v_a.quota_manager_id IS DISTINCT FROM v_i.inviter_auth_id
  OR NOT EXISTS(SELECT 1 FROM club_invite_private.settings WHERE singleton
      AND anonymous_ip_10m_limit IS NOT NULL AND anonymous_ref_10m_limit IS NOT NULL)
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
  -- Auth resend retains the exact bearer generation. Group resend already
  -- consumed old generation at reservation, and cannot validate it again.
  IF v_a.kind='auth_confirmation' AND (v_i.recovery_digest IS NULL
     OR v_a.actor_binding_digest IS DISTINCT FROM club_invite_private.request_fingerprint(
          jsonb_build_array('bearer',NULL::uuid,encode(v_i.recovery_digest,'hex'))))
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
 ELSE RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;

 -- Secret/key/config or current account drift must stop the claim.
 BEGIN
  v_email:=club_invite_private.decrypt_email(v_i.email_ciphertext,v_i.email_digest);
  SELECT account_kind INTO v_kind FROM club_invite_private.classify_account(v_email);
  IF v_kind IS NULL OR v_kind='conflict'
     OR (v_a.request_kind='initial' AND v_kind IS DISTINCT FROM 'signup_required')
     OR (v_a.kind='auth_confirmation' AND NOT club_invite_private.auth_resend_ok(v_email))
  THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
  IF v_a.kind='group_invite' THEN
   SELECT c.name,coalesce(m.club_display_name,s.display_name),
      coalesce(p.display_name,'グループ管理者')
   INTO v_club_name,v_member_name,v_inviter_name
   FROM public.clubs c JOIN public.club_members m ON m.club_id=c.id
   JOIN public.player_profiles s ON s.id=m.player_profile_id
   LEFT JOIN public.profiles p ON p.id=v_i.inviter_auth_id
   WHERE c.id=v_i.club_id AND m.id=v_i.member_id AND s.id=v_i.source_profile_id;
   IF NOT FOUND OR nullif(btrim(v_club_name),'') IS NULL OR nullif(btrim(v_member_name),'') IS NULL
   THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
   v_secret:=club_invite_private.new_secret();
  END IF;
 EXCEPTION WHEN OTHERS THEN
  RETURN club_invite_private.fail_reservation(p_operation_id,'config_disabled');
 END;
 v_now:=clock_timestamp();
 IF v_a.reserved_at<=v_now-interval '2 minutes'
 THEN RETURN club_invite_private.fail_reservation(p_operation_id,'not_claimed'); END IF;
 IF v_i.expires_at<=v_now
 THEN RETURN club_invite_private.fail_reservation(p_operation_id,'cancelled_before_claim'); END IF;
 IF v_a.kind='group_invite' THEN
  UPDATE club_invite_private.invitations SET recovery_digest=club_invite_private.secret_hash(v_secret)
   WHERE id=v_i.id AND status='pending' AND generation=v_a.generation
    AND bound_auth_id IS NULL AND recovery_digest IS NULL;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 END IF;
 UPDATE club_invite_private.send_attempts SET status='sending',claimed_at=v_now
  WHERE operation_id=p_operation_id AND status='reserved' AND generation=v_a.generation;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 -- This is the only delivery-secret egress and goes only to trusted service
 -- code. Commit succeeded before SMTP/Auth call; never return to browser/log.
 IF v_a.kind='group_invite' THEN
  RETURN jsonb_build_object('status','claimed','kind','group_invite',
    'operation_id',p_operation_id,'invite_id',v_i.id,'generation',v_a.generation,
    'email',v_email,'secret',v_secret,'expires_at',v_i.expires_at,
    'club_name',v_club_name,'member_name',v_member_name,'inviter_name',v_inviter_name);
 END IF;
 RETURN jsonb_build_object('status','claimed','kind','auth_confirmation',
   'operation_id',p_operation_id,'generation',v_a.generation,'email',v_email);
END $$;

CREATE FUNCTION public.cancel_club_invite(p_invite uuid,p_generation integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_i club_invite_private.invitations%ROWTYPE;
 v_now timestamptz; v_sending boolean;
BEGIN
 IF v_actor IS NULL OR p_invite IS NULL OR p_generation IS NULL
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND OR NOT club_invite_private.manager_ok(v_actor,v_i.club_id,v_i.member_id)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF v_i.generation IS DISTINCT FROM p_generation THEN RETURN jsonb_build_object('status','conflict'); END IF;
 IF v_i.status='cancelled' THEN RETURN jsonb_build_object('status','cancelled'); END IF;
 IF v_i.status<>'pending' THEN RETURN jsonb_build_object('status','conflict'); END IF;
 v_now:=clock_timestamp();
 IF v_i.expires_at<=v_now THEN
  PERFORM club_invite_private.settle_stale();
  RETURN jsonb_build_object('status','conflict');
 END IF;
 SELECT EXISTS(SELECT 1 FROM club_invite_private.send_attempts
  WHERE invite_id=v_i.id AND status='sending') INTO v_sending;
 UPDATE club_invite_private.invitations SET status='cancelled',decided_at=v_now,
  email_ciphertext=NULL,recovery_digest=NULL
  WHERE id=v_i.id AND status='pending' AND generation=p_generation;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 UPDATE club_invite_private.send_attempts
 SET status='failed',finished_at=v_now,failure_code='cancelled_before_claim'
 WHERE invite_id=v_i.id AND status='reserved';
 RETURN jsonb_build_object('status','cancelled','delivery_may_continue',v_sending);
END $$;

-- Manager DTO is limited to this target. Never expose raw email or hash,
-- auth uid, operation id, or raw SMTP error. Terminal/bound mask is NULL:
-- no decryption or secret retention solely to populate an old label.
CREATE FUNCTION public.get_club_invite_status(p_club uuid,p_member uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_i club_invite_private.invitations%ROWTYPE;
 v_now timestamptz; v_mask text; v_count bigint; v_last timestamptz;
 v_delivery text; v_inflight boolean; v_expiry timestamptz;
BEGIN
 IF v_actor IS NULL OR NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 IF NOT club_invite_private.manager_ok(v_actor,p_club,p_member)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_now:=clock_timestamp();
 SELECT * INTO v_i FROM club_invite_private.invitations
 WHERE club_id=p_club AND member_id=p_member
 ORDER BY (status='pending') DESC,created_at DESC,id DESC LIMIT 1;
 SELECT count(*) INTO v_count FROM club_invite_private.send_attempts
 WHERE member_id=p_member AND day_jst=(v_now AT TIME ZONE 'Asia/Tokyo')::date;
 IF NOT FOUND THEN v_count:=0; END IF;
 IF v_i.id IS NULL THEN RETURN jsonb_build_object('status','none','member_attempts_today',v_count); END IF;
 IF v_i.status='pending' AND v_i.bound_auth_id IS NULL AND v_i.email_ciphertext IS NOT NULL THEN
  BEGIN
   v_mask:=club_invite_private.mask_email(club_invite_private.decrypt_email(v_i.email_ciphertext,v_i.email_digest));
  EXCEPTION WHEN OTHERS THEN v_mask:=NULL;
  END;
 END IF;
 SELECT max(reserved_at),coalesce(bool_or(status IN ('reserved','sending')),false) INTO v_last,v_inflight
 FROM club_invite_private.send_attempts WHERE member_id=p_member OR email_digest=v_i.email_digest;
 SELECT status INTO v_delivery FROM club_invite_private.send_attempts
 WHERE invite_id=v_i.id ORDER BY reserved_at DESC,operation_id DESC LIMIT 1;
 v_expiry:=v_i.expires_at;
 RETURN jsonb_build_object('status',v_i.status,'invite_id',v_i.id,'generation',v_i.generation,
   'masked_email',v_mask,'expires_at',v_expiry,'member_attempts_today',v_count,
   'cooldown_until',CASE WHEN v_last IS NULL OR v_last+interval '60 seconds'<=v_now
      THEN NULL ELSE v_last+interval '60 seconds' END,
   'delivery_status',v_delivery,'inflight',v_inflight,'rebound',v_i.bound_auth_id IS NOT NULL);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_club_invite_send(uuid),
 public.cancel_club_invite(uuid,integer),public.get_club_invite_status(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_club_invite_send(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_club_invite(uuid,integer),
 public.get_club_invite_status(uuid,uuid) TO authenticated;
```

### 第4区画の統合レビュー項目
1. claim成功transactionのcommitを確認後だけSMTP/Auth APIを1回呼ぶ。claim応答喪失・再claim・タイムアウト時は再送禁止、結果不明を許容。外部送信済みでも取消・期限切れなら受信リンクから連携不可。Auth API successは配送保証なし。Workerの固定送信者/固定redirect/HTML escape、20秒候補タイムアウト、secret fragment/log抑止/CSRF、匿名HTTP中立応答をCodex実装契約へ。失敗コードは既存allowlistの範囲、認可変化はcancelled_before_claimとする候補。
2. 第1区画finalizeと合わせ、cancelled/expired/旧世代でもattempt監査のみ更新。取消とclaim競合、遅延finalize、50並行claim、Auth確認が直前に完了したケース、権限/メール/source変更を隔離検証。既存共有advisory lockだけでは既存の直接DMLやAuth書込み全てを排他できないため最終統合時に対象行ロック順を明確化。外部送信はDB lock解放後であり、その間の取消・権限変更・メール確認を完全に止めることはできない。受取本人確認時に必ず再検証。
3. 管理者表示はmember日次回数・cooldown時刻・inflightの参考情報を返し、再送可否の最終判断はreserveで行う。宛先/管理者/グループ/全体上限が別にあるため、cooldownを全quota解除時刻とは扱わない。未連携/連携済みは既存所属情報と組合せ、終端/付け替え済みマスクはNULL。既存承認後メンバーに過去招待履歴をどこまで表示するかは既存UI契約と合わせる。
4. 未確定の匿名閾値/鍵、bound後の回復・終端からの再招待条件をレビュー。第4区画A/Bは候補03からの差分で、最終DDL・RPC・cleanup・ACL・postflight統合前。次は第5区画 recipient list/preview/rebind/accept/reject。SQL実行・構文試験・独立レビュー未実施、本番/Stage/メール/commit/push/配信なし。

---

Source: [PR #273 comment 7183830993](https://github.com/g-ambe/Padel-match/pull/273#issuecomment-7183830993)

## TASK-08-02 第5区画A：本人一覧・引継ぎ確認・異メール付け替え SQL草案
基準 main 5fd308eea4f7d673c2a3e170c934876634154d94 / Draft #273 HEAD 7573413b14c43ef0d547272cdedcbe1fc6264a3c（変更なし）。承認 #262 #issuecomment-7182312203 / #issuecomment-7182981350 を再照合。候補03＋第1〜4区画に追加する未実行SQL。既存0039、0061、20261125032915 named承認、H38 scoped_previewを参照。自動Preview配信を避けコメントのみ、単独適用禁止。

```sql
-- Store only a domain-separated keyed fingerprint of the rebind payload,
-- never the old bearer or a usable recovery digest after rebind.
ALTER TABLE club_invite_private.invitations
 ADD COLUMN bind_request_digest bytea CHECK(octet_length(bind_request_digest)=32),
 ADD CONSTRAINT invite_bind_request_present
 CHECK((bind_operation_id IS NULL)=(bind_request_digest IS NULL));

CREATE FUNCTION club_invite_private.has_inflight(p_invite uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM club_invite_private.send_attempts
 WHERE invite_id=p_invite AND status IN ('reserved','sending'));
$$;

-- Explicit minimal DTO. Source history is disclosed ONLY after recipient
-- authorization and scope checks. No global player profile rows, emails,
-- Auth ids, hidden group records, raw snapshot or delivery credentials.
CREATE FUNCTION public.list_my_club_invites()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_digest bytea; v_target uuid; v_result jsonb;
BEGIN
 IF v_actor IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND THEN RETURN jsonb_build_object('status','identity_required'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'invite_id',i.id,'generation',i.generation,'club_id',i.club_id,'club_name',c.name,
   'member_name',coalesce(m.club_display_name,p.display_name),'expires_at',i.expires_at,
   'group_visibility',c.visibility,'inflight',club_invite_private.has_inflight(i.id),
   'rebound',i.bound_auth_id IS NOT NULL
 ) ORDER BY i.created_at,i.id),'[]'::jsonb) INTO v_result
 FROM club_invite_private.invitations i
 JOIN public.clubs c ON c.id=i.club_id
 JOIN public.club_members m ON m.id=i.member_id AND m.club_id=i.club_id
 JOIN public.player_profiles p ON p.id=i.source_profile_id AND m.player_profile_id=p.id
 WHERE i.status='pending' AND i.expires_at>clock_timestamp()
 AND ((i.bound_auth_id IS NULL AND i.email_digest=v_digest)
   OR (i.bound_auth_id=v_actor AND i.bound_email_digest=v_digest AND i.bound_generation=i.generation))
 AND club_invite_private.recipient_matches(i,v_actor,v_digest)
 AND club_invite_private.invite_usable(i,i.generation)
 AND c.visibility IN ('public','private');
 RETURN jsonb_build_object('status','ok','invitations',v_result);
END $$;

CREATE FUNCTION public.preview_my_club_invite(p_invite uuid,p_generation integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_digest bytea; v_target uuid;
 v_i club_invite_private.invitations%ROWTYPE; v_p jsonb; v_name text; v_raw text;
 v_visibility text; v_club text;
BEGIN
 IF v_actor IS NULL OR p_invite IS NULL OR p_generation IS NULL
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,v_actor,v_digest)
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF club_invite_private.has_inflight(v_i.id) THEN RETURN jsonb_build_object('status','inflight'); END IF;
 SELECT c.name,c.visibility,m.club_display_name,coalesce(m.club_display_name,p.display_name)
 INTO v_club,v_visibility,v_raw,v_name
 FROM public.clubs c JOIN public.club_members m ON m.club_id=c.id
 JOIN public.player_profiles p ON p.id=m.player_profile_id
 WHERE c.id=v_i.club_id AND m.id=v_i.member_id AND p.id=v_i.source_profile_id;
 IF NOT FOUND OR v_visibility NOT IN ('public','private') THEN RETURN jsonb_build_object('status','conflict'); END IF;
 v_p:=profile_link_private.scoped_preview(v_i.source_profile_id,v_actor,v_i.club_id);
 IF nullif(v_p->>'review_token','') IS NULL OR v_p->>'target_profile_id' IS DISTINCT FROM v_target::text
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 RETURN jsonb_build_object('status','ok','invite_id',v_i.id,'generation',v_i.generation,
  'club_id',v_i.club_id,'club_name',v_club,'expires_at',v_i.expires_at,
  'group_visibility',v_visibility,'group_display_name_suggestion',v_name,
  'group_display_name_current',v_raw,'review_token',v_p->>'review_token',
  'target_display_name',v_p->>'target_display_name',
  'participant_count',v_p->'participant_count','match_count',v_p->'match_count',
  'result_count',v_p->'result_count','team_match_count',v_p->'team_match_count',
  'official_match_count',v_p->'official_match_count');
END $$;

-- This preview is an authenticated POST, not a GET, and does not consume
-- the bearer. Only the particular invitation proven by the current token.
CREATE FUNCTION public.preview_club_invite_rebind(
 p_invite uuid,p_generation integer,p_secret text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_digest bytea; v_target uuid;
 v_i club_invite_private.invitations%ROWTYPE; v_secret_hash bytea; v_email text;
 v_current_email text; v_name text;
BEGIN
 IF v_actor IS NULL OR p_invite IS NULL OR p_generation IS NULL
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_secret_hash:=club_invite_private.secret_hash(p_secret);
 IF v_secret_hash IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND OR v_i.bound_auth_id IS NOT NULL OR v_i.recovery_digest IS DISTINCT FROM v_secret_hash
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF club_invite_private.has_inflight(v_i.id) THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF v_digest=v_i.email_digest THEN RETURN jsonb_build_object('status','use_normal_invite'); END IF;
 v_email:=club_invite_private.decrypt_email(v_i.email_ciphertext,v_i.email_digest);
 SELECT u.email,p.display_name INTO v_current_email,v_name
 FROM auth.users u JOIN public.player_profiles p ON p.id=v_target
 WHERE u.id=v_actor AND p.linked_auth_user_id=v_actor AND p.is_active;
 IF NOT FOUND OR club_invite_private.email_hmac(v_current_email) IS DISTINCT FROM v_digest
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 RETURN jsonb_build_object('status','ok','invite_id',v_i.id,'generation',v_i.generation,
  'original_email_masked',club_invite_private.mask_email(v_email),
  'current_account_email',v_current_email,'current_account_name',v_name);
END $$;

CREATE FUNCTION public.rebind_club_invite(
 p_operation_id uuid,p_invite uuid,p_generation integer,p_secret text,p_consent boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_digest bytea; v_target uuid;
 v_i club_invite_private.invitations%ROWTYPE; v_hash bytea; v_request bytea; v_now timestamptz;
BEGIN
 IF v_actor IS NULL OR p_operation_id IS NULL OR p_invite IS NULL
 OR p_generation IS NULL OR p_consent IS NOT TRUE
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_hash:=club_invite_private.secret_hash(p_secret);
 IF v_hash IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_request:=club_invite_private.request_fingerprint(jsonb_build_array('rebind',p_operation_id,
   p_invite,p_generation,v_actor,encode(v_digest,'hex'),encode(v_hash,'hex'),true));
 -- Replay returns only the result, never new authority or another link.
 IF v_i.bound_auth_id IS NOT NULL THEN
  IF v_i.bind_operation_id=p_operation_id AND v_i.bind_request_digest=v_request
  AND club_invite_private.recipient_matches(v_i,v_actor,v_digest)
  AND club_invite_private.invite_usable(v_i,p_generation)
  THEN RETURN jsonb_build_object('status','rebound','invite_id',v_i.id,'generation',v_i.generation); END IF;
  RETURN jsonb_build_object('status','not_found');
 END IF;
 IF club_invite_private.operation_taken(p_operation_id)
 OR v_i.recovery_digest IS DISTINCT FROM v_hash OR v_i.email_digest=v_digest
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 OR club_invite_private.has_inflight(v_i.id)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 -- Verify the source/cipher and current key before irreversible erasure.
 PERFORM club_invite_private.decrypt_email(v_i.email_ciphertext,v_i.email_digest);
 v_now:=clock_timestamp();
 IF v_i.expires_at<=v_now THEN RETURN jsonb_build_object('status','not_found'); END IF;
 UPDATE club_invite_private.invitations
 SET bound_auth_id=v_actor,bound_email_digest=v_digest,bound_at=v_now,
  bound_generation=p_generation,bind_operation_id=p_operation_id,bind_request_digest=v_request,
  email_ciphertext=NULL,recovery_digest=NULL
 WHERE id=v_i.id AND status='pending' AND generation=p_generation
  AND bound_auth_id IS NULL AND recovery_digest=v_hash AND expires_at>v_now;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
 RETURN jsonb_build_object('status','rebound','invite_id',v_i.id,'generation',p_generation);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.list_my_club_invites(),public.preview_my_club_invite(uuid,integer),
 public.preview_club_invite_rebind(uuid,integer,text),public.rebind_club_invite(uuid,uuid,integer,text,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_my_club_invites(),public.preview_my_club_invite(uuid,integer),
 public.preview_club_invite_rebind(uuid,integer,text),public.rebind_club_invite(uuid,uuid,integer,text,boolean)
 TO authenticated;
```

### 安全性・次の統合条件
- 通常一覧は現在の確認済みAuthメール一致、付け替え後はbound UID/現メールdigest/世代一致。元メールだけでは不可。付け替え前に開示するのは当該リンク1件の元宛先マスクと自分の現アカウントのみ。自分のメールは本人にのみ返す。別宛先招待の検索・列挙なし。GET無害、POST/CSRF/no-store/fragment即消去/ログ除外はWorker実装必須。bearer転送リスク承認済み。
- 同一操作リプレイ用の鍵付きpayload fingerprint列は内部実装候補。旧hashを直接保存しない。終端時fingerprint消去とbind_operation_id/制約/30日保持の整合は第6区画で調整。replayはpending/有効な本人のみ、終端後は中立応答。付け替えだけで所属/戦績/通知/Auth変更なし。期限延長なし。
- recipient_identityはcanonical必須なので未整備は通常プロフィール整備へ誘導。identity_requiredは本人の招待有無を開示しない。inflight中の一覧は表示可能だがpreview/付け替え/承認は停止。previewは読取りの瞬間整合であり、最終acceptは同じtoken・表示名raw CAS・visibility・履歴scopeをロック下で再確認する。source scopeのteam側/最新参照・auth/club競合・キー障害/例外中立化・レート負荷を独立レビュー。SQL未試験。

---

Source: [PR #273 comment 7183840406](https://github.com/g-ambe/Padel-match/pull/273#issuecomment-7183840406)

## TASK-08-02 第5区画B：本人承認・拒否・既存戦績統合 SQL草案
第5区画A #issuecomment-7183830993 と第1〜4区画・候補03を前提。同一BEGIN/ROLLBACK内で統合する未実行草案。既存0039のrequest/expire/lock_references/preview/merge、0061のDTO、20261125032915の公開ON/OFF対応済みnamed approvalを直接照合。既存関数の置換、FK許可緩和、Auth偽装、直接mergeを行わない。HEAD 7573413b14c43ef0d547272cdedcbe1fc6264a3c。

```sql
-- Stable per-decision replay identity, never a bearer credential.
-- Keep only keyed input fingerprint and the actual deciding account.
ALTER TABLE club_invite_private.invitations
 ADD COLUMN decision_operation_id uuid UNIQUE,
 ADD COLUMN decision_request_digest bytea CHECK(octet_length(decision_request_digest)=32),
 ADD CONSTRAINT invite_decision_operation_pair CHECK(
   (decision_operation_id IS NULL)=(decision_request_digest IS NULL)
   AND (decision_operation_id IS NULL OR (status IN ('approved','rejected')
     AND recipient_auth_id IS NOT NULL)));

CREATE OR REPLACE FUNCTION club_invite_private.operation_taken(p_operation uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM club_invite_private.send_attempts WHERE operation_id=p_operation)
 OR EXISTS(SELECT 1 FROM club_invite_private.lookup_tickets WHERE consumed_operation_id=p_operation)
 OR EXISTS(SELECT 1 FROM club_invite_private.invitations
   WHERE bind_operation_id=p_operation OR decision_operation_id=p_operation);
$$;

-- Lock parents as well as existing merge references. This is a draft lock
-- order for isolated deadlock tests, not a change to legacy merge locks.
-- No external network calls while locks are held.
CREATE FUNCTION club_invite_private.lock_accept_scope(p_club uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM profile_link_private.serialize_operations();
 PERFORM 1 FROM public.clubs WHERE id=p_club FOR UPDATE;
 PERFORM profile_link_private.lock_references();
 LOCK TABLE public.events,public.event_team_sides,public.official_events
 IN SHARE ROW EXCLUSIVE MODE;
END $$;

-- Ensure no ordinary-match references are scoped by participant in one
-- club but by actual match in another/unknown club.
CREATE FUNCTION club_invite_private.ordinary_history_in_scope(p_source uuid,p_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(
  SELECT 1 FROM public.match_players mp
  JOIN public.event_participants ep ON ep.id=mp.participant_id
  LEFT JOIN public.matches m ON m.id=mp.match_id
  LEFT JOIN public.events e ON e.id=m.event_id
  WHERE ep.player_profile_id=p_source
   AND (e.club_id IS DISTINCT FROM p_club OR m.event_id IS DISTINCT FROM ep.event_id)
 );
$$;

CREATE FUNCTION public.accept_my_club_invite(
 p_invite uuid,p_generation integer,p_operation_id uuid,
 p_review_token text,p_expected_club_display_name text,p_expected_visibility text,
 p_club_display_name text,p_public_confirmation boolean,p_inheritance_consent boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_target uuid; v_digest bytea;
 v_i club_invite_private.invitations%ROWTYPE; v_source public.club_members%ROWTYPE;
 v_club public.clubs%ROWTYPE; v_preview jsonb; v_result jsonb; v_link uuid;
 v_merge uuid; v_request bytea; v_chosen text:=btrim(p_club_display_name);
BEGIN
 IF v_actor IS NULL OR p_invite IS NULL OR p_generation IS NULL
 OR p_operation_id IS NULL OR p_inheritance_consent IS NOT TRUE
 OR p_review_token IS NULL OR char_length(p_review_token) NOT BETWEEN 1 AND 256
 OR v_chosen IS NULL OR char_length(v_chosen) NOT BETWEEN 1 AND 120
 OR v_chosen ~ '[[:cntrl:]]' OR p_public_confirmation IS NULL
 OR p_expected_visibility IS NULL OR p_expected_visibility NOT IN ('public','private')
 OR (p_expected_visibility='private' AND p_public_confirmation)
 THEN RETURN jsonb_build_object('status','invalid'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND OR v_i.generation IS DISTINCT FROM p_generation
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,v_actor,v_digest)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_request:=club_invite_private.request_fingerprint(jsonb_build_array(
   'accept',p_invite,p_generation,p_operation_id,v_actor,encode(v_digest,'hex'),
   p_review_token,p_expected_club_display_name,p_expected_visibility,
   p_club_display_name,p_public_confirmation,true));
 IF v_i.status='approved' THEN
  IF v_i.recipient_auth_id=v_actor AND v_i.decision_operation_id=p_operation_id
     AND v_i.decision_request_digest=v_request
     AND EXISTS(SELECT 1 FROM public.player_profile_merges m
       WHERE m.link_request_id=v_i.link_request_id AND m.target_auth_user_id=v_actor
       AND m.target_player_profile_id=v_target AND m.club_id=v_i.club_id
       AND m.restored_at IS NULL)
  THEN RETURN jsonb_build_object('status','approved','invite_id',v_i.id,'club_id',v_i.club_id); END IF;
  RETURN jsonb_build_object('status','not_found');
 END IF;
 IF club_invite_private.operation_taken(p_operation_id)
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 OR club_invite_private.has_inflight(v_i.id)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;

 -- Do not rely on the earlier optimistic checks. Hold source references
 -- and group visibility through the actual named approval.
 PERFORM club_invite_private.lock_accept_scope(v_i.club_id);
 SELECT * INTO v_club FROM public.clubs WHERE id=v_i.club_id AND is_active
  AND NOT coalesce(is_deleted,false);
 IF NOT FOUND OR v_club.visibility IS DISTINCT FROM p_expected_visibility
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 SELECT * INTO v_source FROM public.club_members WHERE id=v_i.member_id
  AND club_id=v_i.club_id AND player_profile_id=v_i.source_profile_id FOR UPDATE;
 IF NOT FOUND OR v_source.club_display_name IS DISTINCT FROM p_expected_club_display_name
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 SELECT canonical_id,current_email_digest INTO v_target,v_digest
 FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,v_actor,v_digest)
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 OR NOT club_invite_private.ordinary_history_in_scope(v_i.source_profile_id,v_i.club_id)
 OR v_target=v_i.source_profile_id OR club_invite_private.has_inflight(v_i.id)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 -- Do not silently collapse duplicate memberships or a concurrent normal
 -- join. Existing merge guards remain the final authority.
 IF EXISTS(SELECT 1 FROM public.club_members
     WHERE club_id=v_i.club_id AND id<>v_i.member_id
      AND (player_profile_id=v_target OR profile_id=v_actor))
 OR EXISTS(SELECT 1 FROM public.join_requests j
     WHERE j.club_id=v_i.club_id AND j.requester_player_profile_id=v_target
      AND j.status='pending' AND coalesce(j.expires_at,j.created_at+interval '7 days')>clock_timestamp())
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 v_preview:=profile_link_private.scoped_preview(v_i.source_profile_id,v_actor,v_i.club_id);
 IF v_preview->>'review_token' IS DISTINCT FROM p_review_token
 OR v_preview->>'target_profile_id' IS DISTINCT FROM v_target::text
 OR v_i.expires_at<=clock_timestamp()
 THEN RETURN jsonb_build_object('status','conflict'); END IF;

 -- The existing pending-source unique index includes expired pending rows.
 -- Use the same existing expiry routine as request_player_profile_link,
 -- only inside the approval subtransaction, before inserting the request.
 BEGIN
  PERFORM profile_link_private.expire_requests();
  IF NOT club_invite_private.invite_usable(v_i,p_generation)
  OR EXISTS(SELECT 1 FROM public.player_profile_link_requests
      WHERE source_player_profile_id=v_i.source_profile_id AND status='pending')
  OR EXISTS(SELECT 1 FROM public.join_requests
      WHERE consent_source_player_profile_id=v_i.source_profile_id AND status='pending')
  THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation conflict'; END IF;
  INSERT INTO public.player_profile_link_requests(
   club_id,source_club_member_id,source_player_profile_id,target_auth_user_id,
   expected_target_player_profile_id,requested_by_auth_user_id,expires_at)
  VALUES(v_i.club_id,v_i.member_id,v_i.source_profile_id,v_actor,
   v_target,v_i.inviter_auth_id,v_i.expires_at) RETURNING id INTO v_link;
  -- Critical: call the existing PUBLIC named RPC as the real recipient.
  -- No set_config JWT impersonation, direct private merge or raw name write.
  v_result:=public.review_player_profile_link_named(v_link,p_review_token,
      v_chosen,p_expected_club_display_name,p_public_confirmation);
  IF v_result->>'status' IS DISTINCT FROM 'approved'
   OR nullif(v_result->>'merge_id','') IS NULL
  THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation approval failed'; END IF;
  v_merge:=(v_result->>'merge_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.player_profile_merges m
    WHERE m.id=v_merge AND m.link_request_id=v_link AND m.restored_at IS NULL
     AND m.source_player_profile_id=v_i.source_profile_id AND m.target_player_profile_id=v_target
     AND m.target_auth_user_id=v_actor AND m.club_id=v_i.club_id)
  OR NOT EXISTS(SELECT 1 FROM public.player_profile_link_requests r
     WHERE r.id=v_link AND r.status='approved' AND r.reviewed_by_auth_user_id=v_actor
     AND r.target_auth_user_id=v_actor)
  OR NOT EXISTS(SELECT 1 FROM public.club_members m JOIN public.player_profiles p
     ON p.id=m.player_profile_id WHERE m.id=v_i.member_id AND m.club_id=v_i.club_id
     AND p.id=v_target AND p.linked_auth_user_id=v_actor AND p.is_active
     AND m.is_active AND m.status='active' AND m.club_display_name=v_chosen
     AND m.club_name_public_choice IS NOT DISTINCT FROM
      CASE WHEN v_club.visibility='public' THEN CASE WHEN p_public_confirmation THEN 'on' ELSE 'off' END ELSE NULL END)
  THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation approval failed'; END IF;
  UPDATE club_invite_private.invitations SET status='approved',recipient_auth_id=v_actor,
    link_request_id=v_link,decided_at=clock_timestamp(),email_ciphertext=NULL,recovery_digest=NULL,
    decision_operation_id=p_operation_id,decision_request_digest=v_request
   WHERE id=v_i.id AND status='pending' AND generation=p_generation;
  IF NOT FOUND THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Invitation approval failed'; END IF;
  -- Existing named approval already writes notification and restore audit.
  -- No additional notification or modification of the canonical name.
  RETURN jsonb_build_object('status','approved','invite_id',v_i.id,'club_id',v_i.club_id);
 EXCEPTION WHEN OTHERS THEN
  -- Roll back request + merge + notification + alias + invite in this
  -- subtransaction. Never return SQLERRM, raw rows or tokens to caller.
  RETURN jsonb_build_object('status','conflict');
 END;
END $$;

CREATE FUNCTION public.reject_my_club_invite(
 p_invite uuid,p_generation integer,p_operation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_i club_invite_private.invitations%ROWTYPE;
 v_digest bytea;v_request bytea;v_now timestamptz;
BEGIN
 IF v_actor IS NULL OR p_invite IS NULL OR p_generation IS NULL OR p_operation_id IS NULL
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 SELECT * INTO v_i FROM club_invite_private.invitations WHERE id=p_invite FOR UPDATE;
 IF NOT FOUND OR v_i.generation IS DISTINCT FROM p_generation
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 SELECT current_email_digest INTO v_digest FROM club_invite_private.recipient_identity(v_actor);
 IF NOT FOUND OR NOT club_invite_private.recipient_matches(v_i,v_actor,v_digest)
 THEN RETURN jsonb_build_object('status','not_found'); END IF;
 v_request:=club_invite_private.request_fingerprint(jsonb_build_array(
    'reject',p_invite,p_generation,p_operation_id,v_actor,encode(v_digest,'hex')));
 IF v_i.status='rejected' THEN
  IF v_i.recipient_auth_id=v_actor AND v_i.decision_operation_id=p_operation_id
   AND v_i.decision_request_digest=v_request
  THEN RETURN jsonb_build_object('status','rejected','invite_id',v_i.id); END IF;
  RETURN jsonb_build_object('status','not_found');
 END IF;
 IF club_invite_private.operation_taken(p_operation_id)
 OR NOT club_invite_private.invite_usable(v_i,p_generation)
 OR club_invite_private.has_inflight(v_i.id)
 THEN RETURN jsonb_build_object('status','conflict'); END IF;
 v_now:=clock_timestamp();
 UPDATE club_invite_private.invitations SET status='rejected',recipient_auth_id=v_actor,
  decided_at=v_now,email_ciphertext=NULL,recovery_digest=NULL,
  decision_operation_id=p_operation_id,decision_request_digest=v_request
 WHERE id=v_i.id AND status='pending' AND generation=p_generation AND expires_at>v_now;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','conflict'); END IF;
 RETURN jsonb_build_object('status','rejected','invite_id',v_i.id);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.accept_my_club_invite(uuid,integer,uuid,text,text,text,text,boolean,boolean),
 public.reject_my_club_invite(uuid,integer,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_my_club_invite(uuid,integer,uuid,text,text,text,text,boolean,boolean),
 public.reject_my_club_invite(uuid,integer,uuid) TO authenticated;
```

### 複数招待・未検証事項
- 一括承認用のDB RPCを作らない。Worker/UIは選択された招待ごとに固有operation UUID、generation、reviewToken、raw expectedClubDisplayName、expectedVisibility、chosenName、明示public boolean、inheritanceConsent=trueを送り、1 RPC=1 transaction。成功済みは戻さず各結果表示、未選択は保留、失敗分だけ再preview。operation UUIDは内部冪等契約として追加する候補。決定結果のreplayは同じ本人・現在のメール・世代・入力・operationだけ。既存mergeがrestore済みなら過去承認を成功として再提示しない。
- 名前初期値は仮所属alias優先。public ON/OFF両方許可、privateはfalseのみ（既存named内部ではchoice NULL）。visibility/name/token CAS、既存audit after_row・既存通知を維持。既存管理者再承認なし。拒否は招待だけを終端、仮所属や戦績を保持。inflight中の拒否も安全側で待機させる内部候補（既存UIとの整合を確認）。
- 既存expire_requestsは全体の期限切れ申請を通常request同様に終端化する既存関数。成功時のみその既存副作用を含む、失敗時は承認subtransactionごとrollback。既存join/linkの有効な競合は停止。期限境界におけるnow()/clock_timestamp()差、expired pending unique、既存requestの復元/同意snapshotを隔離確認。招待側source_available/既存mergeの二重チェックは統合時に実schema・FK検証。
- ロック順は草案。Auth行share→club→既存lock_references→event親/sideロックと旧アプリの順序、直接DML、role/super_user変更、異なるクラブ操作、同時スコア・イベント変更を検証し、必要なら順序を整理。source snapshotでカバーされない参照やteam側の所属判定、既存対象者のinactive所属競合（過剰拒否の可能性）も独立レビュー。既存権限やFKの緩和は不可。既存source範囲外はfail closed。
- 重要：現第5区画A/BのRPC草案は未実行。構文、実テーブル/列・関数signature、private ACL、例外分類、rollbackと実データ保全を独立試験する。第6区画で終端fingerprint/監査30日・参照cleanup・ACL/preflight/postflight、全体統合で過去草案の矛盾解消。rebind後の回復・匿名制限値は未承認、既存仕様を変更せず停止のまま。新規branch/PR、DB/メール/設定/commit/push/配信なし。
