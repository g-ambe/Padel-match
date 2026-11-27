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

# Another synthetic invitation is rebound to an existing, differently
# addressed confirmed account. Never print its synthetic bearer or JWT.
member2='40000000-0000-4000-8000-000000000097';source2='20000000-0000-4000-8000-000000000097';mail2='notregistered-0802@example.test'
sql="INSERT INTO public.player_profiles(id,display_name) VALUES('%s','別の仮選手'); INSERT INTO public.club_members(id,club_id,player_profile_id,role) VALUES('%s','%s','%s','member');"%(source2,member2,club,source2)
r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr
status,checked=http(R,'/rpc/check_club_invite_account',{'p_club':club,'p_member':member2,'p_email':mail2},mgr_token);assert status==200 and checked.get('status')=='signup_required',(status,checked)
args2={'p_actor':mgr,'p_club':club,'p_member':member2,'p_operation_id':str(uuid.uuid4()),'p_ticket':checked['ticket'],'p_email':mail2}
sent2=node({'mode':'send','service':service,'args':args2});assert re.fullmatch('[0-9a-f]{64}',sent2['secret'])
status,session2=login('recipient-0802@example.test');assert status==200;token2=session2['access_token']
link={'p_invite':sent2['invite'],'p_generation':sent2['generation'],'p_secret':sent2['secret']}
status,pv=http(R,'/rpc/preview_club_invite_rebind',link,token2);assert status==200 and pv.get('status')=='ok',(status,pv.get('status'))
bind={'p_operation_id':str(uuid.uuid4()),**link,'p_consent':False,'p_account_review_token':pv['account_review_token']}
status,denied=http(R,'/rpc/rebind_club_invite',bind,token2);assert status==200 and denied.get('status')!='rebound',(status,denied)
bind['p_consent']=True;status,success=http(R,'/rpc/rebind_club_invite',bind,token2);assert status==200 and success.get('status')=='rebound',(status,success)
status,stale=http(R,'/rpc/preview_club_invite_rebind',link,token2);assert status==200 and stale.get('status')=='not_found',(status,stale)
result=node({'mode':'accept','token':token2,'other':out_token,'invite':sent2['invite'],'operation':str(uuid.uuid4())});assert result['status']=='approved'
print('PASS local Auth/PostgREST different-email rebind requires consent, invalidates old link, then separate app consent',flush=True)
