"""PR #176で承認された0040だけを、外部バックアップ・隔離試験後に適用する。"""

import hashlib
import json
import os
import re
import sys
from pathlib import Path

import cloud_backup as b

REPO = Path(__file__).resolve().parents[3]
SQL_ROOT = Path(__file__).parent
MIGRATION = REPO / 'supabase/migrations/0040_event_fixed_pairs.sql'
MIGRATION_SHA = 'af4c9e14db4db2cf12277a17dfbe086e620d1c877554f04e1a3e5b01a40744df'
CORE = ('events', 'event_participants', 'rounds', 'matches', 'match_players', 'match_results')
APP = CORE + ('clubs', 'club_members', 'player_profiles', 'profiles', 'app_admins')
NEW_TABLES = ('event_fixed_pair_state', 'event_fixed_pairs', 'event_fixed_pair_rounds')
RPCS = ('get_event_fixed_pair_state', 'replace_event_fixed_pairs', 'create_fixed_pair_round', 'finish_fixed_pair_event')


def body(path):
    text = Path(path).read_text()
    text, start = re.subn(r'(?im)^begin(?: isolation level repeatable read| read only)?;\s*', '', text, count=1)
    text, end = re.subn(r'(?im)^(?:commit|rollback);\s*$', '', text, count=1)
    if start != 1 or end != 1:
        raise b.BackupError('release_sql_transaction_boundary_changed')
    return text


def schema_name():
    run_id = os.environ.get('GITHUB_RUN_ID', '')
    attempt = os.environ.get('GITHUB_RUN_ATTEMPT', '1')
    if not run_id.isdigit() or not attempt.isdigit():
        raise b.BackupError('release_run_identity_invalid')
    return 'event_fixed_pair_backup_r' + run_id + '_a' + attempt


def authority():
    if os.environ.get('PADEL_RELEASE_AUTHORIZED') != 'PR176-0040-20261105':
        raise b.BackupError('release_authorization_not_selected')
    if hashlib.sha256(MIGRATION.read_bytes()).hexdigest() != MIGRATION_SHA:
        raise b.BackupError('reviewed_migration_hash_changed')


def source(readonly=True):
    ca = b.probe.custom_ca_file()
    if not ca:
        raise b.BackupError('official_ca_required')
    env = b.clean_env()
    env.update(b.probe.connection_environment(os.environ.get('SUPABASE_DB_URL', '')))
    env['PGSSLROOTCERT'] = '/run/padel-supabase-ca.crt'
    env['PGOPTIONS'] = '-c default_transaction_read_only=' + ('on' if readonly else 'off')
    return b.source_prefix(ca), env


def source_sql(sql, *, readonly=True, phase='release_source_sql_failed'):
    prefix, env = source(readonly)
    # SQLはstdinだけで渡す。gexecで一括送信し、長時間の往復通信中にロックを保持しない。
    request = 'SELECT ' + b.literal(sql) + ' \\gexec\n'
    return b.run(prefix + b.PSQL, phase=phase, env=env, data=request.encode(), timeout=180)


def fingerprints(snapshot):
    code = "const fs=require('node:fs');const {metadataFingerprints}=require('./tests/fixtures/fixed-pair-metadata.cjs');process.stdout.write(JSON.stringify(metadataFingerprints(JSON.parse(fs.readFileSync(0,'utf8')))));"
    return json.loads(b.run(['node', '-e', code], phase='preflight_fingerprint_failed', data=json.dumps(snapshot).encode(), env=b.clean_env(), cwd=REPO))


def check_preflight(snapshot):
    expected = json.loads((REPO / 'tests/fixtures/fixed-pair-production-metadata.json').read_text())
    actual = fingerprints(snapshot)
    summary = {'new_schema_present': snapshot['new_schema_present'], 'changed_sections': [key for key in actual if actual[key] != expected['sha256'][key]], 'counts': {key: len(snapshot[key]) for key in actual}, 'sha256': actual}
    print('::notice title=最新DB定義照合::' + json.dumps(summary, ensure_ascii=False), flush=True)
    if snapshot['new_schema_present'] or actual != expected['sha256']:
        raise b.BackupError('latest_production_metadata_differs_from_review')


