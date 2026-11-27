# TASK-08-02 / #262 — 第6区画：監査・保持・権限・適用前後検査（review only）

**未実行、未統合、未承認の適用。単体実行禁止。** 基準 main 5fd308eea4f7d673c2a3e170c934876634154d94、PR #273 HEAD a2fe3cad9860781336070337f84b122a9970d2f4。候補03 DDLおよび [第1〜5区画原文](02_rpc_review_drafts.md) に追加する草案。承認 [内部値](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7183006329)、[付け替え](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7182981350)、[API契約](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7182312203)、[Preview許可](https://github.com/g-ambe/Padel-match/issues/262#issuecomment-7184025223) を維持。既存Auth・所属・戦績・既存merge/restore audit・RLS/ACL・通知の保持期間を変更しない。Preview自動ビルドの前HEAD a2fe3ca 成功は [bot記録](https://github.com/g-ambe/Padel-match/pull/273#issuecomment-7183066195) で確認、SQL実行の証拠ではない。

## 1. 保持対象と削除方針

| 対象 | 保持・削除の候補 |
|---|---|
| pending invitation | 最大168時間、期限内再送で延長なし。元宛先の暗号文、現在世代の復帰hashのみ。付け替え時は双方を即消去 |
| 終端 invitation | 決定後30日を上限とする最小監査・冪等応答用のID、世代、時刻、状態、宛先HMAC、実本人・連携ID、必要な決定fingerprint。暗号文/復帰hash/付け替えpayload fingerprintは終端時に即消去。既存merge監査は対象外 |
| send_attempt | 成否・時刻・quota用digest/ID・種別・失敗分類・同一操作判定に必要な情報のみ。終端から30日。reserved/sendingは削除せず先に2分leaseを終端化。全状態をquota計算に含める |
| 未消費 lookup ticket | 5分を超えたら削除。期限後の新規消費不可 |
| 消費済み lookup ticket | 再実行防止・同一操作応答のため最大30日候補。新規操作には使用不可。必要な照合項目だけ残す。長期の同一操作再実行保証はしない |
| lookup/anonymous rate counters | 承認済み検索10分窓／候補の匿名10分窓終了後に削除。匿名上限未設定で無効のまま |
| 鍵・既存Auth/会員/戦績/統合監査 | 削除しない。実鍵作成・ローテーション・バックアップ保持は別承認 |

30日は原則720時間（固定時間として具体化した候補）。決定済み行は依存する送信試行を先に削除。直後の送信結果確定が遅れた場合、FK整合のため親行の削除が試行の期限まで数分遅れる可能性あり。定期実行時刻分の遅延もあり、厳密な即時物理消去を保証しない。ログ/バックアップ/WALの保持期間は別管理。HMACも個人情報に準じて保護、匿名化済みと扱わない。冪等期間は30日以内、期限切れ後の古い操作・IDは再実行権限にならない（特に新規check ticketと同一operationの再利用禁止は第7区画で検証）。削除は本機能private schemaのみ。

## 2. 終端時の秘密消去と定期整理 SQL候補

以下は第1〜5区画のDDL/RPC定義後、同一未適用transactionの末尾で統合する差分。既存第5区画Aのbind_request_digest制約を置換し、終端では鍵付きpayload fingerprintを残さない。bound UID/email digestは決定冪等・監査期間中のみ維持し、元宛先による再取得は許さない。

