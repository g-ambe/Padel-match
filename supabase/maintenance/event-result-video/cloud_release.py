"""PR202だけの0047リリース。既存のバックアップ・接続・復元ガードを再利用する。"""
import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / 'event-fixed-pairs'))
import cloud_backup as b


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


c = module('video202_connection', HERE.parent / 'event-fixed-pairs/cloud_release.py')
a = module('video202_catalog', HERE.parent / 'team-attendance/cloud_release.py')
require = a.require
q = b.literal
MIGRATION = ROOT / 'supabase/migrations/0047_event_result_video.sql'
SHA = 'ca3c45b8dac31499b9e35a5914b5c695e027602ffd2725a80fc44434b7acfa79'
MAIN = '76de7a54043ade3c8e7351e5c3f1e874265b6b4e'
RPC = 'save_friendly_team_match_video'
HISTORY = 'supabase_migrations.schema_migrations'


class Production:
    def query(self, sql):
        return json.loads(c.source_sql('BEGIN READ ONLY;' + b.SQL_SETTINGS + sql + ';ROLLBACK;'))

    def sql(self, sql):
        return c.source_sql(sql, readonly=False, phase='0047_write_failed_or_response_unknown_preserve_database')


def authority():
    require(hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == SHA, '0047_reviewed_sql_changed')
    pr = b.api('/pulls/202')
    require(pr['state'] == 'open' and not pr['merged'] and pr['head']['repo']['full_name'] == b.REPOSITORY
            and pr['head']['ref'] == 'codex/event-results-ui'
            and pr['head']['sha'] == os.environ['BACKUP_SOURCE_SHA'], '0047_pr_head_changed')
    require(b.api('/commits/main')['sha'] == MAIN, '0047_main_changed')
    checks = b.api('/commits/' + pr['head']['sha'] + '/check-runs')['check_runs']
    # 自分自身の実行中jobと既存の非必須stagingは除く。保護ルールはGitHubの通常マージでも検証する。
    require(not any(v['status'] == 'completed' and v['conclusion'] not in ('success', 'neutral', 'skipped')
                    and v['name'] != 'Workers Builds: padel-match-staging' for v in checks), '0047_github_check_failed')
    statuses = b.api('/commits/' + pr['head']['sha'] + '/status')['statuses']
    require(not any(v['state'] in ('failure', 'error') and 'padel-match-staging' not in v['context'] for v in statuses), '0047_github_status_failed')


def select_backup():
    run_id = os.environ['BACKUP_RUN_ID']
    require(run_id.isdigit(), '0047_backup_run_invalid')
    run = b.api('/actions/runs/' + run_id)
    require(run['conclusion'] == 'success' and run['head_sha'] == MAIN and run['run_attempt'] == 1
            and run['path'] == '.github/workflows/cloud-db-backup.yml', '0047_actual_backup_restore_not_successful')
    release = b.api('/releases/' + str(int(os.environ['BACKUP_RELEASE_ID'])))
    require(release['draft'] and release['name'].endswith(' ' + run_id)
            and '復元確認：成功' in release['body'], '0047_verified_private_backup_missing')
    record = json.loads(release['body'].split('\n\n')[-1])
    require(bool(re.fullmatch('[0-9a-f]{64}', record['sha256'])) and record['sha256'] == os.environ['BACKUP_SHA256'], '0047_backup_hash_changed')
    require(sum(v['name'] == 'backup.tar.gpg' and v['id'] == int(os.environ['BACKUP_ASSET_ID']) for v in release['assets']) == 1, '0047_backup_asset_changed')


def history(target):
    present = target.query('SELECT to_json(to_regclass(' + q(HISTORY) + ') IS NOT NULL)')
    if not present:
        return False  # 既存のActions適用記録方式を維持し、履歴テーブルを新設しない。
    columns = target.query("SELECT json_object_agg(column_name,data_type) FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'")
    require(columns.get('version') == 'text' and columns.get('name') == 'text'
            and columns.get('statements') == 'ARRAY', '0047_migration_history_structure_differs')
    require(target.query("SELECT to_json(NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0047' OR name='event_result_video'))"), '0047_history_already_recorded')
    return True


def history_insert(enabled):
    if not enabled:
        return ''
    return "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('0047','event_result_video',ARRAY[" + q(c.body(MIGRATION)) + ']::text[]);'


def probes(target, manifest):
    values = []
    def capture(sql):
        value = target.query(sql)
        values.append({'sql': sql, 'value': copy.deepcopy(value)})
        return value
    b.catalog(capture, manifest['tables'], manifest['function_schemas'])
    capture(b.ROLE_METADATA)
    capture(a.DEFAULT_ACL)
    return values


def guard(values):
    return a.catalog_guard(values).replace('0044_catalog_changed', '0047_catalog_changed')


def old_catalog_unchanged(before, after):
    normalized = copy.deepcopy(after)
    for v in normalized:
        if isinstance(v['value'], list):
            v['value'] = [f for f in v['value'] if not (isinstance(f, dict) and 'arguments' in f and f.get('name') == RPC)]
    require(before == normalized, '0047_existing_rls_grant_or_catalog_changed')


