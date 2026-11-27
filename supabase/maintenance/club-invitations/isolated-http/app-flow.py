"""Real local Auth/PostgREST, app RPC wrappers, mock outbound delivery only."""
from pathlib import Path
H=Path(__file__).parent
fixture=(H/'auth-check.py').read_text();exec(fixture.split("args={'p_club':club")[0])
unregistered=(H/'unregistered.py').read_text();exec(unregistered.split("status,d=http(R,'/rpc/reserve_club_invite_send'")[0])
def node(body):
 body.update({'container':D,'rest':R});env=dict(os.environ,NODE_PATH=str(H.resolve().parents[3]/'node_modules'))
 r=subprocess.run(['node',str(H/'app-flow.cjs')],input=json.dumps(body),text=True,capture_output=True,env=env)
 assert r.returncode==0,r.stderr[-2000:];return json.loads(r.stdout)
sent=node({'mode':'send','service':service,'args':args});assert sent['invite'] and sent['generation']==1
uid=signup(mail);confirm(mail);status,session=login(mail);assert status==200
sql="INSERT INTO public.profiles(id,display_name,email) VALUES('%s','本人','%s'); INSERT INTO public.player_profiles(id,linked_auth_user_id,display_name) VALUES('20000000-0000-4000-8000-000000000098','%s','本人');"%(uid,mail,uid)
r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr
result=node({'mode':'accept','token':session['access_token'],'other':out_token,'invite':sent['invite'],'operation':str(uuid.uuid4())});assert result['status']=='approved'
print('PASS app wrappers: local Auth/PostgREST, mock delivery once, wrong recipient denial, consent and approval',flush=True)
