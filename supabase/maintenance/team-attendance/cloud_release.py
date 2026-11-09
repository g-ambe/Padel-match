"""PR187専用。保管済み実ファイルを隔離復元し、0044だけを検証・適用する。"""
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / 'event-fixed-pairs'))
import cloud_backup as b
spec = importlib.util.spec_from_file_location('release_common', HERE.parent / 'event-fixed-pairs/cloud_release.py')
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
MIGRATION = ROOT / 'supabase/migrations/0044_friendly_team_attendance.sql'
MIGRATION_SHA = 'd329bcb1ea4fa43f6c513b4805a601210a5706d665a6c7c2c4653d67890ba4ca'
MAIN_SHA = '59e9032744c930936598c7bed5424146ba8d4721'
BACKUP_SHA = '39f749a8319706fb03f0b1ec89c757477885e3a9c725716e5e62231d8d00b954'
DEFAULT_ACL = """SELECT coalesce(json_agg(json_build_object(
 'owner',pg_get_userbyid(d.defaclrole),'schema',coalesce(n.nspname,''),'kind',d.defaclobjtype,
 'acl',coalesce((SELECT json_agg(json_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
 ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
 FROM aclexplode(d.defaclacl) a),'[]'::json)) ORDER BY pg_get_userbyid(d.defaclrole),coalesce(n.nspname,''),d.defaclobjtype),'[]'::json)
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace"""


def require(value, phase):
    if not value:
        raise b.BackupError(phase)


def authority():
    require(hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == MIGRATION_SHA, '0044_reviewed_sql_changed')
    require(os.environ.get('BACKUP_SHA256') == BACKUP_SHA, '0044_backup_changed')
    pr = b.api('/pulls/187')
    require(pr['state'] == 'open' and pr['head']['repo']['full_name'] == b.REPOSITORY and
            pr['head']['ref'] == 'codex/team-roster-ui' and pr['head']['sha'] == os.environ['BACKUP_SOURCE_SHA'], '0044_pr_head_changed')
    require(b.api('/commits/main')['sha'] == MAIN_SHA, '0044_main_changed')
    # ステージング失敗はユーザーの追加指示で除外。他の失敗は許容しない。
    checks = b.api('/commits/' + pr['head']['sha'] + '/check-runs')['check_runs']
    require(not any(c['name'] != 'Workers Builds: padel-match-staging' and c['status'] == 'completed' and
                    c['conclusion'] not in ('success', 'neutral', 'skipped') for c in checks), '0044_other_github_check_failed')


def probes(target, manifest):
    result = []
    def capture(sql):
        value = target.query(sql)
        result.append({'sql': sql, 'value': copy.deepcopy(value)})
        return value
    tables = manifest['tables'] + ([{'schema': 'public', 'name': 'event_team_attendance'}]
                                if target.query("SELECT to_json(to_regclass('public.event_team_attendance') IS NOT NULL)") else [])
    b.catalog(capture, tables, manifest['function_schemas'] +
              (['team_attendance_private'] if target.query("SELECT to_json(to_regnamespace('team_attendance_private') IS NOT NULL)") else []))
    capture(b.ROLE_METADATA)
    capture("SELECT coalesce(json_agg(json_build_array(pg_get_userbyid(d.defaclrole),coalesce(n.nspname,''),d.defaclobjtype,d.defaclacl::text) ORDER BY pg_get_userbyid(d.defaclrole),coalesce(n.nspname,''),d.defaclobjtype),'[]') FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace")
    capture(DEFAULT_ACL)
    return result


def catalog_guard(values):
    # pg_get_*の修飾名表示も、バックアップ・隔離照合と同じ探索パスへ固定する。
    return "SET search_path='';" + ''.join("DO $catalog$ BEGIN IF (" + v['sql'] + ")::jsonb IS DISTINCT FROM " +
                   b.literal(json.dumps(v['value'], ensure_ascii=False)) +
                   "::jsonb THEN RAISE EXCEPTION '0044_catalog_changed' USING ERRCODE='40001'; END IF; END $catalog$;" for v in values)


