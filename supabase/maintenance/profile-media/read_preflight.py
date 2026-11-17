"""Read-only production catalog. Uses the established target/TLS checks, never prints credentials."""
import json,os,pathlib,subprocess,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'event-fixed-pairs'))
from cloud_connection_probe import connection_environment,prepare_ca,ProbeError
try:
    env=os.environ.copy();env.update(connection_environment(os.environ.get('SUPABASE_DB_URL','')))
    # Requires the existing verified official CA file; never disables certificate verification.
    env['PGSSLMODE']='verify-full'
    ca=os.environ.get('PADEL_BACKUP_CA_FILE')
    if not ca or not pathlib.Path(ca).is_file():raise ProbeError('Verified CA file is required')
    env['PGSSLROOTCERT']=ca
    result=subprocess.run(['psql','-XAtq','-v','ON_ERROR_STOP=1','-f',str(pathlib.Path(__file__).with_name('01_preflight.sql'))],env=env,text=True,capture_output=True,timeout=45)
    if result.returncode:raise ProbeError('Catalog query failed; credentials and SQL output were not logged')
    d=json.loads(result.stdout.strip())
    columns={name:kind for name,kind in d.get('parent_columns',[])}
    expected={'id':'uuid','linked_auth_user_id':'uuid','is_active':'boolean'}
    if columns!=expected or not d.get('parent_rls') or not d.get('latest_video_rpc'):
        raise ProbeError('Expected parent schema/RLS or existing video RPC was not found')
    if d.get('new_schema_exists') or d.get('new_table_exists'):
        raise ProbeError('The new migration may already be installed; inspect its history before applying')
    if not d.get('history_exists'):raise ProbeError('Expected migration history was not found')
    print(json.dumps(d,ensure_ascii=False))
    # Only non-personal aggregate results in the annotation; readable via the GitHub API.
    report={'schema_verified':True,'parent_rls':True,'existing_video_rpc':True,'0048_applied':False,'migration_history':True,'policy_count':len(d.get('parent_policies') or []),'grant_count':len(d.get('existing_grants') or [])}
    print('::notice title=TASK01 production catalog::'+json.dumps(report,separators=(',',':')))
except (ProbeError,Exception):raise SystemExit('本番カタログ確認に失敗しました。接続/TLS/権限を確認してください（接続情報は非表示）。')
