"""H54 isolated atomic cutover rehearsal; never a hosted migration.

Compose the already reviewed SQL bodies only on LocalRestore. Test-only
history version and marker remain disposable. No network or real app login.
"""
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent

def body(path, require):
    lines=path.read_text().splitlines()
    begin=[i for i,s in enumerate(lines) if re.fullmatch(r'\s*BEGIN\s*;\s*',s,re.I)]
    end=[i for i,s in enumerate(lines) if re.fullmatch(r'\s*COMMIT\s*;\s*',s,re.I)]
    require(len(begin)==1 and len(end)==1 and begin[0]<end[0]
            and not any(s.strip() and not s.lstrip().startswith('--') for s in lines[end[0]+1:]),
            'H54_unreviewed_transaction_boundary_'+path.name)
    return '\n'.join(lines[:begin[0]]+lines[begin[0]+1:end[0]])

def run(target,b,h44,h45,h48,h51,data,legacy_data,legacy_cols,
        legacy_digest,legacy_integrity,require):
    require(isinstance(target,b.LocalRestore),'H54_isolated_only')
    require(h48 is not None and h51 is not None,'H54_requires_H48_H51_H52_H53')
    gate_before=h44.gate(target)
    require(gate_before['phase2_eligible'],'H54_requires_committed_phase1')
    contract_sql="""SELECT json_build_object(
      'legacy_review',pg_get_functiondef('public.review_player_profile_link(uuid,text,text)'::regprocedure),
      'link_detail',pg_get_functiondef('public.get_player_profile_link_request(uuid)'::regprocedure),
      'merge',pg_get_functiondef('profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure),
      'fk_guard',pg_get_functiondef('profile_link_private.check_reference_schema()'::regprocedure),
      'named_exists',to_regprocedure('public.review_player_profile_link_named(uuid,text,text,text,boolean)') IS NOT NULL,
      'private_exists',to_regprocedure('profile_link_private.review_player_profile_link_original(uuid,text,text)') IS NOT NULL,
      'marker_exists',to_regclass('public.h51_postcutover_data_preservation') IS NOT NULL,
      'alias_exists',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='club_members' AND column_name='club_display_name'),
      'anon_membership_select',has_any_column_privilege('anon','public.club_members','SELECT'),
      'history',(SELECT coalesce(json_agg(to_jsonb(t) ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations t))"""
    before=target.query(contract_sql)
    before_rows=h45.digest(target.query(h45.rows_sql()))
    require(before_rows==h45.digest(data),'H54_pre_cutover_group_drift')
    require(before['anon_membership_select'] and not before['named_exists'] and
            not before['marker_exists'] and not before['private_exists'] and not before['alias_exists'],
            'H54_expected_phase1_contract_missing')

    phase2=body(h44.PHASE2,require)
    guard51=body(HERE/'164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql',require)
    guard52=body(HERE/'168_h52_media_reference_guard_CANDIDATE.sql',require)
    # Same test history used by H44/H45. A production history identifier
    # requires separate reconciliation/approval; do not adopt this version.
    combined="BEGIN;\n"+phase2+"""
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES('20990101010002','task08_prod_phase2_atomic',ARRAY['H54 ephemeral atomic cutover rehearsal']::text[]);
"""+guard51+"""
-- Isolation-only marker, not part of any production migration.
CREATE TABLE public.h51_postcutover_data_preservation(marker text PRIMARY KEY);
REVOKE ALL ON public.h51_postcutover_data_preservation FROM PUBLIC,anon,authenticated;
INSERT INTO public.h51_postcutover_data_preservation VALUES('retained');
"""+guard52+"""
DO $h54_atomic_postflight$
BEGIN
 IF has_any_column_privilege('anon','public.club_members','SELECT')
 OR has_function_privilege('authenticated','profile_link_private.review_player_profile_link_original(uuid,text,text)','EXECUTE')
 OR position('最新版の連携画面' IN pg_get_functiondef('public.review_player_profile_link(uuid,text,text)'::regprocedure))=0
 OR position('profile_link_private.review_player_profile_link_original(p_request_id,''approved'',p_review_token)' IN pg_get_functiondef('public.review_player_profile_link_named(uuid,text,text,text,boolean)'::regprocedure))=0
 OR position('H52 source private/media' IN pg_get_functiondef('profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'H54_atomic_postflight_failed'; END IF;
END $h54_atomic_postflight$;
"""
    # Fail at the last statement, after all schema/ACL/history changes.
    # psql ON_ERROR_STOP closes the session; PostgreSQL aborts the transaction.
    print('H54: inject failure before atomic COMMIT',flush=True)
    try:
        h44.isolated(target,combined+'SELECT 1/0;\nCOMMIT;')
    except b.BackupError as exc:
        require(str(exc)=='isolated_restore_sql_failed/22012',
                'H54_injection_not_reached')
    else:
        require(False,'H54_injected_failure_did_not_abort')
    require(target.query(contract_sql)==before and h44.gate(target)==gate_before,
            'H54_failed_cutover_left_schema_acl_or_history_changes')
    require(h45.digest(target.query(h45.rows_sql()))==before_rows,
            'H54_failed_cutover_changed_group_rows')
    h48.verify(target,b,legacy_data,legacy_cols,legacy_digest,legacy_integrity,
               require,h45,'H54_after_injected_failure')
    print('H54 PASS: injected final statement failure restores Phase1 contract, rows and history',flush=True)

    h44.isolated(target,combined+'COMMIT;')
    after=target.query(contract_sql)
    gate_after=h44.gate(target)
    require(not after['anon_membership_select'] and after['named_exists'] and
            after['private_exists'] and after['marker_exists'] and after['alias_exists'] and
            len(after['history'])==len(before['history'])+1 and
            gate_after['phase2_history_entries']==1 and not gate_after['phase2_eligible'],
            'H54_committed_atomic_contract_invalid')
    require(h45.digest(target.query(h45.rows_sql()))==before_rows,
            'H54_committed_cutover_changed_group_rows')
    h48.verify(target,b,legacy_data,legacy_cols,legacy_digest,legacy_integrity,
               require,h45,'H54_after_atomic_commit')
    print('H54 PASS: Phase2, H51, H52 and test history committed together; real subset preserved',flush=True)
    try:
        h44.isolated(target,combined+'COMMIT;')
    except b.BackupError as exc:
        require(str(exc)=='isolated_restore_sql_failed/P0001','H54_unexpected_repeat_error')
    else:
        require(False,'H54_repeat_application_allowed')
    require(target.query(contract_sql)==after and h44.gate(target)==gate_after,
            'H54_repeat_attempt_changed_contract')
    require(h45.digest(target.query(h45.rows_sql()))==before_rows,
            'H54_repeat_attempt_changed_group_rows')
    h48.verify(target,b,legacy_data,legacy_cols,legacy_digest,legacy_integrity,
               require,h45,'H54_after_repeat_denial')
    print('H54 PASS: repeat application refused; committed contract unchanged',flush=True)
    print('H54 LIMITATION: isolated SQL only; not real Auth/HTTP/Worker or approved migration',flush=True)