def preflight_query():
    return body(SQL_ROOT / '01_preflight.sql')


def row_expression(relation):
    return "(SELECT jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE \"C\"),''),'UTF8')),'hex')) FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM " + relation + " t) row_values)"


def assert_rows(rows):
    statements = []
    for row in rows:
        relation = b.ident(row['schema']) + '.' + b.ident(row['name'])
        expected = {'rows': row['rows'], 'sha256': row['sha256']}
        statements.append('IF ' + row_expression(relation) + ' IS DISTINCT FROM ' + b.literal(json.dumps(expected)) + "::jsonb THEN RAISE EXCEPTION 'バックアップ後に対象データが変化しました。適用を中止します' USING ERRCODE='40001'; END IF;")
    return 'DO $row_guard$ BEGIN ' + ''.join(statements) + ' END $row_guard$;'


def current_rows_sql(tables):
    parts = []
    for table in tables:
        relation = b.ident(table['schema']) + '.' + b.ident(table['name'])
        parts.append('SELECT ' + b.literal(table['schema']) + '::text AS schema,' + b.literal(table['name']) + '::text AS name,' + row_expression(relation) + ' AS value')
    return 'CREATE TEMP TABLE release_rows_before ON COMMIT DROP AS ' + ' UNION ALL '.join(parts) + ';'


def assert_unchanged_sql(tables):
    parts = []
    for table in tables:
        relation = b.ident(table['schema']) + '.' + b.ident(table['name'])
        parts.append('SELECT 1 FROM release_rows_before WHERE schema=' + b.literal(table['schema']) + ' AND name=' + b.literal(table['name']) + ' AND value IS DISTINCT FROM ' + row_expression(relation))
    return "DO $unchanged$ BEGIN IF EXISTS(" + ' UNION ALL '.join(parts) + ") THEN RAISE EXCEPTION '既存の行データが変更されました。全体を中止します'; END IF; END $unchanged$;"


def assert_post_sql(backup_schema):
    return """
DO $post$ BEGIN
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('event_fixed_pair_state','event_fixed_pairs','event_fixed_pair_rounds') AND c.relrowsecurity
 AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') AND NOT has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE') AND has_table_privilege('authenticated',c.oid,'SELECT'))<>3
 THEN RAISE EXCEPTION '追加表のRLS・権限が想定外です'; END IF;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_event_fixed_pair_state','replace_event_fixed_pairs','create_fixed_pair_round','finish_fixed_pair_event') AND p.prosecdef
 AND (p.proconfig @> ARRAY['search_path=""'] OR p.proconfig @> ARRAY['search_path=']) AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('service_role',p.oid,'EXECUTE') AND has_function_privilege('authenticated',p.oid,'EXECUTE'))<>4
 THEN RAISE EXCEPTION '追加RPCの権限・定義が想定外です'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_fixed_pairs) OR EXISTS(SELECT 1 FROM public.event_fixed_pair_state) OR EXISTS(SELECT 1 FROM public.event_fixed_pair_rounds)
 THEN RAISE EXCEPTION '追加表の初期状態が想定外です'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('fixed_pair_event_finish','fixed_pair_round_create','fixed_pair_match_create','fixed_pair_lineup') AND tgenabled='O')<>4
 THEN RAISE EXCEPTION '追加ガードが想定外です'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.fixed_pair_participant_event_id'::regclass AND indisvalid AND indisunique)
 THEN RAISE EXCEPTION '参照インデックスが無効です'; END IF;
END $post$;
""" + metadata_guard_sql(backup_schema)


