"""H51: offline-only post-Phase2 safety bridge rehearsal.

This deliberately preserves all business rows and post-cutover writes.
Old REVIEW rejection/cancellation remains callable; unsafe legacy APPROVED
is rejected before merging. Named new approval is rewired to the unchanged
private implementation, but no live pending request exists in source data,
so a *successful named approval E2E* is explicitly not verified here.

This script is an isolated PostgreSQL ACL/RPC test, NOT a declaration that
the old Worker fully works with the new DB.
"""
from __future__ import annotations
from pathlib import Path

HERE=Path(__file__).resolve().parent
SQL=HERE / '164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql'

CONTRACT="""SELECT json_build_object(
 'legacy_anon',has_function_privilege('anon',
   'public.review_player_profile_link(uuid,text,text)','EXECUTE'),
 'legacy_authenticated',has_function_privilege('authenticated',
   'public.review_player_profile_link(uuid,text,text)','EXECUTE'),
 'named_authenticated',has_function_privilege('authenticated',
   'public.review_player_profile_link_named(uuid,text,text,text,boolean)','EXECUTE'),
 'private_exists',to_regprocedure(
   'profile_link_private.review_player_profile_link_original(uuid,text,text)') IS NOT NULL,
 'private_anon',coalesce(has_function_privilege('anon',
   to_regprocedure('profile_link_private.review_player_profile_link_original(uuid,text,text)'),
   'EXECUTE'),false),
 'private_authenticated',coalesce(has_function_privilege('authenticated',
   to_regprocedure('profile_link_private.review_player_profile_link_original(uuid,text,text)'),
   'EXECUTE'),false),
 'direct_anon_membership',has_table_privilege('anon','public.club_members','SELECT'),
 'alias_present',EXISTS(SELECT 1 FROM information_schema.columns WHERE
   table_schema='public' AND table_name='club_members'
   AND column_name='club_display_name'),
 'legacy_approval_guarded',position('最新版の連携画面' IN
   (SELECT pg_get_functiondef(oid) FROM pg_proc
    WHERE oid='public.review_player_profile_link(uuid,text,text)'::regprocedure))>0,
 'named_private_call',position(
   'profile_link_private.review_player_profile_link_original(p_request_id,''approved'',p_review_token)'
   IN (SELECT pg_get_functiondef(oid) FROM pg_proc
       WHERE oid='public.review_player_profile_link_named(uuid,text,text,text,boolean)'::regprocedure))>0,
 'private_merge_preserved',(CASE WHEN to_regprocedure(
   'profile_link_private.review_player_profile_link_original(uuid,text,text)') IS NULL
   THEN false ELSE position('profile_link_private.merge_profiles' IN
    (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE oid=to_regprocedure(
     'profile_link_private.review_player_profile_link_original(uuid,text,text)')))>0 END),
 'migration_count',(SELECT count(*) FROM supabase_migrations.schema_migrations)
)"""

