"""PR182専用。既存の暗号化バックアップ・隔離復元を再利用し、全検査後だけ適用する。"""
import hashlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / 'event-fixed-pairs'))
import cloud_backup as b
_spec = importlib.util.spec_from_file_location('fixed_pair_release_common', HERE.parent / 'event-fixed-pairs/cloud_release.py')
common = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(common)

FILES = ('0041_atomic_round_lineups.sql', '0042_round_lineup_safety.sql', '0043_match_results_one_per_match.sql')
CORE = common.APP + ('event_fixed_pair_state', 'event_fixed_pairs', 'event_fixed_pair_rounds')
SECTIONS = ('tables', 'columns', 'column_acl', 'policies', 'triggers', 'rpc_functions', 'constraints')
INVALID = ('duplicate_courts', 'duplicate_results', 'invalid_cards', 'duplicate_round_players')
AUTHORITY = 'PR182-0041-0042-20261106'


def canonical(value):
    if isinstance(value, dict):
        return {k: canonical(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return sorted((canonical(v) for v in value), key=lambda v: json.dumps(v, ensure_ascii=False, sort_keys=True))
    return value


def approved_reference_definition(text):
    # 既知の参照ガード全文と一致する場合だけ、CRLF/LFを同じ定義として扱う。
    # 未知のコードや文字列の違いは受け入れない。
    normalized = text.replace('\r\n', '\n')
    approved = {v['function_sha256'] for v in reviewed().get('triggers', []) if 'profile_link_private.guard_reference(' in v['trigger']}
    return normalized if hashlib.sha256(normalized.encode()).hexdigest() in approved else text


def fingerprints(value):
    result = {}
    for k in SECTIONS:
        section = value[k]
        if k == 'triggers':
            section = [dict(v, function=approved_reference_definition(v['function'])) for v in section]
        result[k] = hashlib.sha256(json.dumps(canonical(section), ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return result


def reviewed():
    return json.loads((HERE / 'reviewed-release.json').read_text())


def authority():
    expected = reviewed()
    if os.environ.get('PADEL_RELEASE_AUTHORIZED') != AUTHORITY or not re.fullmatch(r'[0-9a-f]{40}', os.environ.get('BACKUP_SOURCE_SHA', '')):
        raise b.BackupError('pr182_release_not_authorized')
    for name in FILES:
        if hashlib.sha256((ROOT / 'supabase/migrations' / name).read_bytes()).hexdigest() != expected['migrations'].get(name):
            raise b.BackupError('reviewed_pr182_migration_changed')


def query():
    return 'SET LOCAL search_path=public;' + common.body(HERE / '01_preflight.sql')


def check_preflight(value):
    mismatch = [k for k, v in fingerprints(value).items() if reviewed()['catalog'][k] != v]
    invalid = {k: len(value[k]) for k in INVALID}
    print('::notice title=PR182事前確認::' + json.dumps({'changed_sections': mismatch, 'invalid_counts': invalid, '0040_present': value['0040_present'], '0041_present': value['0041_present'], '0042_present': value['0042_present']}, ensure_ascii=False), flush=True)
    if not value['0040_present'] or value['0041_present'] or value['0042_present'] or any(invalid.values()) or mismatch:
        raise b.BackupError('production_catalog_or_data_requires_review_do_not_apply')


def identity():
    pr, main = b.api('/pulls/182'), b.api('/commits/main')
    if pr['state'] != 'open' or pr['head']['repo']['full_name'] != b.REPOSITORY or pr['head']['ref'] != 'codex/atomic-round-lineup' or pr['head']['sha'] != os.environ['BACKUP_SOURCE_SHA']:
        raise b.BackupError('pr182_head_changed')
    return main['sha']


def trigger_differences(value):
    def key(v):
        return (v['table'], v['trigger'].split()[2])
    expected = {key(v): v for v in reviewed()['triggers']}
    actual = {key(v): dict(v, function_sha256=hashlib.sha256(approved_reference_definition(v['function']).encode()).hexdigest()) for v in value['triggers']}
    differences = []
    for k in sorted(expected.keys() | actual.keys()):
        fields = ['missing'] if k not in actual else ['unexpected'] if k not in expected else [f for f in ('trigger', 'enabled', 'function_sha256') if actual[k][f] != expected[k][f]]
        if fields:
            differences.append({'table': k[0], 'trigger': k[1], 'changed_fields': fields})
    return differences


def redacted_definition(text):
    # 固定した参照ガードだけを調査する。未知の文字列・コメントはログへ出さない。
    known = {'', 'UPDATE', 'INSERT', 'role', 'anon', 'authenticated', 'club_members', 'event_participants', 'profile_id',
             '無効化・統合済みの選手には新しい所属・参加・試合を追加できません', '旧profile_idと選手の連携アカウントが一致しません'}
    body = re.search(r'AS (\$[a-zA-Z_]*\$)([\s\S]*)\1', text)
    if not body:
        raise b.BackupError('reference_guard_definition_format_unknown')
    tokens = re.findall(r"'(?:''|[^'])*'|\$[a-zA-Z_]*\$[\s\S]*?\$[a-zA-Z_]*\$|\"(?:\"\"|[^\"])*\"|--[^\n]*|/\*[\s\S]*?\*/|[^'\"$/-]+|.", body.group(2))
    output = []
    for token in tokens:
        if token.startswith(('--', '/*')):
            output.append(' /* コメント省略 */ ')
        elif token.startswith("'"):
            literal = token[1:-1].replace("''", "'")
            output.append(token if literal in known else "'[文字列省略]'")
        elif token.startswith(('"', '$')):
            output.append('[引用値省略]')
        else:
            output.append(token)
    return ''.join(output)


def diagnose():
    authority()
    identity()
    value = json.loads(common.source_sql('BEGIN READ ONLY;' + query() + 'ROLLBACK;'))
    stats = (HERE / '07_readonly_diagnostics.sql').read_text()
    result = json.loads(common.source_sql(stats))
    result['trigger_differences'] = trigger_differences(value)
    result['catalog_differences'] = [k for k, v in fingerprints(value).items() if reviewed()['catalog'][k] != v]
    guard = json.loads(common.source_sql("BEGIN READ ONLY;SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'security_definer',prosecdef,'config',proconfig,'definition',pg_get_functiondef(oid)) FROM pg_proc WHERE oid='profile_link_private.guard_reference()'::regprocedure;ROLLBACK;"))
    definition = guard.pop('definition')
    guard['redacted_body'] = redacted_definition(definition)
    result['reference_guard'] = guard
    result['score_audit'] = json.loads(common.source_sql((HERE.parent / 'match-result-repair/01_audit.sql').read_text()))
    result['production_mutations'] = False
    return result


def prepare():
    authority()
    main = identity()
    if main != os.environ.get('BACKUP_MAIN_SHA'):
        raise b.BackupError('main_changed_before_backup')
    b.passphrase()
    before = json.loads(common.source_sql('BEGIN READ ONLY;' + query() + 'ROLLBACK;'))
    check_preflight(before)
    run, attempt = os.environ['GITHUB_RUN_ID'], os.environ.get('GITHUB_RUN_ATTEMPT', '1')
    if not run.isdigit() or not attempt.isdigit():
        raise b.BackupError('invalid_release_run')
    schema = 'round_lineup_backup_0041_r' + run + '_a' + attempt
    root = b.workdir()
    root.mkdir(mode=0o700, exist_ok=False)
    # 既存ファイル全体のSQL文を使用する。同名コピーを上書きしない。
    backup = common.body(HERE / '02_backup.sql').replace('round_lineup_backup_0041', schema)
    common.source_sql('BEGIN ISOLATION LEVEL REPEATABLE READ;' + backup + 'COMMIT;', readonly=False, phase='pr182_internal_backup_failed')
    prefix, env = common.source()
    with b.Snapshot(prefix, env) as snapshot:
        current = snapshot.query(query())
        check_preflight(current)
        info = b.collect(snapshot, root)
    rows = json.loads((root / 'files/rows.json').read_text())
    for name in CORE[:6] + CORE[11:]:
        original = next(r for r in rows if r['schema'] == 'public' and r['name'] == name)
        copied = next(r for r in rows if r['schema'] == schema and r['name'] == name)
        if (original['rows'], original['sha256']) != (copied['rows'], copied['sha256']):
            raise b.BackupError('data_changed_between_backups')
    info['release'] = {'backup_schema': schema, 'source_sha': os.environ['BACKUP_SOURCE_SHA'], 'main_before_sha': main,
                       'migrations': reviewed()['migrations'], 'preflight': {k: v for k, v in current.items() if k not in ('captured_at', 'version')}}
    (root / 'files/manifest.json').write_text(json.dumps(info, ensure_ascii=False, sort_keys=True, separators=(',', ':')))
    return dict(b.seal(root, info), internal_backup_created=True, latest_preflight_matches=True)


def context(manifest):
    authority()
    ctx = manifest.get('release', {})
    if ctx.get('migrations') != reviewed()['migrations'] or ctx.get('source_sha') != os.environ['BACKUP_SOURCE_SHA'] or not re.fullmatch(r'round_lineup_backup_0041_r\d+_a\d+', ctx.get('backup_schema', '')):
        raise b.BackupError('pr182_backup_context_invalid')
    return ctx


def metadata_guard(expected):
    # 配列順序と復元後のOID順を正規化し、適用トランザクション内でも全定義を照合する。
    sql = common.body(HERE / '01_preflight.sql').strip().rstrip(';')
    return """
CREATE FUNCTION pg_temp.lineup_canonical(v jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $canon$
BEGIN
 IF jsonb_typeof(v)='object' THEN RETURN (SELECT coalesce(jsonb_object_agg(key,pg_temp.lineup_canonical(value)),'{}'::jsonb) FROM jsonb_each(v));
 ELSIF jsonb_typeof(v)='array' THEN RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x::text),'[]'::jsonb) FROM (SELECT pg_temp.lineup_canonical(value) x FROM jsonb_array_elements(v)) a);
 ELSE RETURN v;END IF;
END $canon$;
CREATE TEMP TABLE lineup_release_preflight ON COMMIT DROP AS
""" + sql + ";DO $catalog$ BEGIN IF (SELECT pg_temp.lineup_canonical(round_lineup_preflight-ARRAY['captured_at','version']) FROM lineup_release_preflight) IS DISTINCT FROM pg_temp.lineup_canonical(" + b.literal(json.dumps(expected, ensure_ascii=False)) + "::jsonb) THEN RAISE EXCEPTION 'バックアップ後にDB定義・検査結果が変更されています';END IF;END $catalog$;"


def application_sql(manifest, rows):
    ctx = context(manifest)
    locks = ','.join('public.' + b.ident(n) for n in CORE)
    # Migrationの全SQL文を順序どおり一つのトランザクションに含める。
    # BEGIN/COMMITだけを外側へまとめ、0042失敗時は0041もROLLBACKする。
    migrations = ''.join(common.body(ROOT / 'supabase/migrations' / n) for n in FILES)
    verify = common.body(HERE / '03_verify.sql').replace('round_lineup_backup_0041', ctx['backup_schema'])
    return ("BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';SET LOCAL idle_in_transaction_session_timeout='180s';" + b.SQL_SETTINGS + 'SET LOCAL search_path=public;LOCK TABLE ' + locks + ' IN SHARE ROW EXCLUSIVE MODE;SELECT pg_advisory_xact_lock(1820041);'
            + metadata_guard(ctx['preflight']) + common.assert_rows([r for r in rows if r['schema'] == 'public' and r['name'] in CORE])
            + common.current_rows_sql(manifest['tables']) + migrations + verify
            + "DO $initial$ BEGIN IF (SELECT editing_enabled FROM lineup_private.release_control) IS NOT FALSE OR EXISTS(SELECT 1 FROM public.friendly_match_operations) OR EXISTS(SELECT 1 FROM public.friendly_round_lineup_state) THEN RAISE EXCEPTION '追加表の初期状態が不正です';END IF;END $initial$;"
            + common.assert_unchanged_sql(manifest['tables'])
            + "SELECT json_build_object('migrations_applied',true,'original_rows_unchanged',true,'editing_enabled',false);COMMIT;")


def rehearse():
    root = b.workdir()
    files, manifest = b.unpack(root)
    context(manifest)
    target = b.start_isolated_database(root)
    restored = b.restore_files(target, files, manifest)
    b.json_file(root / 'verification.json', restored)
    rows = json.loads((files / 'rows.json').read_text())
    target.sql('SET ROLE postgres;' + application_sql(manifest, rows) + 'RESET ROLE;')
    b.json_file(root / 'migration-rehearsal.json', {'verified': True})
    return dict(restored, migration_rehearsal_verified=True)


def mark():
    result = b.mark()
    release_id = int(os.environ['BACKUP_RELEASE_ID'])
    release = b.api('/releases/' + str(release_id))
    success = (b.workdir() / 'migration-rehearsal.json').is_file()
    b.api('/releases/' + str(release_id), 'PATCH', {'draft': True, 'body': release['body'] + '\n\nPR182隔離適用：' + ('成功' if success else '未完了・本番適用不可')})
    return dict(result, migration_rehearsal_verified=success)


def apply():
    root = b.workdir()
    files, manifest = b.unpack(root)
    ctx = context(manifest)
    release = b.api('/releases/' + str(int(os.environ['BACKUP_RELEASE_ID'])))
    if identity() != ctx['main_before_sha'] or not release['draft'] or 'PR182隔離適用：成功' not in release['body'] or '復元確認：成功' not in release['body']:
        raise b.BackupError('pr182_independent_restore_or_identity_not_verified')
    check_preflight(json.loads(common.source_sql('BEGIN READ ONLY;' + query() + 'ROLLBACK;')))
    rows = json.loads((files / 'rows.json').read_text())
    output = common.source_sql(application_sql(manifest, rows), readonly=False, phase='pr182_atomic_migration_failed')
    results = [json.loads(line) for line in output.decode().splitlines() if line.startswith('{')]
    if not results or results[-1].get('migrations_applied') is not True:
        raise b.BackupError('pr182_commit_result_unknown_do_not_retry')
    common.source_sql('BEGIN READ ONLY;SET LOCAL search_path=public;' + common.body(HERE / '03_verify.sql').replace('round_lineup_backup_0041', ctx['backup_schema']) + 'ROLLBACK;', phase='pr182_post_verify_failed')
    b.api('/releases/' + str(release['id']), 'PATCH', {'draft': True, 'body': release['body'] + '\n\n本番0041・0042・03：成功（入替は無効、既存行保持）'})
    return dict(results[-1], backup_release_id=release['id'])


def main():
    os.umask(0o077)
    try:
        actions = {'diagnose': diagnose, 'prepare': prepare, 'rehearse': rehearse, 'mark': mark, 'apply': apply}
        if len(sys.argv) != 2 or sys.argv[1] not in actions:
            raise b.BackupError('unknown_pr182_release_action')
        result = actions[sys.argv[1]]()
        print('::notice title=PR182クラウド反映::' + json.dumps(result, ensure_ascii=False))
    except (b.BackupError, b.probe.ProbeError) as error:
        print('::error title=PR182クラウド反映::' + str(error))
        return 1
    except Exception:
        print('::error title=PR182クラウド反映::unexpected_failure_no_secrets_logged')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