```sql
-- candidate only; do not execute standalone
ALTER TABLE club_invite_private.invitations
 DROP CONSTRAINT invite_bind_request_present,
 ADD CONSTRAINT invite_bind_request_present CHECK (
   (status='pending' AND (bind_operation_id IS NULL)=(bind_request_digest IS NULL))
   OR (status<>'pending' AND bind_request_digest IS NULL)
 );
CREATE FUNCTION club_invite_private.erase_terminal_secrets()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status<>'pending' THEN
  NEW.email_ciphertext:=NULL;
  NEW.recovery_digest:=NULL;
  NEW.bind_request_digest:=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER club_invite_erase_terminal_secrets
 BEFORE INSERT OR UPDATE ON club_invite_private.invitations
 FOR EACH ROW EXECUTE FUNCTION club_invite_private.erase_terminal_secrets();

CREATE INDEX club_invite_terminal_retention
 ON club_invite_private.invitations(decided_at)
 WHERE status<>'pending';
CREATE INDEX club_invite_attempt_retention
 ON club_invite_private.send_attempts(finished_at)
 WHERE status IN ('sent','failed','unknown');
CREATE INDEX club_invite_consumed_lookup_retention
 ON club_invite_private.lookup_tickets(consumed_at)
 WHERE consumed_at IS NOT NULL;
CREATE INDEX club_invite_lookup_limit_window
 ON club_invite_private.lookup_limits(window_started_at);
CREATE INDEX club_invite_anon_limit_window
 ON club_invite_private.anonymous_limits(window_started_at);

-- Owner-only maintenance. Not exposed to PostgREST or service_role.
-- No cron job, network call, send, key creation, or actual deletion now.
CREATE FUNCTION club_invite_private.cleanup_retention()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz; v_cutoff timestamptz;
 v_attempts bigint; v_invites bigint; v_tickets bigint;
 v_lookup_limits bigint; v_anonymous_limits bigint;
BEGIN
 PERFORM profile_link_private.serialize_operations();
 PERFORM club_invite_private.settle_stale();
 v_now:=clock_timestamp();
 v_cutoff:=v_now-interval '720 hours';
 DELETE FROM club_invite_private.send_attempts
 WHERE status IN ('sent','failed','unknown')
   AND finished_at<=v_cutoff
   AND reserved_at<=v_cutoff
   -- never remove a current quota window entry even if the retention
   -- or time configuration changes unexpectedly
   AND reserved_at<=v_now-interval '24 hours'
   AND day_jst < (v_now AT TIME ZONE 'Asia/Tokyo')::date;
 GET DIAGNOSTICS v_attempts=ROW_COUNT;

 DELETE FROM club_invite_private.invitations i
 WHERE i.status<>'pending' AND i.decided_at<=v_cutoff
   AND i.email_ciphertext IS NULL AND i.recovery_digest IS NULL
   AND i.bind_request_digest IS NULL
   AND NOT EXISTS(SELECT 1 FROM club_invite_private.send_attempts a WHERE a.invite_id=i.id);
 GET DIAGNOSTICS v_invites=ROW_COUNT;

 DELETE FROM club_invite_private.lookup_tickets
 WHERE (consumed_at IS NULL AND expires_at<=v_now)
    OR (consumed_at IS NOT NULL AND consumed_at<=v_cutoff);
 GET DIAGNOSTICS v_tickets=ROW_COUNT;

 DELETE FROM club_invite_private.lookup_limits
 WHERE window_started_at<=v_now-interval '10 minutes';
 GET DIAGNOSTICS v_lookup_limits=ROW_COUNT;

 DELETE FROM club_invite_private.anonymous_limits
 WHERE window_started_at<=v_now-interval '10 minutes';
 GET DIAGNOSTICS v_anonymous_limits=ROW_COUNT;

 RETURN jsonb_build_object('attempts_deleted',v_attempts,'invitations_deleted',v_invites,
  'tickets_deleted',v_tickets,'lookup_windows_deleted',v_lookup_limits,
  'anonymous_windows_deleted',v_anonymous_limits);
END $$;
REVOKE ALL ON FUNCTION club_invite_private.cleanup_retention(),
 club_invite_private.erase_terminal_secrets()
 FROM PUBLIC,anon,authenticated,service_role;
```

**運用ゲート:** cleanup_retentionはownerによる隔離検証・別承認の定期ジョブ専用。現時点でcron extension追加、cron.schedule、Worker定期起動設定、DB実行を一切行わない。期限切れは各RPCのsettle_staleと毎回のexpires_at検証で即時アクセス拒否、未アクセス行の暗号文掃除には定期実行が必要。ジョブ間隔は毎分候補（2分leaseと整合、実負荷/lockを確認して決定）。失敗は集計件数と成功時刻のみ監視、秘密や行内容を記録しない。ジョブ設定・実際の期限掃除を検証するまで送信機能ON禁止。期限後の旧行削除により旧operation ID再利用は区別不能となりうるので、有効な新規ticket/現世代/本人認証なしの処理は常に不可。期限後の冪等保証を宣伝しない。

## 3. 適用前カタログ検査候補