def run(target,data,legacy_data,legacy_cols,legacy_digest,legacy_integrity,
        require,b,h44,h45,h48):
    require(isinstance(target,b.LocalRestore),'H51_must_run_in_isolated_db')
    require(SQL.is_file(),'H51_candidate_sql_missing')
    print("H51: capture pre-guard RPC/ACL contract",flush=True)
    before=target.query(CONTRACT)
    require(before['legacy_authenticated'] and before['named_authenticated']
            and not before['legacy_approval_guarded']
            and not before['private_exists'] and before['alias_present']
            and not before['direct_anon_membership'],
            'H51_expected_unpatched_phase2_missing')
    rows_digest=h45.digest(target.query(h45.rows_sql()))
    require(h48.legacy_signature(target,b,legacy_cols,require,h45)==legacy_digest,
            'H51_before_legacy_data_mismatch')
    # Add a post-COMMIT write in the *local* DB. The recovery guard must not
    # remove this marker or replace full business tables with stale data.
    h44.isolated(target,"""BEGIN;
      CREATE TABLE public.h51_postcutover_data_preservation (
        marker text PRIMARY KEY);
      INSERT INTO public.h51_postcutover_data_preservation VALUES('retained');
      COMMIT;""")
    print("H51: original new-DB rows and a post-COMMIT-only marker captured",flush=True)
    print("H51: apply guarded RPC candidate only in isolated DB",flush=True)
    h44.isolated(target,SQL.read_text())
    print("H51: inspect guarded RPC contract",flush=True)
    after=target.query(CONTRACT)
    require(after['private_exists'] and not after['private_anon']
            and not after['private_authenticated']
            and not after['legacy_anon']
            and after['legacy_authenticated'] and after['named_authenticated']
            and after['legacy_approval_guarded'] and after['named_private_call']
            and after['private_merge_preserved'] and after['alias_present']
            and not after['direct_anon_membership']
            and before['migration_count']==after['migration_count'],
            'H51_secure_legacy_approval_guard_not_enforced')

    target_id='00000000-0000-0000-0000-000000000001'
    # Authenticated old-client approval returns a predictable deny result
    # WITHOUT reaching old merge logic. Never log the identity or SQL response.
    h44.isolated(target, """BEGIN;
    SET LOCAL ROLE authenticated;
    DO $probe$
    DECLARE blocked boolean:=false; msg text:='';
    BEGIN
      BEGIN
        PERFORM public.review_player_profile_link('"""+target_id+"""'::uuid,'approved',NULL);
      EXCEPTION WHEN insufficient_privilege THEN
        GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
        blocked := position('最新版の連携画面' IN msg)>0;
      END;
      IF NOT blocked THEN RAISE EXCEPTION 'H51_UNSAFE_LEGACY_APPROVAL_PERMITTED'; END IF;
    END $probe$;
    ROLLBACK;""")
    print("H51 PASS: authenticated legacy approval rejected before merge",flush=True)

    h44.isolated(target, """BEGIN;
    SET LOCAL ROLE anon;
    DO $probe$
    DECLARE blocked boolean:=false;
    BEGIN
      BEGIN
        PERFORM public.review_player_profile_link('"""+target_id+"""'::uuid,'rejected',NULL);
      EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
      END;
      IF NOT blocked THEN RAISE EXCEPTION 'H51_ANON_MAY_REVIEW_LINK'; END IF;
    END $probe$;
    ROLLBACK;""")
    print("H51 PASS: anonymous cannot invoke legacy or private review RPC",flush=True)

    # All 3 source requests are already approved; this verifies a real,
    # authenticated completed-request 'rejected' call remains available and
    # idempotently returns existing state, without mutating actual rows.
    requests=data['player_profile_link_requests']
    completed=next((r for r in requests if r.get('status')=='approved'
        and r.get('target_auth_user_id')),None)
    require(completed is not None,'H51_no_completed_real_link_request_available')
    query=("BEGIN; SET LOCAL ROLE authenticated;"
      " SELECT set_config('request.jwt.claim.sub',"+b.literal(completed['target_auth_user_id'])+",true);"
      " SELECT to_json(public.review_player_profile_link("+b.literal(completed['id'])+"::uuid,"
      "'rejected',NULL)->>'status'); ROLLBACK;")
    # Ignore the set_config SELECT result; the final JSON literal is expected
    # to report 'approved' and not update any existing linked record.
    output=h44.isolated(target,query)
    require('"approved"' in output.splitlines()[-1:],
            'H51_legacy_reject_completed_request_not_usable')
    print("H51 PASS: authenticated old RPC keeps safe reject/cancel dispatch;"
          " completed real request remains unchanged",flush=True)

    require(target.query("SELECT json_build_object('preserved',"
        "(SELECT count(*) FROM public.h51_postcutover_data_preservation "
        "WHERE marker='retained')=1)")['preserved'],
        'H51_postcutover_data_was_lost')
    require(h45.digest(target.query(h45.rows_sql()))==rows_digest,
            'H51_group_business_rows_changed')
    h48.verify(target,b,legacy_data,legacy_cols,legacy_digest,legacy_integrity,
               require,h45,'H51_after_guard')
    require(target.query(CONTRACT)==after,
            'H51_security_grants_changed_during_probe')
    print("H51 PASS: 24 tables unchanged, subsequent committed marker preserved;"
          " ACL+RPC guard does not rewind the DB",flush=True)
    print("H51 LIMITATION: old Worker link approval is unavailable by design;"
          " real pending named approval/HTTP/E2E NOT proven; Prod NO-GO",flush=True)

    # H52 is explicitly opt-in and only runs after the existing H51 proof.
    trigger=(HERE / '.task08-free-rehearsal-trigger').read_text().splitlines()
    if 'H52_PENDING_LINK_TEST=1' in trigger:
        import json
        require(isinstance(target,b.LocalRestore),'H52_must_run_in_isolated_db')
        probe=HERE / '167_h52_pending_link_isolated_rollback_probe.sql'
        require(probe.is_file(),'H52_probe_missing')
        # Include complete group rows (new alias/consent fields too), auth fixture
        # counts, notifications and merge audit; compare digest only, never print rows.
        snapshot_sql="""SELECT json_build_object(
          'groups',(SELECT coalesce(json_agg(to_jsonb(t) ORDER BY id),'[]'::json) FROM public.clubs t),
          'members',(SELECT coalesce(json_agg(to_jsonb(t) ORDER BY id),'[]'::json) FROM public.club_members t),
          'players',(SELECT coalesce(json_agg(to_jsonb(t) ORDER BY id),'[]'::json) FROM public.player_profiles t),
          'profiles',(SELECT coalesce(json_agg(to_jsonb(t) ORDER BY id),'[]'::json) FROM public.profiles t),
          'links',(SELECT coalesce(json_agg(to_jsonb(t) ORDER BY id),'[]'::json) FROM public.player_profile_link_requests t),
          'joins',(SELECT coalesce(json_agg(to_jsonb(t) ORDER BY id),'[]'::json) FROM public.join_requests t),
          'auth_count',(SELECT count(*) FROM auth.users),
          'notification_count',(SELECT count(*) FROM public.notifications),
          'merge_count',(SELECT count(*) FROM public.player_profile_merges),
          'merge_changes_count',(SELECT count(*) FROM profile_link_private.merge_changes),
          'history',(SELECT coalesce(json_agg(to_jsonb(t) ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations t),
          'marker',(SELECT count(*) FROM public.h51_postcutover_data_preservation WHERE marker='retained'))"""
        before_h52=h45.digest(target.query(snapshot_sql))
        print("H52: synthetic pending-link RPC checks on post-H51 isolated DB",flush=True)
        # Keep raw database stderr private. Capture only failing static SQL
        # line and predefined reason code, never a UUID, row, token or context.
        import re
        import subprocess

        def run_h52_sql(path,label):
            sql_text=path.read_text()
            result=subprocess.run(target.prefix+b.PSQL+["--set","VERBOSITY=verbose"],
                input=("SET ROLE postgres;\n"+sql_text+"\n").encode(),
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=600,check=False)
            if result.returncode:
                err=result.stderr.decode(errors='replace')
                loc=re.search(r'psql:[^\n]*?:(\d+):\s*ERROR:',err)
                state=re.search(r'ERROR:\s+([0-9A-Z]{5}):',err)
                reason='unclassified'
                known={
                  '未確認の外部キーがあります':'unreviewed_reference',
                  'H52 source private/media references require separate review':'source_media_guard',
                  '連携申請を送信する権限がありません':'request_manager',
                  '対象メンバーを管理する権限がありません':'request_member',
                  '登録済みアカウントを確認できません':'request_account',
                  '承認待ちの申請があります':'request_duplicate',
                  '申請元の管理権限が変更されています':'review_manager',
                  '申請先本人の承認、または管理者の取消が必要です':'review_actor',
                  '確認後に内容が変更されています':'review_token',
                  'プロフィール画面で本人の正規プロフィールを作成':'canonical_missing',
                  'この連携申請を確認する権限がありません':'detail_denied',
                }
                for needle,code in known.items():
                    if needle in err:
                        reason=code
                        break
                for code in re.findall(r"RAISE EXCEPTION '(H52[ _][A-Za-z0-9 _-]+)'",sql_text):
                    if code in err:
                        reason=code.replace(' ','_')
                        break
                require(False,'H52_'+label+'_failed_line_'+(loc.group(1) if loc else 'unknown')
                        +'_state_'+(state.group(1) if state else 'unknown')+'_'+reason)
            return result.stdout.decode().strip()

        candidate=HERE/'168_h52_media_reference_guard_CANDIDATE.sql'
        require(candidate.is_file(),'H52_media_candidate_missing')
        print("H52: reproduce old FK guard failure and apply isolated media-reference candidate",flush=True)
        run_h52_sql(candidate,'media_candidate')
        require(h45.digest(target.query(snapshot_sql))==before_h52,'H52_candidate_changed_group_auth_audit_or_history')
        h48.verify(target,b,legacy_data,legacy_cols,legacy_digest,legacy_integrity,
                   require,h45,'H52_after_media_candidate')
        require(target.query(CONTRACT)==after,'H52_candidate_changed_H51_contract')
        print("H52 PASS: old FK guard reproduced; reviewed media compatibility candidate applied; rows and H51 contract unchanged",flush=True)
        guard_sql="""SELECT json_build_object(
          'guard',pg_get_functiondef('profile_link_private.check_reference_schema()'::regprocedure),
          'merge',pg_get_functiondef('profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure),
          'guard_auth',has_function_privilege('authenticated','profile_link_private.check_reference_schema()','EXECUTE'),
          'merge_auth',has_function_privilege('authenticated','profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE'))"""
        guard_before=target.query(guard_sql)
        require(not guard_before['guard_auth'] and not guard_before['merge_auth'],'H52_private_guard_granted')
        raw=run_h52_sql(probe,'probe')
        # SQL emits only synthetic set_config values and the final boolean report.
        # Never echo raw output or tokens; parse the final JSON line.
        report=json.loads(raw.splitlines()[-1])
        expected={'rollback_only','unknown_fk_denied','source_private_denied','source_object_denied',
          'source_operation_denied','canonical_target_media_unchanged','legacy_approval_denied','pending_rejected_cancelled',
          'no_merge_reject_cancel','cancel_source_preserved','manager_scope_safe',
          'other_user_rejected','public_requires_consent','alias_cas_pt409',
          'obsolete_review_token_rejected','private_public_flag_rejected','approved_both',
          'public_alias_saved','private_alias_is_private','old_legacy_rejection_preserves_source',
          'public_directory_confirmed_or_unlinked','merge_snapshots_consistent',
          'request_receiver_consent_saved','private_request_consent_not_public',
          'legacy_request_not_backfilled','original_profile_names_unmodified','approved_sources_retired'}
        require(isinstance(report,dict) and set(report)==expected,'H52_report_shape_invalid')
        for key in sorted(expected):
            require(report[key] is True,'H52_assertion_failed_'+key)
            print('H52 PASS: '+key,flush=True)
        require(h45.digest(target.query(snapshot_sql))==before_h52,'H52_rollback_group_auth_audit_or_history_changed')
        h48.verify(target,b,legacy_data,legacy_cols,legacy_digest,legacy_integrity,
                   require,h45,'H52_after_rollback')
        require(target.query(CONTRACT)==after,'H52_post_rollback_contract_changed')
        require(target.query(guard_sql)==guard_before,'H52_post_rollback_media_guard_changed')
        print("H52 PASS: synthetic fixture rolled back; source rows, legacy rows, marker, history and RPC/ACL contract unchanged",flush=True)
        print("H52 LIMITATION: SQL roles/claim simulation only; real JWT/PostgREST and Worker browser compatibility remain unverified; Prod NO-GO",flush=True)

        if 'H53_JOIN_RESTORE_TEST=1' in trigger:
            probe53=HERE/'169_h53_join_and_reviewed_restore_isolated_probe.sql'
            require(probe53.is_file(),'H53_probe_missing')
            raw53=run_h52_sql(probe53,'h53_join_restore')
            report53=json.loads(raw53.splitlines()[-1])
            expected53={'rollback_only','no_consent_rejected','approval_requests',
                'recipient_name_applied','claimed_name_applied','provisional_profile_inactivated',
                'merge_audit_consistent','public_directory_only_consented','public_ref_not_real_member_id',
                'direct_named_raw_rpc_revoked','reviewed_restore_completed','restored_member',
                'restored_source','restored_request_cancelled','normal_join_retained','canonical_media_unchanged'}
            require(set(report53)==expected53,'H53_report_shape_invalid')
            for key in sorted(expected53):
                require(report53[key] is True,'H53_assertion_failed_'+key)
                print('H53 PASS: '+key,flush=True)
            require(h45.digest(target.query(snapshot_sql))==before_h52,'H53_rollback_group_auth_audit_or_history_changed')
            h48.verify(target,b,legacy_data,legacy_cols,legacy_digest,legacy_integrity,
                       require,h45,'H53_after_rollback')
            require(target.query(CONTRACT)==after and target.query(guard_sql)==guard_before,
                    'H53_contract_changed')
            print('H53 PASS: reviewed join/restore fixture rolled back, source data and security unchanged',flush=True)
            print('H53 LIMITATION: SQL role simulation, reviewed restore only; concurrent operations and HTTP/browser not proven',flush=True)
