"""Catalog-only production audit; pinned existing TLS/target checks. No data writes."""
import hashlib,json,os,pathlib,subprocess,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'event-fixed-pairs'))
from cloud_connection_probe import connection_environment,custom_ca_file,command

def main():
    try:
        root=pathlib.Path(__file__).resolve().parent
        env=os.environ.copy();env.update(connection_environment(os.environ.get('SUPABASE_DB_URL','')))
        ca=custom_ca_file()
        if not ca:raise ValueError('CA required')
        env['PGSSLROOTCERT']='/run/padel-supabase-ca.crt'
        result=subprocess.run(command(ca),input=(root/'01_preflight.sql').read_text(),env=env,text=True,capture_output=True,timeout=90)
        if result.returncode:raise ValueError('Query failed')
        data=json.loads(result.stdout)
        if data.get('read_only')!='on':raise ValueError('Not read only')
        # Definitions are never logged/published. Only ACL/security metadata and hashes
        # leave the runner; schemas contain no member/account/application rows.
        for fn in data.get('functions') or []:
            fn['definition_sha256']=hashlib.sha256(fn.pop('definition').replace('\r','').encode()).hexdigest()
        pathlib.Path(os.environ['TASK08_CATALOG_OUTPUT']).write_text(json.dumps(data,ensure_ascii=False,indent=2))
        print('TASK08 catalog: READ ONLY / verify-full / metadata only / no production writes')
        return 0
    except Exception:
        print('TASK08 catalog failed; credentials and raw SQL errors suppressed',file=sys.stderr)
        return 1
if __name__=='__main__':raise SystemExit(main())
