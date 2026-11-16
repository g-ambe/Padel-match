"""Bounded GC for the approved project/bucket; dry-run by default. No R2 listing."""
import argparse,json,os,pathlib,re,subprocess,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'event-fixed-pairs'))
from cloud_connection_probe import connection_environment
from provision_r2 import api,WORKER,BUCKET
KEY=re.compile(r'^profiles/[a-f0-9-]{36}/[a-f0-9-]{36}\.webp$')
def run(apply=False):
    env=os.environ.copy();env.update(connection_environment(os.environ.get('SUPABASE_DB_URL','')))
    ca=os.environ.get('PADEL_BACKUP_CA_FILE','')
    if not pathlib.Path(ca).is_file():raise RuntimeError('The approved verified CA file is required')
    env['PGSSLROOTCERT']=ca
    def query(sql,variables=()):
        command=['psql','-XAtq','-v','ON_ERROR_STOP=1']
        for variable in variables:command.extend(['-v',variable])
        result=subprocess.run(command,input=sql,env=env,text=True,capture_output=True,timeout=30)
        if result.returncode:raise RuntimeError('Database operation failed; details not logged')
        return result.stdout.strip()
    # Matching Worker identity is checked before any R2 delete.
    api(f'/workers/scripts/{WORKER}/settings')
    candidates=json.loads(query("select coalesce(json_agg(object_key),'[]') from (select object_key from profile_media_objects where (state='garbage' and collect_after<=clock_timestamp()) or (state='deleting' and claimed_at<clock_timestamp()-interval '5 minutes') order by collect_after limit 20) q;"))
    counts={'candidates':len(candidates),'deleted':0,'pending':0,'applied':apply}
    if apply:
        for key in candidates:
            if not KEY.fullmatch(key):raise RuntimeError('Unexpected object key; stopped before deletion')
            claimed=query("begin;update profile_media_objects o set state='deleting',claimed_at=clock_timestamp() where object_key=:'object_key' and ((state='garbage' and collect_after<=clock_timestamp()) or (state='deleting' and claimed_at<clock_timestamp()-interval '5 minutes')) and not exists(select 1 from player_profile_private where avatar_key=:'object_key') and not exists(select 1 from profile_media_operations where object_key=:'object_key' and status='pending') returning object_key;commit;",['object_key='+key])
            if claimed!=key:continue
            command=['node','node_modules/wrangler/bin/wrangler.js','r2','object','delete',BUCKET+'/'+key,'--remote']
            cf_env={k:v for k,v in os.environ.items() if not k.startswith('PG') and k not in ('SUPABASE_DB_URL','PADEL_BACKUP_PASSPHRASE')}
            cf_env['CLOUDFLARE_ACCOUNT_ID']='72e845fed80700b737e7e611908c7a6b'
            result=subprocess.run(command,env=cf_env,text=True,capture_output=True,timeout=45)
            if result.returncode:counts['pending']+=1;continue
            query("update profile_media_objects set state='deleted',deleted_at=clock_timestamp() where object_key=:'object_key' and state='deleting' and not exists(select 1 from player_profile_private where avatar_key=:'object_key');",['object_key='+key]);counts['deleted']+=1
        # >=45 days of audit are retained; the 30-day quota cannot be reset by pruning.
        query("delete from profile_media_objects o where state='deleted' and deleted_at<clock_timestamp()-interval '45 days' and not exists(select 1 from player_profile_private where avatar_key=o.object_key);delete from profile_media_operations o where status in('committed','aborted') and coalesce(committed_at,created_at)<clock_timestamp()-interval '45 days' and not exists(select 1 from profile_media_objects b where b.request_id=o.request_id);delete from profile_media_attempts where created_at<clock_timestamp()-interval '1 day';")
    print(json.dumps(counts))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    try:run(args.apply)
    except Exception as error:raise SystemExit(str(error))
