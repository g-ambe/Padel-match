"""PR182で明示承認された固定プランだけを、独立復元試験後に適用する。"""
import hashlib
import importlib.util
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import rehearse as r
b, common, ROOT = r.b, r.common, r.ROOT
spec = importlib.util.spec_from_file_location('approved_lineup_release', HERE.parent/'round-lineups/cloud_release.py')
lineup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lineup)
BASE_ATOMIC = r.atomic_release_sql
PLAN = '5861cf7cb995f3b1c294ab70227193ff63c58c23d18b6b1bb921fc17cd7b0cd8'
MARKER = 'PR182固定プラン隔離復元・修復・復旧：成功 '


def approval():
    lineup.require_score_repair_approval()
    value = json.loads((HERE/'approval-plan.json').read_text())
    if (value['plan_sha256'], value['target_matches'], value['candidate_rows'], value['retained_rows'], value['removed_rows']) != (PLAN, 91, 213, 91, 122):
        raise b.BackupError('approved_scope_changed')
    return value


def identity():
    approval()
    if os.environ.get('PADEL_APPROVED_REPAIR') != PLAN:
        raise b.BackupError('approved_execution_not_selected')
    main = lineup.identity()
    pr = b.api('/pulls/182')
    if not pr['draft'] or pr['mergeable'] is False:
        raise b.BackupError('draft_or_mergeability_guard_failed')
    # 必須チェックを回避しない。未対応の保護規則も自動解釈せず停止する。
    rules = b.api('/rules/branches/main')
    if rules or b.api('/branches/main')['protected']:
        raise b.BackupError('branch_protection_requires_explicit_check_evaluation')
    return main


class Source:
    def query(self, sql):
        return json.loads(common.source_sql('BEGIN READ ONLY;SET LOCAL search_path=public;SET LOCAL timezone=\'UTC\';'+sql+';ROLLBACK;'))


def scope(audit, plan):
    totals = audit['totals']
    if (plan['sha256'], audit['repair_plan_sha256'], totals['matches'], totals['rows'], totals['extra_rows'], totals['conflicting']) != (PLAN, PLAN, 91, 213, 122, 0):
        raise b.BackupError('approved_plan_or_counts_changed_no_mutation')
    if audit['incoming_foreign_keys'] or audit['null_match_rows'] or audit['orphan_rows']:
        raise b.BackupError('result_references_or_integrity_require_review')


def preflight(value):
    if any(lineup.fingerprints(value)[k] != lineup.reviewed()['catalog'][k] for k in lineup.SECTIONS):
        raise b.BackupError('production_catalog_changed')
    if not value['0040_present'] or value['0041_present'] or value['0042_present'] or any(value[k] for k in lineup.INVALID if k != 'duplicate_results'):
        raise b.BackupError('production_preflight_requires_review')


def worker(main):
    checks = b.api('/commits/'+main+'/check-runs?per_page=100')['check_runs']
    latest = next((c for c in checks if c['name'] == 'Workers Builds: padel-match'), None)
    version = re.search(r'(?:Version ID|VersionID|Version Id|VersionId)\s*[:：]?\s*`?([0-9a-f-]{36})', latest['output']['summary'] or '', re.I) if latest else None
    if not latest or latest['conclusion'] != 'success' or not version:
        raise b.BackupError('current_production_worker_not_identified')
    return version.group(1)


def prepare():
    main = identity()
    baseline_worker = worker(main)
    source = Source()
    audit, plan = r.audit_local(source), source.query(r.plan_query())
    scope(audit, plan)
    if r.references(source.query, plan):
        raise b.BackupError('deleted_ids_referenced_no_mutation')
    preflight(source.query(lineup.query()))
    b.passphrase()
    root = b.workdir(); root.mkdir(mode=0o700, exist_ok=False)
    prefix, env = common.source()
    with b.Snapshot(prefix, env) as snapshot:
        current = snapshot.query(lineup.query())
        preflight(current)
        latest_plan = snapshot.query(r.plan_query())
        scope(snapshot.query(common.body(HERE/'01_audit.sql')), latest_plan)
        info = b.collect(snapshot, root)
        statistics = r.dump_stats(snapshot, root/'statistics-before.json')
    if identity() != main:
        raise b.BackupError('main_changed_during_backup')
    ctx = {'source_sha':os.environ['BACKUP_SOURCE_SHA'], 'main_before_sha':main,
           'worker_before':baseline_worker, 'sql_sha256':approval()['sql_sha256'],
           'plan':latest_plan, 'batch_id':str(uuid.uuid4()), 'statistics':statistics,
           'preflight':{k:v for k,v in current.items() if k not in ('captured_at','version')}}
    info['approved_repair'] = ctx
    (root/'files/manifest.json').write_text(json.dumps(info, ensure_ascii=False, sort_keys=True, separators=(',',':')))
    return dict(b.seal(root, info), approved_plan_matches=True, worker_before=baseline_worker, main_before=main)