def rows_guard(rows, recorded=False):
    parts = []
    for r in rows:
        relation = b.ident(r['schema']) + '.' + b.ident(r['name'])
        expression = c.row_expression(relation)
        if recorded and r['schema'] + '.' + r['name'] == HISTORY:
            expression = expression.replace('FROM ' + relation + ' t)', 'FROM ' + relation + " t WHERE t.version<>'0047')")
        expected = q(json.dumps({'rows': r['rows'], 'sha256': r['sha256']})) + '::jsonb'
        parts.append('IF ' + expression + ' IS DISTINCT FROM ' + expected + " THEN RAISE EXCEPTION '0047_existing_data_changed' USING ERRCODE='40001'; END IF;")
    return 'DO $rows$ BEGIN ' + ''.join(parts) + ' END $rows$;'


def verify(recorded):
    sql = (HERE / '02_verify.sql').read_text()
    if recorded:
        sql += "DO $history$ BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0047' AND name='event_result_video' AND statements=ARRAY[" + q(c.body(MIGRATION)) + "]::text[]) THEN RAISE EXCEPTION '0047_history_differs'; END IF; END $history$;"
    return sql


def preflight():
    authority()
    c.source_sql('BEGIN READ ONLY;' + b.SQL_SETTINGS + (HERE / '01_preflight.sql').read_text() + 'ROLLBACK;')
    enabled = history(Production())
    print('PASS: readonly_target_prerequisites_and_absent_RPC; history=' + ('existing_supabase_table' if enabled else 'existing_Actions_receipt'), flush=True)


def smoke(target):
    # 内部例外によるサブトランザクションROLLBACKに加え、外側もROLLBACK。実開催には書かない。
    target.sql("BEGIN;SET LOCAL lock_timeout='5s';" + b.SQL_SETTINGS + (HERE / '03_smoke.sql').read_text() + 'ROLLBACK;')
    print('PASS: dedicated_event_manual_auto_active_closed_video_CRUD_retry_stale_unauthorized_shared_readonly_and_score_lineup_unchanged; all_test_writes_rolled_back', flush=True)


def concurrent_video(target):
    require(isinstance(target, b.LocalRestore), '0047_concurrency_requires_isolated_database')
    actor = target.query("SELECT to_json(coalesce(pp.linked_auth_user_id,cm.profile_id)) FROM public.club_members cm LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id WHERE cm.is_active AND cm.role IN ('main_admin','sub_admin') AND coalesce(pp.linked_auth_user_id,cm.profile_id) IS NOT NULL ORDER BY cm.id LIMIT 1")
    require(bool(actor), '0047_concurrency_actor_missing')
    eid, mid = str(uuid.uuid4()), str(uuid.uuid4())
    target.sql('SET ROLE postgres;BEGIN;INSERT INTO public.events(id,name,court_count,event_mode,stats_mode,created_by_auth_user_id) VALUES('
               + q(eid) + ",'PR202隔離並列動画検証',1,'team','record_only'," + q(actor) + ');'
               + 'INSERT INTO public.event_team_matches(id,event_id,match_order,result) VALUES(' + q(mid) + ',' + q(eid)
               + ",1,'undecided');UPDATE public.events SET status='closed' WHERE id=" + q(eid) + ';COMMIT;')
    def update(n):
        sql = "BEGIN;SET LOCAL lock_timeout='10s';SET LOCAL request.jwt.claim.sub=" + q(actor)
        sql += ';SET LOCAL request.jwt.claims=' + q(json.dumps({'sub': actor, 'role': 'authenticated'})) + ';SET LOCAL ROLE authenticated;'
        sql += 'SELECT public.' + RPC + '(' + q(eid) + ',' + q(mid) + ',' + q('https://youtu.be/concurrent' + str(n)) + ',NULL);COMMIT;'
        try:
            target.sql(sql)
            return 'saved'
        except b.BackupError as error:
            require(str(error).endswith('/P0001'), '0047_unexpected_concurrent_error')
            return 'stale_rejected'
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = sorted(pool.map(update, [1, 2]))
        require(outcomes == ['saved', 'stale_rejected'], '0047_concurrent_update_not_serialized')
        require(target.query('SELECT to_json(count(*)=1) FROM public.event_team_matches WHERE event_id=' + q(eid)), '0047_concurrent_duplicate')
    finally:
        target.sql('SET ROLE postgres;DELETE FROM public.events WHERE id=' + q(eid) + " AND name='PR202隔離並列動画検証' AND stats_mode='record_only';")
    print('PASS: real_PostgreSQL_two_connections_one_save_one_stale_rejection', flush=True)


