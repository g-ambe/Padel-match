"""承認済み0045をマージ後に適用する。通常の認証・試合更新は消去しない。"""
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import sys
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('team191_release', HERE / 'cloud_release.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
b, common, require, q = r.b, r.common, r.require, r.q
MAIN = 'a061c6c24710ca465487c12e516c8f909abf978a'
APP_HEAD = '53d4bd811557f1ecd3f833ebcfe6d8aa2381d921'
BRANCH = 'codex/friendly-team-random-rounds'


def authority():
    require(r.hashlib.sha256(r.MIGRATION.read_bytes()).hexdigest() == r.MIGRATION_SHA,
            '0045_reviewed_migration_changed')
    pr = b.api('/pulls/191')
    require(pr['merged'] and pr['merge_commit_sha'] == MAIN and pr['head']['sha'] == APP_HEAD,
            '0045_merged_application_changed')
    require(b.api('/commits/main')['sha'] == MAIN, '0045_main_changed')
    require(b.api('/commits/' + BRANCH)['sha'] == os.environ['BACKUP_SOURCE_SHA'],
            '0045_operations_head_changed')
    require(b.run(['git', 'rev-parse', 'HEAD'], phase='0045_checkout_failed').decode().strip()
            == os.environ['BACKUP_SOURCE_SHA'], '0045_checkout_changed')
    checks = b.api('/commits/' + MAIN + '/check-runs')['check_runs']
    require(any(c['name'] == 'Workers Builds: padel-match' and c['conclusion'] == 'success'
                for c in checks), '0045_application_not_deployed')


def select_backup():
    # 初回リリースと同じ検証を、今回の固定済みマージSHAに対して行う。
    r.MAIN_SHA = MAIN
    r.select_backup()


def capture_rows(tables):
    parts = []
    for t in tables:
        relation = b.ident(t['schema']) + '.' + b.ident(t['name'])
        parts.append('SELECT ' + q(t['schema']) + '::text AS schema,' + q(t['name'])
                     + '::text AS name,' + r.expression(relation) + ' AS value')
    return ('CREATE TEMP TABLE release_0045_live_rows ON COMMIT DROP AS '
            + ' UNION ALL '.join(parts) + ';')


def assert_live_rows(tables):
    parts = []
    for t in tables:
        relation = b.ident(t['schema']) + '.' + b.ident(t['name'])
        parts.append('SELECT 1 FROM release_0045_live_rows WHERE schema=' + q(t['schema'])
                     + ' AND name=' + q(t['name']) + ' AND value IS DISTINCT FROM '
                     + r.expression(relation))
    return ("DO $live$ BEGIN IF EXISTS(" + ' UNION ALL '.join(parts)
            + ") THEN RAISE EXCEPTION '0045_live_rows_changed' USING ERRCODE='40001';"
              ' END IF; END $live$;')


def application_sql(proof):
    tables = proof['manifest']['tables']
    locks = ','.join(b.ident(t['schema']) + '.' + b.ident(t['name'])
                     for t in tables if t['schema'] == 'public')
    return ("BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='5s';"
            + b.SQL_SETTINGS + 'LOCK TABLE ' + locks + ' IN SHARE ROW EXCLUSIVE MODE;'
            + r.guard(proof['before']) + capture_rows(tables) + common.body(r.MIGRATION)
            + r.verify_sql() + r.guard(proof['after']) + assert_live_rows(tables)
            + "SELECT json_build_object('0045_applied',true,'live_existing_rows_unchanged',true,"
              "'catalog_matches_rehearsal',true);COMMIT;")


def prepare():
    authority()
    common.source_sql((HERE / '01_preflight.sql').read_text(), phase='0045_preflight_failed')
    require(r.Production().query("SELECT to_json(to_regclass('public.event_team_rounds') IS NULL)"),
            '0045_already_present_stop_without_reapplication')
    root = b.workdir()
    files, manifest = b.unpack(root)
    require(0 <= (datetime.now(timezone.utc) - datetime.fromisoformat(manifest['captured_at'])).total_seconds()
            <= 7200, '0045_backup_not_recent')
    target = b.start_isolated_database(root)
    restored = b.restore_files(target, files, manifest)
    r.attendance.align_isolated_defaults(target)
    print('::notice title=0045適用前::actual_backup_restore_and_security_PASS', flush=True)
    before = r.probes(target, manifest)
    rows = json.loads((files / 'rows.json').read_text())
    stats = r.statistics_fingerprint(target)
    common.source_sql('BEGIN READ ONLY;' + b.SQL_SETTINGS + r.guard(before) + 'ROLLBACK;',
                      phase='0045_live_catalog_differs_from_restored_backup')
    target.sql('SET ROLE postgres;' + r.MIGRATION.read_text() + r.verify_sql() + r.rows_guard(rows))
    after = r.probes(target, manifest)
    r.old_catalog_unchanged(before, after)
    require(r.statistics_fingerprint(target) == stats, '0045_existing_statistics_changed')
    target.sql('SET ROLE postgres;' + (HERE / '02_verify.sql').read_text())
    target.sql('SET ROLE postgres;' + (HERE / '04_rollback_empty.sql').read_text().replace('ROLLBACK;', 'COMMIT;'))
    target.sql(r.guard(before))
    proof = {'head': os.environ['BACKUP_SOURCE_SHA'], 'main': MAIN, 'migration': r.MIGRATION_SHA,
             'backup': os.environ['BACKUP_SHA256'], 'manifest': manifest,
             'before': before, 'after': after}
    # 新しい保全ガードの必要最小限の実DB試験。既存行には触れない。
    eid = str(uuid.uuid4())
    target.sql("SET ROLE postgres;INSERT INTO public.events(id,name,court_count,event_mode,stats_mode) VALUES("
               + q(eid) + ",'0045適用ガード隔離試験',1,'auto','record_only');")
    # 取得後に正常な追加入力があっても、その最新状態を保持して適用できる。
    result = json.loads(target.sql('SET ROLE postgres;' + application_sql(proof)))
    require(result.get('live_existing_rows_unchanged'), '0045_live_guard_rehearsal_failed')
    # 適用中に行を書き換えた場合は必ず拒否し、その変更自体もROLLBACKする。
    try:
        target.sql('SET ROLE postgres;BEGIN;' + b.SQL_SETTINGS + capture_rows(manifest['tables'])
                   + "UPDATE public.events SET name='拒否される変更' WHERE id=" + q(eid) + ';'
                   + assert_live_rows(manifest['tables']) + 'ROLLBACK;')
    except b.BackupError as error:
        require(str(error).endswith('/40001'), '0045_live_guard_unexpected_test_error')
    else:
        raise b.BackupError('0045_live_guard_failed_to_reject_mutation')
    require(target.query('SELECT to_json(name=' + q('0045適用ガード隔離試験')
                         + ') FROM public.events WHERE id=' + q(eid)), '0045_test_rollback_failed')
    target.sql('SET ROLE postgres;DELETE FROM public.events WHERE id=' + q(eid) + ';'
               + r.rows_guard(rows) + r.guard(after))
    b.json_file(root / 'post-merge-proof.json', proof)
    print('::notice title=0045適用前::migration_existing_rows_stats_security_and_live_guard_PASS', flush=True)
    return dict(restored, migration_rehearsal=True, live_guard_preserves_newer_input=True,
                live_guard_rejects_mutation=True)


def apply():
    require(os.environ.get('PADEL_RELEASE_AUTHORIZED') == 'PR191-0045-POSTMERGE-20261110',
            '0045_postmerge_apply_not_authorized')
    authority()
    proof = json.loads((b.workdir() / 'post-merge-proof.json').read_text())
    require(proof['head'] == os.environ['BACKUP_SOURCE_SHA'] and proof['main'] == MAIN
            and proof['migration'] == r.MIGRATION_SHA and proof['backup'] == os.environ['BACKUP_SHA256'],
            '0045_postmerge_proof_changed')
    result = json.loads(common.source_sql(application_sql(proof), readonly=False,
                                         phase='0045_atomic_apply_failed_or_response_unknown'))
    require(result.get('0045_applied') is True, '0045_commit_not_confirmed')
    # 応答喪失時や以後の確認失敗時に、DDL・データを自動で戻さない。
    common.source_sql('BEGIN READ ONLY;' + b.SQL_SETTINGS + r.verify_sql()
                      + r.guard(proof['after']) + 'ROLLBACK;', phase='0045_postcommit_verification_failed')
    common.source_sql((HERE / '02_verify.sql').read_text(), phase='0045_verify_query_failed')
    authority()
    return dict(result, postcommit_security_and_reference_checks=True)


if __name__ == '__main__':
    try:
        action = sys.argv[1]
        result = {'select-backup': select_backup, 'prepare': prepare, 'apply': apply}[action]()
        print('::notice title=0045マージ後適用::' + json.dumps(result, ensure_ascii=False), flush=True)
    except b.BackupError as error:
        print('::error title=0045安全停止::' + str(error), flush=True)
        sys.exit(1)
    except Exception:
        print('::error title=0045安全停止::unexpected_error_details_withheld', flush=True)
        sys.exit(1)