def context(manifest):
    ctx = manifest.get('approved_repair', {})
    if ctx.get('source_sha') != os.environ['BACKUP_SOURCE_SHA'] or ctx.get('sql_sha256') != approval()['sql_sha256'] or ctx.get('plan',{}).get('sha256') != PLAN:
        raise b.BackupError('approved_backup_context_invalid')
    uuid.UUID(ctx['batch_id'])
    age=(datetime.now(timezone.utc)-datetime.fromisoformat(manifest['captured_at'])).total_seconds()
    if age<0 or age>3*60*60:
        raise b.BackupError('fresh_backup_window_expired')
    return ctx


def verification_sql():
    # 既存03の権限・トリガー検査をそのまま実行。旧同一DB内コピーとの比較は、
    # 今回の外部バックアップ全既存表ハッシュ照合に置き換える。
    text = common.body(HERE.parent/'round-lineups/03_verify.sql')
    end = text.index('end$$;') + len('end$$;')
    return text[:end] + common.body(HERE/'04_verify.sql')


def application_sql(manifest, rows, batch, plan):
    ctx = context(manifest)
    if plan != ctx['plan']:
        raise b.BackupError('isolated_plan_differs_from_approved_backup')
    tables = [t for t in manifest['tables'] if t['schema']=='public']
    preserved = [t for t in tables if t['name']!='match_results']
    # 全public表を先にロック。参照検査・バックアップ照合からCOMMITまで書込みを排他。
    locks = ','.join('public.'+b.ident(t['name']) for t in sorted(tables,key=lambda x:x['name']))
    prefix = "SET LOCAL search_path=public;SET LOCAL timezone='UTC';SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SET LOCAL idle_in_transaction_session_timeout='180s';LOCK TABLE "+locks+' IN SHARE ROW EXCLUSIVE MODE;'
    prefix += lineup.metadata_guard(ctx['preflight']) + common.assert_rows([t for t in rows if t['schema']=='public'])
    prefix += common.current_rows_sql(preserved)
    suffix = verification_sql()+common.assert_unchanged_sql(preserved)
    suffix += "DO $$BEGIN IF (SELECT editing_enabled FROM lineup_private.release_control) IS NOT FALSE OR EXISTS(SELECT 1 FROM public.friendly_match_operations) OR EXISTS(SELECT 1 FROM public.friendly_round_lineup_state) THEN RAISE EXCEPTION '追加表の初期状態が異なります';END IF;END$$;"
    return 'BEGIN;'+prefix+BASE_ATOMIC(batch,plan)[len('BEGIN;'):-len('COMMIT;')]+suffix+'COMMIT;'


def proof(ctx):
    return {'source_sha':ctx['source_sha'], 'plan_sha256':PLAN, 'backup_sha256':os.environ['BACKUP_SHA256'], 'sql_sha256':ctx['sql_sha256']}


def rehearse():
    identity()
    if os.environ.get('SUPABASE_DB_URL'):
        raise b.BackupError('production_connection_forbidden_in_restore')
    root = b.workdir()
    # 既存の本番接続を持たない隔離専用試験を、今回取得した実ファイルに固定して再利用。
    r.BACKUP_RELEASE=int(os.environ['BACKUP_RELEASE_ID']);r.BACKUP_ASSET=int(os.environ['BACKUP_ASSET_ID']);r.BACKUP_SHA=os.environ['BACKUP_SHA256']
    os.environ['PADEL_REPAIR_REVIEW']='PR182-APPROVAL-PENDING'
    captured={}
    def build(batch,plan):
        manifest=json.loads((root/'files/manifest.json').read_text())
        rows=json.loads((root/'files/rows.json').read_text())
        captured.update(context(manifest))
        return application_sql(manifest,rows,batch,plan)
    r.atomic_release_sql=build
    result=r.rehearse()
    if result['plan_sha256']!=PLAN or not result['atomic_repair_and_migrations_verified'] or not result['recovery_verified']:
        raise b.BackupError('fresh_rehearsal_incomplete')
    release=b.api('/releases/'+os.environ['BACKUP_RELEASE_ID'])
    if not release['draft']:raise b.BackupError('backup_must_remain_private')
    b.api('/releases/'+str(release['id']),'PATCH',{'draft':True,'body':release['body']+'\n\n'+MARKER+json.dumps(proof(captured),sort_keys=True)})
    return {'fresh_backup_restore_repair_recovery_verified':True,'plan_sha256':PLAN,'backup_release_id':release['id'],'statistics_unchanged':True}