def rehearse():
    authority()
    select_backup()
    root = b.workdir()
    files, manifest = b.unpack(root)
    require(0 <= (datetime.now(timezone.utc) - datetime.fromisoformat(manifest['captured_at'])).total_seconds() < 14400, '0047_backup_not_recent')
    target = b.start_isolated_database(root)
    b.restore_files(target, files, manifest)
    a.align_isolated_defaults(target)
    print('PASS: actual_encrypted_file_isolated_restore_data_roles_catalog_foreign_keys', flush=True)
    target.sql('SET ROLE postgres;' + (HERE / '01_preflight.sql').read_text())
    recorded = history(target)
    before = probes(target, manifest)
    c.source_sql('BEGIN READ ONLY;' + b.SQL_SETTINGS + guard(before) + 'ROLLBACK;', phase='0047_restored_and_latest_production_catalog_differ')
    require(history(Production()) == recorded, '0047_history_mode_changed')
    rows = json.loads((files / 'rows.json').read_text())
    target.sql('SET ROLE postgres;BEGIN;' + b.SQL_SETTINGS + c.body(MIGRATION) + history_insert(recorded) + verify(recorded) + rows_guard(rows, recorded) + 'COMMIT;')
    after = probes(target, manifest)
    old_catalog_unchanged(before, after)
    smoke(target)
    concurrent_video(target)
    target.sql('SET ROLE postgres;' + rows_guard(rows, recorded))
    # 復旧は隔離DB限定。既存データを戻さず、追加したRPCと履歴だけを取り消して再適用。
    rollback = 'DROP FUNCTION public.' + RPC + '(uuid,uuid,text,text);'
    if recorded:
        rollback += "DELETE FROM supabase_migrations.schema_migrations WHERE version='0047' AND name='event_result_video';"
    target.sql('SET ROLE postgres;BEGIN;' + rollback + guard(before) + rows_guard(rows) + 'COMMIT;')
    target.sql('SET ROLE postgres;BEGIN;' + b.SQL_SETTINGS + c.body(MIGRATION) + history_insert(recorded) + verify(recorded) + guard(after) + rows_guard(rows, recorded) + 'COMMIT;')
    b.json_file(root / 'video202-proof.json', {'head': os.environ['BACKUP_SOURCE_SHA'], 'main': MAIN,
        'migration': SHA, 'backup': os.environ['BACKUP_SHA256'], 'manifest': manifest,
        'before': before, 'after': after, 'rows': rows, 'recorded': recorded})
    print('PASS: 0047_rehearsal_existing_data_RLS_GRANT_unchanged_and_isolated_rollback_reapply', flush=True)


def apply():
    require(os.environ.get('PADEL_RELEASE_AUTHORIZED') == 'PR202-0047-20261113', '0047_production_not_authorized')
    authority()
    select_backup()
    proof = json.loads((b.workdir() / 'video202-proof.json').read_text())
    require(proof['head'] == os.environ['BACKUP_SOURCE_SHA'] and proof['main'] == MAIN
            and proof['migration'] == SHA and proof['backup'] == os.environ['BACKUP_SHA256'], '0047_rehearsal_proof_changed')
    require(history(Production()) == proof['recorded'], '0047_history_changed_since_rehearsal')
    tables = [t for t in proof['manifest']['tables'] if t['schema'] == 'public' or t['schema'] + '.' + t['name'] == HISTORY]
    locks = ','.join(b.ident(t['schema']) + '.' + b.ident(t['name']) for t in tables)
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='5s';" + b.SQL_SETTINGS
    sql += 'SET LOCAL ROLE postgres;LOCK TABLE ' + locks + ' IN SHARE ROW EXCLUSIVE MODE;SELECT pg_advisory_xact_lock(2020047);'
    # 最新データ・カタログがバックアップ／隔離検証時と違えばDDLの前に全体停止。
    sql += guard(proof['before']) + rows_guard(proof['rows']) + (HERE / '01_preflight.sql').read_text()
    sql += c.body(MIGRATION) + history_insert(proof['recorded']) + verify(proof['recorded'])
    sql += guard(proof['after']) + rows_guard(proof['rows'], proof['recorded'])
    sql += "SELECT json_build_object('0047_applied',true,'data_security_match_rehearsal',true);COMMIT;"
    result = json.loads(c.source_sql(sql, readonly=False, phase='0047_atomic_apply_failed_or_response_unknown_stop'))
    # 応答喪失時はここに到達しない。自動再適用・本番ロールバックを行わない。
    post = verify(proof['recorded']) + guard(proof['after']) + rows_guard(proof['rows'], proof['recorded'])
    c.source_sql('BEGIN READ ONLY;' + b.SQL_SETTINGS + post + 'ROLLBACK;', phase='0047_postcommit_verification_failed_stop')
    smoke(Production())
    c.source_sql('BEGIN READ ONLY;' + b.SQL_SETTINGS + post + 'ROLLBACK;', phase='0047_post_smoke_verification_failed_stop')
    authority()
    print('PASS: production_' + json.dumps(result) + '_postcommit_catalog_rows_and_dedicated_smoke', flush=True)


if __name__ == '__main__':
    try:
        actions = {'preflight': preflight, 'select-backup': select_backup, 'rehearse': rehearse, 'apply': apply}
        actions[sys.argv[1]]()
    except b.BackupError as error:
        print('::error title=PR202安全停止::' + str(error), flush=True)
        sys.exit(1)
    except Exception:
        print('::error title=PR202安全停止::unexpected_release_error_details_withheld', flush=True)
        sys.exit(1)