第7区画の統合ファイルでは候補03のCREATE SCHEMAより前へ配置する。既存DBは今回照会しない。既存カタログhash/適用履歴の実値照合は隔離schemaとリリース直前の承認済みREAD ONLYで別途固定。関数存在だけで本番適用可と判断しない。

```sql
-- run as the approved migration owner, before any new DDL
DO $invite_preflight$
DECLARE f text; o oid;
BEGIN
 IF current_user<>'postgres' OR to_regnamespace('club_invite_private') IS NOT NULL
 OR to_regnamespace('profile_link_private') IS NULL
 OR to_regclass('vault.decrypted_secrets') IS NULL
 OR to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL
 OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL
 OR to_regprocedure('extensions.digest(bytea,text)') IS NULL
 OR to_regprocedure('extensions.pgp_sym_encrypt(text,text,text)') IS NULL
 OR to_regprocedure('extensions.pgp_sym_decrypt(bytea,text)') IS NULL
 THEN RAISE EXCEPTION 'Invite baseline missing or already installed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.club_members')
  AND attname='club_name_public_choice' AND NOT attisdropped)
 OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.player_profile_link_requests')
  AND attname='club_name_public_choice' AND NOT attisdropped)
 THEN RAISE EXCEPTION 'Invite requires current named consent'; END IF;

 FOREACH f IN ARRAY ARRAY[
  'profile_link_private.serialize_operations()',
  'profile_link_private.lock_references()',
  'profile_link_private.check_reference_schema()',
  'profile_link_private.scoped_preview(uuid,uuid,uuid)',
  'profile_link_private.canonical(uuid,uuid)',
  'profile_link_private.club_role(uuid,uuid)',
  'profile_link_private.expire_requests()',
  'public.request_player_profile_link(uuid,uuid,uuid)',
  'public.review_player_profile_link_named(uuid,text,text,text,boolean)'
 ] LOOP
  o:=to_regprocedure(f);
  IF o IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=o
      AND pg_get_userbyid(proowner)='postgres')
  THEN RAISE EXCEPTION 'Invite baseline function missing or owner changed: %',f; END IF;
  IF has_function_privilege('anon',o,'EXECUTE')
    OR (f LIKE 'profile_link_private.%' AND (
        has_function_privilege('authenticated',o,'EXECUTE')
        OR has_function_privilege('service_role',o,'EXECUTE')))
    OR (f LIKE 'public.%' AND NOT has_function_privilege('authenticated',o,'EXECUTE'))
  THEN RAISE EXCEPTION 'Invite baseline function ACL drift: %',f; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(
     'public.review_player_profile_link_named(uuid,text,text,text,boolean)')
    AND prosecdef AND position('profile_link_private.review_player_profile_link_original' IN prosrc)>0
    AND position('club_name_public_choice' IN prosrc)>0)
 THEN RAISE EXCEPTION 'Invite named approval contract drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
   'check_club_invite_account','consume_club_invite_lookup',
   'reserve_club_invite_send','reserve_club_invite_resend','claim_club_invite_send',
   'finalize_club_invite_send','cancel_club_invite','get_club_invite_status',
   'list_my_club_invites','preview_my_club_invite','preview_club_invite_rebind',
   'rebind_club_invite','accept_my_club_invite','reject_my_club_invite']))
 THEN RAISE EXCEPTION 'Invite RPC name collision'; END IF;
 -- Existing validated FK allowlist; no new FK into player_profiles.
 PERFORM profile_link_private.check_reference_schema();
END $invite_preflight$;
```

canonical/role等の実signature・owner/ACLを隔離カタログで確認する。既存関数の定義/ACL/テーブルRLSの事前snapshotと適用後比較（新private/public関数以外不変）をテストで実施。既存権限をpreflight通過のため緩めない。

## 4. 最終ACL・postflight候補

既存public schema全体にはREVOKEをしない。新規private schema・新規14本RPCのみ。既存public/anon/auth/service ACLに触れず、unexpected role grantを検出したらtransactionを失敗させる。private tableはRLS有効かつポリシーなし、直接付与なし。SECURITY DEFINERは固定search_path、owner postgresを確認する。

