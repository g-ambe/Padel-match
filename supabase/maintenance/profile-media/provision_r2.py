"""Only the existing account / padel-match Worker. No billing/subscription APIs."""
import argparse, json, os, pathlib, secrets, urllib.request, urllib.error, hashlib
ACCOUNT='72e845fed80700b737e7e611908c7a6b';WORKER='padel-match';BUCKET='padel-match-profile-images'
BASE=f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}'
def api(path,method='GET',body=None):
    token=os.environ.get('CLOUDFLARE_API_TOKEN')
    if not token: raise RuntimeError('CLOUDFLARE_API_TOKEN is not configured')
    req=urllib.request.Request(BASE+path,method=method,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=25) as r:d=json.load(r)
    except urllib.error.HTTPError as e:
        try:d=json.load(e)
        except Exception:d={}
        codes=[x.get('code') for x in d.get('errors',[])];raise RuntimeError(f'Cloudflare rejected request HTTP {e.code}; codes={codes}') from None
    if not d.get('success'):raise RuntimeError('Cloudflare operation failed')
    return d.get('result')
def run(apply=False):
    settings=api(f'/workers/scripts/{WORKER}/settings')
    if not isinstance(settings,dict):raise RuntimeError('Target Worker could not be verified')
    result=api('/r2/buckets');buckets=result.get('buckets',[]) if isinstance(result,dict) else result
    candidates=[x for x in buckets if x.get('name')==BUCKET or ('padel' in x.get('name','').lower() and any(t in x['name'].lower() for t in ('profile','avatar')))]
    if any(x['name']!=BUCKET for x in candidates):raise RuntimeError('A possible existing profile bucket needs inspection; no duplicate created')
    exists=any(x['name']==BUCKET for x in candidates)
    if not exists and apply:api('/r2/buckets','POST',{'name':BUCKET,'storageClass':'Standard'});exists=True
    if exists:
        bucket=api(f'/r2/buckets/{BUCKET}')
        if (bucket.get('storage_class') or bucket.get('storageClass'))!='Standard':raise RuntimeError('Existing bucket is not Standard')
        custom=api(f'/r2/buckets/{BUCKET}/domains/custom')
        domains=custom.get('domains',[]) if isinstance(custom,dict) else custom
        if domains:raise RuntimeError('Existing custom domain found; stopped without altering it')
        managed=api(f'/r2/buckets/{BUCKET}/domains/managed')
        if managed.get('enabled'):
            if apply:api(f'/r2/buckets/{BUCKET}/domains/managed','PUT',{'enabled':False})
            else:raise RuntimeError('r2.dev is enabled; bucket is not private yet')
        if api(f'/r2/buckets/{BUCKET}/domains/managed').get('enabled'):raise RuntimeError('Private bucket verification failed')
    report={'worker_verified':True,'account_verified':True,'r2_api_10042_resolved':True,'bucket_exists':exists,'applied':apply}
    if apply:
        directory=pathlib.Path(os.environ.get('PROFILE_MEDIA_SETUP_DIR','/tmp/padel-profile-media-setup'));directory.mkdir(mode=0o700,parents=True,exist_ok=True);os.chmod(directory,0o700)
        if directory.resolve().is_relative_to(pathlib.Path(__file__).resolve().parents[3]):raise RuntimeError('Secret material must be stored outside the Git checkout')
        secret_file=directory/'commit-secret'
        binding=any(b.get('name')=='PROFILE_MEDIA_COMMIT_SECRET' for b in settings.get('bindings',[]))
        if binding and not secret_file.exists():raise RuntimeError('Worker secret already exists; obtain its approved secure source instead of rotating it')
        if not secret_file.exists():
            with os.fdopen(os.open(secret_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:f.write(secrets.token_hex(32))
        os.chmod(secret_file,0o600)
        secret=secret_file.read_text().strip()
        if len(secret)!=64:raise RuntimeError('Invalid local secret material')
        # Existing secret values cannot be read back. Never replace one based on a local guess.
        if not binding:api(f'/workers/scripts/{WORKER}/secrets','PUT',{'name':'PROFILE_MEDIA_COMMIT_SECRET','type':'secret_text','text':secret})
        plan={'account':ACCOUNT,'worker':WORKER,'bucket':BUCKET,'commit_secret_sha256':hashlib.sha256(secret.encode()).hexdigest()}
        with os.fdopen(os.open(directory/'plan.json',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as f:json.dump(plan,f)
        report['secret_configured']=True
    print(json.dumps(report))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');a=p.parse_args()
    try:run(a.apply)
    except Exception as e:raise SystemExit(str(e))