def verify_sql():
    return """
DO $verify$ BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.event_team_attendance'::regclass)
 OR NOT has_table_privilege('authenticated','public.event_team_attendance','SELECT')
 OR has_table_privilege('authenticated','public.event_team_attendance','INSERT,UPDATE,DELETE')
 OR has_table_privilege('anon','public.event_team_attendance','SELECT,INSERT,UPDATE,DELETE')
 OR has_function_privilege('anon','public.set_friendly_team_attendance(uuid,text,uuid,uuid,text)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.set_friendly_team_attendance(uuid,text,uuid,uuid,text)','EXECUTE')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.set_friendly_team_attendance(uuid,text,uuid,uuid,text)'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=""'])
 OR EXISTS(SELECT 1 FROM public.event_team_attendance)
 OR (SELECT count(*) FROM pg_trigger WHERE tgname IN ('guard_team_side_group','guard_team_lineup_attendance') AND tgenabled='O')<>2
 THEN RAISE EXCEPTION '0044_post_verification_failed'; END IF;
 PERFORM profile_link_private.check_reference_schema();
END $verify$;
"""


def check_existing_catalog(before, after):
    old = copy.deepcopy(before)
    new = copy.deepcopy(after)
    def normalize(values):
        result = []
        for item in values:
            # 新privateスキーマの確認は別途行う。既存オブジェクトへの変更は2トリガーだけ。
            if "n.nspname='team_attendance_private'" in item['sql'] or "'\"public\".\"event_team_attendance\"'::regclass" in item['sql']:
                continue
            value = item['value']
            if isinstance(value, dict) and 'triggers' in value:
                value['triggers'] = [t for t in value['triggers'] if t[0] not in ('guard_team_lineup_attendance', 'guard_team_side_group')]
            if isinstance(value, list) and value and isinstance(value[0], dict) and 'arguments' in value[0]:
                item['value'] = [f for f in value if f['name'] != 'set_friendly_team_attendance']
            result.append(item)
        return result
    require(normalize(old) == normalize(new), '0044_existing_security_or_definitions_changed')