```sql
REVOKE ALL ON SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA club_invite_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA club_invite_private
 REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;

DO $invite_acl$
DECLARE f text; r text; o oid; expected_role text;
 auth_f text[]:=ARRAY[
 'public.check_club_invite_account(uuid,uuid,text)',
 'public.consume_club_invite_lookup(uuid,uuid,text,text,uuid,boolean)',
 'public.cancel_club_invite(uuid,integer)',
 'public.get_club_invite_status(uuid,uuid)',
 'public.list_my_club_invites()',
 'public.preview_my_club_invite(uuid,integer)',
 'public.preview_club_invite_rebind(uuid,integer,text)',
 'public.rebind_club_invite(uuid,uuid,integer,text,boolean)',
 'public.accept_my_club_invite(uuid,integer,uuid,text,text,text,text,boolean,boolean)',
 'public.reject_my_club_invite(uuid,integer,uuid)'];
 svc_f text[]:=ARRAY[
 'public.reserve_club_invite_send(uuid,uuid,uuid,uuid,text,text)',
 'public.reserve_club_invite_resend(uuid,text,uuid,integer,uuid,text,text,bytea)',
 'public.claim_club_invite_send(uuid)',
 'public.finalize_club_invite_send(uuid,integer,text,text)'];
 roles_to_check text[]:=ARRAY['anon','authenticated','service_role'];
 nsp oid:=to_regnamespace('club_invite_private');
 x record;
BEGIN
 IF current_user<>'postgres' OR nsp IS NULL THEN RAISE EXCEPTION 'Invite owner mismatch'; END IF;
 FOREACH f IN ARRAY auth_f||svc_f LOOP
  o:=to_regprocedure(f);
  IF o IS NULL THEN RAISE EXCEPTION 'Missing invite RPC: %',f; END IF;
  expected_role:=CASE WHEN f=ANY(auth_f) THEN 'authenticated' ELSE 'service_role' END;
  -- f is a constant audited signature array, never user input.
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',f,expected_role);
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=o AND p.prosecdef
    AND pg_get_userbyid(p.proowner)='postgres'
    AND coalesce(p.proconfig,ARRAY[]::text[]) && ARRAY['search_path=""','search_path='])
  THEN RAISE EXCEPTION 'Invite RPC unsafe owner/search path: %',f; END IF;
  FOREACH r IN ARRAY roles_to_check LOOP
   IF has_function_privilege(r,o,'EXECUTE') IS DISTINCT FROM (r=expected_role)
   THEN RAISE EXCEPTION 'Invite RPC ACL mismatch: % / %',f,r; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL
     aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE p.oid=o AND (a.grantee=0 OR
       a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname=expected_role))
       OR (a.grantee<>p.proowner AND a.is_grantable)))
  THEN RAISE EXCEPTION 'Unexpected RPC grant: %',f; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL
    aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.oid=nsp AND a.grantee<>n.nspowner)
 OR NOT EXISTS(SELECT 1 FROM pg_namespace WHERE oid=nsp AND pg_get_userbyid(nspowner)='postgres')
 THEN RAISE EXCEPTION 'Private schema grant/owner mismatch'; END IF;
 FOREACH r IN ARRAY roles_to_check LOOP
  IF has_schema_privilege(r,nsp,'USAGE') OR has_schema_privilege(r,nsp,'CREATE')
  THEN RAISE EXCEPTION 'Private schema exposed: %',r; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class WHERE relnamespace=nsp AND relkind IN ('r','p'))<>6
 THEN RAISE EXCEPTION 'Unexpected private table count'; END IF;
 FOR x IN SELECT c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity
  FROM pg_class c WHERE c.relnamespace=nsp AND c.relkind IN ('r','p') LOOP
  IF NOT x.relrowsecurity OR pg_get_userbyid(x.relowner)<>'postgres'
  OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=x.oid)
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(x.relacl,acldefault('r',x.relowner))) a
    WHERE a.grantee<>x.relowner)
  THEN RAISE EXCEPTION 'Private table boundary mismatch: %',x.relname; END IF;
  FOREACH r IN ARRAY roles_to_check LOOP
   IF has_table_privilege(r,x.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_any_column_privilege(r,x.oid,'SELECT,INSERT,UPDATE,REFERENCES')
   THEN RAISE EXCEPTION 'Private table exposed: % / %',x.relname,r; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
     WHERE a.attrelid=x.oid AND acl.grantee<>x.relowner)
  THEN RAISE EXCEPTION 'Unexpected private column grant: %',x.relname; END IF;
 END LOOP;
 FOR x IN SELECT p.oid,p.proname,p.proowner,p.proacl,p.proconfig
  FROM pg_proc p WHERE p.pronamespace=nsp LOOP
  IF pg_get_userbyid(x.proowner)<>'postgres'
   OR NOT (coalesce(x.proconfig,ARRAY[]::text[]) && ARRAY['search_path=""','search_path='])
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(x.proacl,acldefault('f',x.proowner))) a
     WHERE a.grantee<>x.proowner)
  THEN RAISE EXCEPTION 'Private function boundary mismatch: %',x.proname; END IF;
  FOREACH r IN ARRAY roles_to_check LOOP
   IF has_function_privilege(r,x.oid,'EXECUTE')
   THEN RAISE EXCEPTION 'Private function exposed: % / %',x.proname,r; END IF;
  END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM club_invite_private.settings)<>1
 OR NOT EXISTS(SELECT 1 FROM club_invite_private.settings
    WHERE singleton AND NOT send_enabled AND global_24h_limit=200
    AND anonymous_ip_10m_limit IS NULL AND anonymous_ref_10m_limit IS NULL)
 THEN RAISE EXCEPTION 'Invite initial operational gate is unsafe'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relnamespace=nsp AND c.contype='f' AND c.confrelid='public.player_profiles'::regclass)
 THEN RAISE EXCEPTION 'Invite introduces forbidden player profile FK'; END IF;
 PERFORM profile_link_private.check_reference_schema();
END $invite_acl$;
```

