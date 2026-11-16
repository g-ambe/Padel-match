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
    d=json.loads(result.stdout.strip());print(json.dumps(d,ensure_ascii=False))
except (ProbeError,Exception):raise SystemExit('本番カタログ確認に失敗しました。接続/TLS/権限を確認してください（接続情報は非表示）。')
