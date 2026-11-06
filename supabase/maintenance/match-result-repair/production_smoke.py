"""PR182の本番反映確認。実試合に触れず、入替を最後に有効化する。"""
import importlib.util
import json
import os
import sys
from pathlib import Path
HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
import release_approved as approved
b,common=approved.b,approved.common

def identity():
    expected=os.environ.get('EXPECTED_MAIN_SHA','')
    if len(expected)!=40 or b.api('/commits/main')['sha']!=expected:
        raise b.BackupError('post_deploy_main_changed')
    pr=b.api('/pulls/182')
    if not pr['merged'] or pr['merge_commit_sha']!=expected:
        raise b.BackupError('post_deploy_pr182_merge_not_verified')
    return approved.worker(expected)

def db_smoke(expected):
    sql=(HERE/'production-rpc-smoke.sql').read_text()
    # フラグの予期しない変更は操作前に停止。
    guard="DO $$BEGIN IF (SELECT editing_enabled FROM lineup_private.release_control) IS DISTINCT FROM "+('true' if expected else 'false')+" THEN RAISE EXCEPTION '入替フラグが想定外';END IF;END$$;"
    sql=sql.replace('set local role postgres;','set local role postgres;'+guard,1)
    raw=common.source_sql(sql,readonly=False,phase='dedicated_transactional_rpc_test_failed_stop')
    report=json.loads(raw)
    if report['editing_enabled'] is not expected or not all(v is True for k,v in report.items() if k!='editing_enabled'):
        raise b.BackupError('dedicated_rpc_test_incomplete')
    return report

def browser():
    raw=b.run(['node',str(HERE/'production-guest-smoke.cjs')],phase='production_guest_browser_failed_stop',env=b.clean_env(),timeout=300)
    report=json.loads(raw)
    if report.get('production_db_writes')!=0 or not all(v is True for k,v in report.items() if k!='production_db_writes'):
        raise b.BackupError('production_guest_browser_incomplete')
    return report

def main():
    os.umask(0o077)
    enabled=False
    try:
        version=identity()
        approved.approval()
        common.source_sql('BEGIN READ ONLY;SET LOCAL search_path=public;'+approved.verification_sql()+'ROLLBACK;')
        basic=db_smoke(False)
        guest=browser()
        identity()
        # 既存の有効化SQLを使う。例外・応答喪失時は後続せず停止側へ戻す。
        enabled=True
        common.source_sql((HERE.parent/'round-lineups/05_enable.sql').read_text(),readonly=False,phase='enable_commit_unknown')
        extended=db_smoke(True)
        print('::notice title=PR182本番検証::'+json.dumps({'worker_version':version,'basic':basic,'guest':guest,'enabled':extended,'real_match_mutations':False},ensure_ascii=False))
    except Exception:
        if enabled:
            try:
                common.source_sql((HERE.parent/'round-lineups/04_disable.sql').read_text(),readonly=False,phase='disable_failed_stop')
                print('::error title=PR182本番検証::検証失敗のため入替を停止しました。保存保護と監査は保持。')
            except Exception:print('::error title=PR182本番検証::検証失敗。入替停止の成否は要確認。後続停止。')
        else:print('::error title=PR182本番検証::有効化前の検証に失敗。入替は有効化していません。後続停止。')
        return 1
    return 0
if __name__=='__main__':raise SystemExit(main())