Postflightは初期DDL確認専用で、運用ON後のヘルスチェックとは分離。明示的に定義したtable/RPC数とACLの検査を実際の隔離DBで行う。複数権限文字列のhas_*_privilege、proconfigの表現、既存serialize/canonical等のowner/ACLはPG版と現schemaで照合。pg_cron owner権限は別検証。PostgRESTのexposed schemasにprivateを追加しない、REST直接テーブル、匿名/Auth/service JWTで負の試験必須。service_roleは既存の別schemaで強い権限を持つため、Workerの秘密漏洩対策を継続。今回の新規ACLだけでservice_role自体を安全とみなさない。

## 5. 第7区画への統合必須事項・独立検証

- 既存第3区画consumeのoperation_taken判定を決定・bind・sendすべてと統一。初回ticket再実行・匿名IPカウンタの例外rollback、回数境界、旧lookup別枠は未解決。匿名閾値未承認のままONにしない。
- rebind後の取消→再招待の回復手順は未承認。古いbound行を30日で消すと恒久ブロックの判定根拠も失われる。無期限の個人情報/識別子保管を勝手に追加せず、回復仕様が確定するまで新機能の有効化を止める。取消操作自体は既存承認範囲を維持。元宛先の権限を復活させない。
- 期限後の旧秘密・旧ticket・終端状態から再利用不可、30日削除→過去operationの再使用、明示新規check後の新しい招待と区別。管理者明示操作、宛先再入力をレビュー。ログにSQLの生入力・SMTPエラー・Authトークンを含めない。
- 隔離試験: 期限境界、2分lease、30日ちょうど/直前/直後、FK RESTRICT、cleanupと予約/承認並行、JST日跨ぎとrolling24h quota不変、未使用ticket5分、消費済み再実行、旧hash消去、bound終端fingerprint消去、既存merge/戦績/会員/Auth全行不変、既存関数/ACL/RLS/FK snapshot差分なし、API 14本正負、private direct table/column/function/schema拒否、未承認設定OFF、ジョブ失敗と再実行。正常cleanupが何度実行されても行が復活しないこと。既存バックアップやWALの物理消去は保証対象外。
- 本番/正式StageへのSQL適用、cron設定、鍵取得/作成、メール、merge/deployは未承認。第6区画のSQLは構文/実行/独立レビュー未実施。第7区画で既存第1〜5区画と本候補を統合し、関数/列/ロック順/各例外の矛盾を修正、ROLLBACK付き候補を隔離検証へ渡す。既存migrationを編集せず、実適用ファイルは承認済みゲートで管理する。