def metadata_guard_sql(backup_schema):
    verify = body(SQL_ROOT / '03_verify.sql').replace('event_fixed_pair_backup_20261102', backup_schema)
    # 03の最初のSELECTを例外を発生させる検査に変える。元SQLファイルは変更しない。
    first = verify.split('-- 3表とも', 1)[0]
    first = first[first.index('with current_metadata'):].strip().rstrip(';')
    return "DO $metadata$ BEGIN IF EXISTS(" + first + ") THEN RAISE EXCEPTION '既存のRLS・ACL・保護トリガーが変化しました'; END IF; END $metadata$;"


def application_rows(rows):
    return [r for r in rows if r['schema'] == 'public' and r['name'] in APP]


def application_sql(manifest, rows):
    context = manifest['release']
    tables = manifest['tables']
    locks = ','.join('public.' + b.ident(name) for name in APP)
    # 対象11表だけを短時間ロックしてからMVCCの基準点を取る。認証の裏処理は止めない。
    # 全既存表は同じトランザクションで前後照合し、自分のDDLによる行変更があればROLLBACKする。
    return ("BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'; SET LOCAL idle_in_transaction_session_timeout='180s';"
            + b.SQL_SETTINGS + "SET LOCAL search_path=public; LOCK TABLE " + locks + ' IN SHARE ROW EXCLUSIVE MODE; SELECT pg_advisory_xact_lock(1760040);'
            + assert_rows(application_rows(rows)) + current_rows_sql(tables) + metadata_guard_sql(context['backup_schema'])
            + body(MIGRATION) + assert_post_sql(context['backup_schema']) + assert_unchanged_sql(tables)
            + "SELECT json_build_object('migration_applied',true,'original_rows_unchanged',true,'new_tables_empty',true,'existing_permissions_unchanged',true);COMMIT;")


def prepare():
    authority()
    b.passphrase()
    root = b.workdir()
    root.mkdir(mode=0o700, exist_ok=False)
    before = json.loads(source_sql('BEGIN READ ONLY;' + preflight_query() + 'ROLLBACK;'))
    check_preflight(before)
    backup_schema = schema_name()
    backup = body(SQL_ROOT / '02_backup.sql').replace('event_fixed_pair_backup_20261102', backup_schema)
    source_sql('BEGIN ISOLATION LEVEL REPEATABLE READ;' + backup + 'COMMIT;', readonly=False, phase='approved_internal_backup_failed')
    prefix, env = source()
    with b.Snapshot(prefix, env) as snapshot:
        check_preflight(snapshot.query(preflight_query()))
        info = b.collect(snapshot, root)
    rows = json.loads((root / 'files/rows.json').read_text())
    for name in CORE:
        original = next(r for r in rows if r['schema'] == 'public' and r['name'] == name)
        copied = next(r for r in rows if r['schema'] == backup_schema and r['name'] == name)
        if (original['rows'], original['sha256']) != (copied['rows'], copied['sha256']):
            raise b.BackupError('data_changed_between_internal_and_external_backups')
    info['release'] = {'backup_schema': backup_schema, 'migration_sha256': MIGRATION_SHA, 'preflight_sha256': fingerprints(before), 'source_sha': os.environ['BACKUP_SOURCE_SHA'], 'main_before_sha': os.environ['BACKUP_MAIN_SHA']}
    (root / 'files/manifest.json').write_text(json.dumps(info, ensure_ascii=False, sort_keys=True, separators=(',', ':')))
    result = b.seal(root, info)
    return dict(result, internal_backup_created=True, latest_preflight_matches=True)


def context_check(manifest):
    authority()
    ctx = manifest.get('release', {})
    if ctx.get('migration_sha256') != MIGRATION_SHA or not re.fullmatch(r'event_fixed_pair_backup_r\d+_a\d+', ctx.get('backup_schema', '')):
        raise b.BackupError('release_backup_context_invalid')
    if ctx.get('source_sha') != os.environ.get('BACKUP_SOURCE_SHA'):
        raise b.BackupError('release_commit_differs_from_backup')