def apply():
    main=identity()
    root=b.workdir(); files,manifest=b.unpack(root);ctx=context(manifest)
    release=b.api('/releases/'+os.environ['BACKUP_RELEASE_ID'])
    expected=MARKER+json.dumps(proof(ctx),sort_keys=True)
    if main!=ctx['main_before_sha'] or not release['draft'] or expected not in release['body']:
        raise b.BackupError('independent_fresh_restore_or_identity_not_verified')
    if worker(main)!=ctx['worker_before']:
        raise b.BackupError('production_worker_changed_since_backup')
    source=Source(); audit=r.audit_local(source);plan=source.query(r.plan_query());scope(audit,plan)
    preflight(source.query(lineup.query()))
    if r.references(source.query,plan):raise b.BackupError('deleted_ids_referenced_no_mutation')
    rows=json.loads((files/'rows.json').read_text())
    common.source_sql(application_sql(manifest,rows,ctx['batch_id'],plan),readonly=False,phase='approved_atomic_commit_failed_or_unknown_stop_do_not_retry')
    common.source_sql('BEGIN READ ONLY;SET LOCAL search_path=public;'+verification_sql()+'ROLLBACK;',phase='approved_post_verify_failed')
    if r.dump_stats(source,root/'statistics-post.json')!=ctx['statistics']:
        raise b.BackupError('post_commit_statistics_changed_stop_release')
    summary=source.query("SELECT jsonb_build_object('kept',count(*) filter(where s.id=s.keeper_id),'archived',count(*),'removed',max(a.removed_rows)) FROM score_repair_182.rows s JOIN score_repair_182.batches a ON a.id=s.batch_id WHERE a.id="+b.literal(ctx['batch_id'])+'::uuid AND a.restored_at IS NULL')
    if summary!={'kept':91,'archived':213,'removed':122}:raise b.BackupError('post_commit_audit_mismatch')
    b.api('/releases/'+str(release['id']),'PATCH',{'draft':True,'body':release['body']+'\n\n本番固定プラン修復・0041・0042・0043：成功（入替無効、戦績不変）'})
    return dict(summary,duplicate_matches=0,statistics_unchanged=True,editing_enabled=False,backup_release_id=release['id'])


def select_backup():
    identity()
    releases=b.api('/releases?per_page=100')
    matching=[v for v in releases if v['draft'] and v['target_commitish']==os.environ['BACKUP_SOURCE_SHA'] and MARKER in v['body']]
    if len(matching)!=1:raise b.BackupError('one_successful_fresh_backup_required')
    release=matching[0]
    record=json.loads(release['body'].split(MARKER)[1].splitlines()[0])
    if record['plan_sha256']!=PLAN or record['sql_sha256']!=approval()['sql_sha256']:
        raise b.BackupError('stored_proof_scope_changed')
    assets=[a for a in release['assets'] if a['name']=='backup.tar.gpg']
    if len(assets)!=1:raise b.BackupError('backup_asset_identity_invalid')
    with open(os.environ['GITHUB_OUTPUT'],'a') as output:
        for k,v in {'release_id':release['id'],'asset_id':assets[0]['id'],'sha256':record['backup_sha256']}.items():output.write(str(k)+'='+str(v)+'\n')
    return {'verified_backup_selected':True,'release_id':release['id']}


def main():
    os.umask(0o077)
    try:
        action=sys.argv[1] if len(sys.argv)==2 else ''
        if action not in ('prepare','rehearse','apply','select_backup'):raise b.BackupError('unknown_approved_action')
        result=globals()[action]()
        print('::notice title=PR182承認済み固定プラン::'+json.dumps(result,ensure_ascii=False),flush=True)
    except (b.BackupError,b.probe.ProbeError) as e:
        print('::error title=PR182承認済み固定プラン::'+str(e));return 1
    except Exception:
        print('::error title=PR182承認済み固定プラン::unexpected_private_failure_stop');return 1
    return 0


if __name__=='__main__':raise SystemExit(main())