def functions(target):
    """隔離DBの合成開催だけを作成。既存行は触らず、最後に全行ハッシュも照合する。"""
    actor = target.query("""SELECT row_to_json(x) FROM (
    SELECT cm.club_id,cm.id member,pp.id player,coalesce(pp.linked_auth_user_id,cm.profile_id) actor
    FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=coalesce(cm.player_profile_id,cm.profile_id)
    WHERE cm.is_active AND pp.is_active AND cm.role IN ('main_admin','sub_admin') AND coalesce(pp.linked_auth_user_id,cm.profile_id) IS NOT NULL
    ORDER BY cm.id LIMIT 1) x""")
    require(bool(actor), '0044_no_isolated_test_manager')
    eid, card, ga, gb = (str(uuid.uuid4()) for _ in range(4))
    q = b.literal
    target.sql("SET ROLE postgres;INSERT INTO public.events(id,name,court_count,event_mode,created_by_auth_user_id) VALUES(" + q(eid) + ",'PR187隔離検証',1,'team'," + q(actor['actor']) + ");INSERT INTO public.event_team_sides(event_id,side,club_id,team_name) VALUES(" + q(eid) + ",'team_a'," + q(actor['club_id']) + ",'隔離A'),(" + q(eid) + ",'team_b'," + q(actor['club_id']) + ",'隔離B');INSERT INTO public.event_team_guests(id,event_id,side,guest_name) VALUES(" + q(ga) + ',' + q(eid) + ",'team_a','隔離同名ゲスト'),(" + q(gb) + ',' + q(eid) + ",'team_b','隔離同名ゲスト');RESET ROLE;")
    def session(uid=actor['actor'], role='authenticated'):
        return "SET request.jwt.claim.sub=" + q(uid) + ";SET request.jwt.claims=" + q(json.dumps({'sub': uid, 'role': role})) + ';SET ROLE ' + role + ';'
    def run(sql, ok=True, uid=actor['actor'], role='authenticated'):
        try:
            target.sql(session(uid, role) + sql)
        except b.BackupError as exc:
            if ok or not str(exc).endswith(('/42501', '/P0001')):
                raise
        else:
            require(ok, '0044_expected_rejection_missing')
    def status(value, member=actor['member'], guest=None, side='team_a'):
        return 'SELECT public.set_friendly_team_attendance(' + ','.join('NULL' if v is None else q(v) for v in [eid, side, member, guest, value]) + ');'
    insert = "INSERT INTO public.event_team_matches(id,event_id,match_order,team_a_player1_profile_id) VALUES(" + ','.join([q(card),q(eid),'1',q(actor['player'])]) + ');'
    run(status('absent'), False, uid=str(uuid.uuid4()))
    run(status('absent'), False, role='anon')
    run(status('absent'))
    run(insert, False)
    run("UPDATE public.event_team_attendance SET status='active'", False)
    run(status('active'))
    run(insert)
    run(status('absent'), False)
    run("UPDATE public.event_team_matches SET team_a_score=0,team_b_score=0,result='draw' WHERE id=" + q(card))
    run(status('absent'))
    run("UPDATE public.event_team_matches SET team_a_score=4,team_b_score=2,result='win',youtube_url='https://youtu.be/abcdefghijk' WHERE id=" + q(card))
    run(status('absent', None, gb, 'team_b'))
    run(status('active', None, gb, 'team_a'), False)
    run("INSERT INTO public.event_team_matches(event_id,match_order,team_a_player1_guest_name) VALUES(" + q(eid) + ",2,'隔離同名ゲスト')")
    run("INSERT INTO public.event_team_matches(event_id,match_order,team_b_player1_guest_name) VALUES(" + q(eid) + ",3,'隔離同名ゲスト')", False)
    run("UPDATE public.event_team_sides SET club_id=NULL WHERE event_id=" + q(eid), False)
    target.sql('SET ROLE postgres;DELETE FROM public.event_team_matches WHERE event_id=' + q(eid) + ';DELETE FROM public.event_team_attendance WHERE event_id=' + q(eid) + ';RESET ROLE;')
    def race(first, second):
        process = subprocess.Popen(target.prefix + b.PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            process.stdin.write((session() + "SET application_name='team187-attendance-race';BEGIN;" + first + 'SELECT pg_sleep(3);COMMIT;').encode())
            process.stdin.close()
            # 固定sleepで先行順序を推測せず、実際の待機中クエリを確認する。
            for _ in range(50):
                if target.query("SELECT to_json(EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event='PgSleep' AND application_name='team187-attendance-race'))"):
                    break
                time.sleep(.1)
            else:
                raise b.BackupError('0044_race_first_connection_not_ready')
            run(second, False)
            require(process.wait(timeout=20) == 0, '0044_race_first_connection_failed')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    race(status('absent'), insert)
    run(status('active'))
    race(insert, status('absent'))
    require(target.query("SELECT to_json(count(*)=1) FROM public.event_team_matches WHERE event_id=" + q(eid)), '0044_race_card_count_wrong')
    require(target.query("SELECT to_json(status='active') FROM public.event_team_attendance WHERE event_id=" + q(eid) + " AND member_id=" + q(actor['member'])), '0044_race_attendance_wrong')
    target.sql('SET ROLE postgres;DELETE FROM public.events WHERE id=' + q(eid) + ';RESET ROLE;')


def rehearse():
    authority()
    root = b.workdir()
    files, manifest = b.unpack(root)
    require(0 <= (datetime.now(timezone.utc) - datetime.fromisoformat(manifest['captured_at'])).total_seconds() <= 7200,
            '0044_backup_not_recent')
    target = b.start_isolated_database(root)
    restored = b.restore_files(target, files, manifest)
    print('::notice title=PR187 DB段階::isolated_restore_and_catalog_verified', flush=True)
    target.sql('SET ROLE postgres;' + (HERE / '01_preflight.sql').read_text() + 'RESET ROLE;')
    require(not target.query("SELECT to_json(to_regclass('public.event_team_attendance') IS NOT NULL)"), '0044_already_present')
    before = probes(target, manifest)
    rows = json.loads((files / 'rows.json').read_text())
    target.sql('SET ROLE postgres;' + MIGRATION.read_text() + verify_sql() + 'RESET ROLE;')
    target.sql('SET ROLE postgres;' + (HERE / '02_verify.sql').read_text() + 'RESET ROLE;')
    after = probes(target, manifest)
    check_existing_catalog(before, after)
    require(b.row_fingerprints(target.query, manifest['tables']) == rows, '0044_migration_changed_existing_rows')
    print('::notice title=PR187 DB段階::0044_applied_existing_rows_and_security_unchanged', flush=True)
    functions(target)
    print('::notice title=PR187 DB段階::attendance_card_permissions_and_concurrency_verified', flush=True)
    target.sql(verify_sql())
    require(b.row_fingerprints(target.query, manifest['tables']) == rows, '0044_test_cleanup_changed_existing_rows')
    rollback = (HERE / '03_rollback.sql').read_text()
    target.sql('SET ROLE postgres;' + rollback + 'RESET ROLE;')
    target.sql(catalog_guard(after))
    # COMMIT化するのは本番接続を持たない隔離コンテナだけ。
    target.sql('SET ROLE postgres;' + rollback.replace('ROLLBACK;', 'COMMIT;') + 'RESET ROLE;')
    target.sql(catalog_guard(before))
    require(b.row_fingerprints(target.query, manifest['tables']) == rows, '0044_rollback_changed_existing_rows')
    target.sql('SET ROLE postgres;' + MIGRATION.read_text() + verify_sql() + 'RESET ROLE;')
    target.sql(catalog_guard(after))
    b.json_file(root / 'team187-proof.json', {'head': os.environ['BACKUP_SOURCE_SHA'], 'main': MAIN_SHA, 'migration': MIGRATION_SHA,
                'backup': BACKUP_SHA, 'before': before, 'after': after, 'manifest': manifest, 'rows': rows})
    result = dict(restored, migration_rehearsal_verified=True, existing_security_unchanged=True, existing_data_unchanged=True,
                  attendance_and_card_tests=True, concurrent_both_orders=True, rollback_and_reapply_verified=True)
    b.json_file(root / 'team187-result.json', result)
    return result


def apply():
    require(os.environ.get('PADEL_RELEASE_AUTHORIZED') == 'PR187-0044-20261109', '0044_production_not_authorized')
    authority()
    root = b.workdir()
    proof = json.loads((root / 'team187-proof.json').read_text())
    require(proof['head'] == os.environ['BACKUP_SOURCE_SHA'] and proof['main'] == MAIN_SHA and
            proof['backup'] == BACKUP_SHA and proof['migration'] == MIGRATION_SHA, '0044_rehearsal_proof_changed')
    common.source_sql((HERE / '01_preflight.sql').read_text(), phase='0044_readonly_preflight_failed')
    locks = ','.join('public.' + b.ident(t) for t in ('events','club_members','event_team_sides','event_team_matches','event_team_guests'))
    tables = proof['manifest']['tables']
    sql = ("BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='120s';"
           + b.SQL_SETTINGS + 'SET LOCAL search_path=public;LOCK TABLE ' + locks + ' IN SHARE ROW EXCLUSIVE MODE;'
           + catalog_guard(proof['before']) + common.assert_rows(proof['rows']) + common.current_rows_sql(tables)
           + common.body(MIGRATION) + verify_sql() + catalog_guard(proof['after']) + common.assert_unchanged_sql(tables)
           + "SELECT json_build_object('0044_applied',true,'existing_rows_unchanged',true,'catalog_matches_rehearsal',true);COMMIT;")
    result = json.loads(common.source_sql(sql, readonly=False, phase='0044_atomic_apply_failed_or_response_unknown'))
    require(result.get('0044_applied') is True, '0044_application_not_confirmed')
    # ここで失敗した場合もDDLを自動で戻さず、状態を保全する。
    common.source_sql('BEGIN READ ONLY;' + verify_sql() + catalog_guard(proof['after']) + 'ROLLBACK;')
    common.source_sql((HERE / '02_verify.sql').read_text(), phase='0044_verification_query_failed')
    authority()
    return result


def diagnose():
    """本番はSELECTだけ。行の値・ID・得点・定義本文をログへ出さない。"""
    authority()
    proof = json.loads((b.workdir() / 'team187-proof.json').read_text())
    def label(index, sql):
        if sql == DEFAULT_ACL:
            return 'default_acl_semantic'
        table = re.search(r"c\.oid='\"([a-z0-9_]+)\"\.\"([a-z0-9_]+)\"'::regclass", sql)
        if table:
            return 'table:' + '.'.join(table.groups())
        schema = re.search(r"n\.nspname='([a-z0-9_]+)'", sql)
        if schema:
            return ('functions:' if 'pg_proc p' in sql else 'schema:') + schema.group(1)
        return 'default_acl' if 'pg_default_acl' in sql else 'roles' if 'pg_catalog.pg_roles' in sql else 'catalog_' + str(index)
    catalog_parts = []
    for index, probe in enumerate(proof['before']):
        catalog_parts.append('SELECT ' + b.literal(label(index, probe['sql'])) + "::text name WHERE (" + probe['sql'] + ')::jsonb IS DISTINCT FROM ' + b.literal(json.dumps(probe['value'], ensure_ascii=False)) + '::jsonb')
    row_parts = []
    for row in proof['rows']:
        relation = b.ident(row['schema']) + '.' + b.ident(row['name'])
        expected = json.dumps({'rows': row['rows'], 'sha256': row['sha256']})
        row_parts.append('SELECT ' + b.literal(row['schema'] + '.' + row['name']) + '::text name WHERE ' + common.row_expression(relation) + ' IS DISTINCT FROM ' + b.literal(expected) + '::jsonb')
    sql = ("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" + b.SQL_SETTINGS +
           "SELECT json_build_object('attendance_present',to_regclass('public.event_team_attendance') IS NOT NULL," +
           "'catalog_mismatches',(SELECT coalesce(json_agg(name),'[]') FROM (" + ' UNION ALL '.join(catalog_parts) + ") c)," +
           "'changed_tables',(SELECT coalesce(json_agg(name),'[]') FROM (" + ' UNION ALL '.join(row_parts) + ") r)," +
           "'production_mutations',false);ROLLBACK;")
    result = json.loads(common.source_sql(sql, phase='0044_readonly_diagnostics_failed'))
    actual = json.loads(common.source_sql('BEGIN READ ONLY;' + b.SQL_SETTINGS + DEFAULT_ACL + ';ROLLBACK;', phase='0044_default_acl_readonly_failed'))
    expected = next(p['value'] for p in proof['before'] if p['sql'] == DEFAULT_ACL)
    def key(value):
        return (value['owner'], value['schema'], value['kind'])
    old, new = {key(v):v['acl'] for v in expected}, {key(v):v['acl'] for v in actual}
    known = {'postgres','supabase_admin','supabase_auth_admin','supabase_storage_admin','authenticated','anon','service_role','authenticator','dashboard_user','PUBLIC'}
    def redact(values):
        return [[role if role in known else 'other_role',grantor if grantor in known else 'other_role',privilege,grantable]
                for role,grantor,privilege,grantable in values]
    result['default_acl_differences'] = [{'owner':k[0] if k[0] in known else 'other_role','schema':k[1] if re.fullmatch(r'[a-z0-9_]*',k[1]) else 'other_schema','kind':k[2],
        'isolated':redact(old.get(k,[])),'production':redact(new.get(k,[]))} for k in sorted(old.keys()|new.keys()) if old.get(k)!=new.get(k)]
    return result


if __name__ == '__main__':
    os.umask(0o077)
    try:
        action = {'rehearse': rehearse, 'apply': apply, 'diagnose': diagnose}[sys.argv[1]]
        result = action()
        print('::notice title=PR187 DB確認::' + json.dumps(result, ensure_ascii=False), flush=True)
    except b.BackupError as exc:
        print('::error title=PR187 DB確認::' + str(exc), flush=True)
        sys.exit(1)
    except Exception:
        print('::error title=PR187 DB確認::unexpected_failure_no_automatic_rollback', flush=True)
        sys.exit(1)