def rehearse():
    root = b.workdir()
    files, manifest = b.unpack(root)
    context_check(manifest)
    target = b.start_isolated_database(root)
    result = b.restore_files(target, files, manifest)
    b.json_file(root / 'verification.json', result)
    rows = json.loads((files / 'rows.json').read_text())
    target.sql('SET ROLE postgres;' + application_sql(manifest, rows) + 'RESET ROLE;')
    target.sql('SET ROLE postgres;' + (SQL_ROOT / '03_verify.sql').read_text().replace('event_fixed_pair_backup_20261102', manifest['release']['backup_schema']) + 'RESET ROLE;')
    b.json_file(root / 'migration-rehearsal.json', {'migration_rehearsal_verified': True, 'migration_sha256': MIGRATION_SHA})
    return dict(result, migration_rehearsal_verified=True)


def mark():
    result = b.mark()
    root = b.workdir()
    release_id = int(os.environ['BACKUP_RELEASE_ID'])
    release = b.api('/releases/' + str(release_id))
    success = (root / 'migration-rehearsal.json').is_file()
    b.api('/releases/' + str(release_id), 'PATCH', {'draft': True, 'body': release['body'] + '\n\n0040隔離適用：' + ('成功' if success else '未完了・本番適用不可')})
    return dict(result, migration_rehearsal_verified=success)


def apply():
    root = b.workdir()
    files, manifest = b.unpack(root)
    context_check(manifest)
    release = b.api('/releases/' + str(int(os.environ['BACKUP_RELEASE_ID'])))
    pr = b.api('/pulls/176')
    main = b.api('/commits/main')
    if not release['draft'] or '0040隔離適用：成功' not in release['body'] or '復元確認：成功' not in release['body']:
        raise b.BackupError('independent_restore_and_rehearsal_not_verified')
    if pr['state'] != 'open' or pr['head']['sha'] != manifest['release']['source_sha'] or main['sha'] != manifest['release']['main_before_sha']:
        raise b.BackupError('pr_or_main_changed_since_rehearsal')
    current = json.loads(source_sql('BEGIN READ ONLY;' + preflight_query() + 'ROLLBACK;'))
    check_preflight(current)
    rows = json.loads((files / 'rows.json').read_text())
    output = source_sql(application_sql(manifest, rows), readonly=False, phase='approved_migration_transaction_failed')
    # pg_advisory_xact_lockの空行以外は固定JSONだけ。SQLや実データは表示しない。
    objects = [json.loads(line) for line in output.decode().splitlines() if line.strip().startswith('{')]
    if not objects or not objects[-1].get('migration_applied'):
        raise b.BackupError('migration_commit_result_unknown_do_not_retry_blindly')
    source_sql((SQL_ROOT / '03_verify.sql').read_text().replace('event_fixed_pair_backup_20261102', manifest['release']['backup_schema']), phase='production_post_verify_failed')
    result = dict(objects[-1], backup_schema=manifest['release']['backup_schema'], migration_sha256=MIGRATION_SHA)
    b.json_file(root / 'production-applied.json', result)
    b.api('/releases/' + str(release['id']), 'PATCH', {'draft': True, 'body': release['body'] + '\n\n本番0040・03：成功（既存全対象表の行データ・既存権限を保持）'})
    return result


def main():
    os.umask(0o077)
    try:
        actions = {'prepare': prepare, 'rehearse': rehearse, 'mark': mark, 'apply': apply}
        if len(sys.argv) != 2 or sys.argv[1] not in actions:
            raise b.BackupError('unknown_release_action')
        result = actions[sys.argv[1]]()
        print('::notice title=承認済み0040反映::' + json.dumps(result, ensure_ascii=False))
    except (b.BackupError, b.probe.ProbeError) as error:
        print('::error title=承認済み0040反映::' + str(error))
        return 1
    except Exception:
        print('::error title=承認済み0040反映::unexpected_release_failure')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
