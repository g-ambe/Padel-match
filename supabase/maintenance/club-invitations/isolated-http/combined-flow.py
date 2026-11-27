"""Synthetic two-group invitations, acceptance/rejection and cancellation/reinvite."""
from pathlib import Path
H=Path(__file__).parent
exec((H/'auth-check.py').read_text().split("args={'p_club':club")[0])
exec((H/'unregistered.py').read_text().split("status,d=http(R,'/rpc/reserve_club_invite_send'")[0])
def db(sql):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr;return r.stdout.strip()
def node(body):
 body.update({'container':D,'rest':R,'auth':A});env=dict(os.environ,NODE_PATH=str(H.resolve().parents[3]/'node_modules'))
 r=subprocess.run(['node',str(H/'app-flow.cjs')],input=json.dumps(body),text=True,capture_output=True,env=env);assert r.returncode==0,r.stderr[-1500:];return json.loads(r.stdout)
club2='30000000-0000-4000-8000-000000000071';member2='40000000-0000-4000-8000-000000000071';source2='20000000-0000-4000-8000-000000000071'
db("INSERT INTO public.clubs(id,name,owner_id,visibility) VALUES('%s','架空B','%s','public'); INSERT INTO public.player_profiles(id,display_name) VALUES('%s','仮B'); INSERT INTO public.club_members(id,club_id,profile_id,player_profile_id,role) VALUES('%s','%s','%s','20000000-0000-4000-8000-000000000001','main_admin'),('%s','%s',NULL,'%s','member');"%(club2,mgr,source2,'40000000-0000-4000-8000-000000000070',club2,mgr,member2,club2,source2))
first=node({'mode':'route','service':service,'token':mgr_token,'args':args})
# Advance only the synthetic cooldown so two groups can invite the same address.
db("UPDATE club_invite_private.send_attempts SET reserved_at=clock_timestamp()-interval '61 seconds' WHERE invite_id='%s';"%first['invite'])
status,checked=http(R,'/rpc/check_club_invite_account',{'p_club':club2,'p_member':member2,'p_email':mail},mgr_token);assert status==200 and checked.get('status')=='signup_required'
args2={'p_actor':mgr,'p_club':club2,'p_member':member2,'p_operation_id':str(uuid.uuid4()),'p_ticket':checked['ticket'],'p_email':mail}
second=node({'mode':'route','service':service,'token':mgr_token,'args':args2});assert first['invite']!=second['invite']
uid=signup(mail);confirm(mail);status,session=login(mail);assert status==200;token=session['access_token']
db("INSERT INTO public.profiles(id,display_name,email) VALUES('%s','架空本人','%s'); INSERT INTO public.player_profiles(id,linked_auth_user_id,display_name) VALUES('20000000-0000-4000-8000-000000000098','%s','架空本人');"%(uid,mail,uid))
status,lst=http(R,'/rpc/list_my_club_invites',{},token);assert status==200 and {x['invite_id'] for x in lst['invitations']}=={first['invite'],second['invite']}
status,bad=http(R,'/rpc/reject_my_club_invite',{'p_invite':second['invite'],'p_generation':second['generation'],'p_operation_id':str(uuid.uuid4())},out_token);assert status==200 and bad.get('status')!='rejected'
status,rejected=http(R,'/rpc/reject_my_club_invite',{'p_invite':second['invite'],'p_generation':second['generation'],'p_operation_id':str(uuid.uuid4())},token);assert status==200 and rejected.get('status')=='rejected'
result=node({'mode':'accept','token':token,'other':out_token,'invite':first['invite'],'operation':str(uuid.uuid4())});assert result['status']=='approved'
status,one=http(R,'/rpc/get_club_invite_status',{'p_club':club,'p_member':member},mgr_token);status,two=http(R,'/rpc/get_club_invite_status',{'p_club':club2,'p_member':member2},mgr_token)
assert one['status']=='approved' and two['status']=='rejected';assert one['delivery_status']=='sent' and two['delivery_status']=='sent'
assert db("SELECT score_a||','||score_b||','||winner_team FROM public.match_results WHERE match_id='52000000-0000-4000-8000-000000000098';")=='6,3,A'
assert db("SELECT player_profile_id::text FROM public.club_members WHERE id='%s';"%member2)==source2
print('PASS two real-auth invites / outsider deny / independent reject and accept / delivery status / scores and other membership',flush=True)
# Reuse the separate synthetic cancellation/expiry/reinvite fixture in this same isolated stack.
exec((H/'reinvite.py').read_text())
