"""Synthetic same-address cancellation/expiry followed by explicit re-invitation."""
from pathlib import Path
exec((Path(__file__).parent/'auth-check.py').read_text().split("manager='manager-0802@example.test'")[0])
_,mgr_s=login('manager-0802@example.test');mgr=mgr_s['user']['id'];token=mgr_s['access_token'];club='30000000-0000-4000-8000-000000000001';member='40000000-0000-4000-8000-000000000065';source='20000000-0000-4000-8000-000000000065';email='reinvite@example.test'
def db(sql):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr;return r.stdout.strip()
def enc(b):return base64.urlsafe_b64encode(b).rstrip(b'=')
h=enc(json.dumps({'alg':'HS256','typ':'JWT'}).encode());p=enc(json.dumps({'role':'service_role','iat':int(time.time()),'exp':int(time.time())+600}).encode());service=(h+b'.'+p+b'.'+enc(hmac.new(b'local-only-fake-jwt-secret-0123456789abcdef',h+b'.'+p,hashlib.sha256).digest())).decode()
db("INSERT INTO public.player_profiles(id,display_name) VALUES('%s','再招待仮');INSERT INTO public.club_members(id,club_id,player_profile_id,role) VALUES('%s','%s','%s','member');"%(source,member,club,source))
def check():
 status,d=http(R,'/rpc/check_club_invite_account',{'p_club':club,'p_member':member,'p_email':email},token);assert status==200 and d.get('status')=='signup_required',(status,d);return d['ticket']
def reserve(ticket):
 op=str(uuid.uuid4());args={'p_actor':mgr,'p_club':club,'p_member':member,'p_operation_id':op,'p_ticket':ticket,'p_email':email}
 status,d=http(R,'/rpc/reserve_club_invite_send',args,service);assert status==200 and d.get('status')=='reserved',(status,d);return op,d['invite_id'],d['generation']
def advance_attempts():db("UPDATE club_invite_private.send_attempts SET reserved_at=statement_timestamp()-interval '2 minutes',day_jst=((statement_timestamp()-interval '2 minutes') AT TIME ZONE 'Asia/Tokyo')::date WHERE member_id='%s';"%member)
ticket1=check();op1,inv1,g1=reserve(ticket1);status,d=http(R,'/rpc/claim_club_invite_send',{'p_operation_id':op1},service);assert status==200 and d.get('status')=='claimed',(status,d);secret1=d['secret'];status,d=http(R,'/rpc/finalize_club_invite_send',{'p_operation_id':op1,'p_generation':g1,'p_result':'sent','p_failure_code':None},service);assert d.get('status')=='sent',(status,d)
status,d=http(R,'/rpc/cancel_club_invite',{'p_invite':inv1,'p_generation':g1},token);assert d.get('status')=='cancelled',(status,d)
advance_attempts();ticket2=check();assert ticket2!=ticket1;op2,inv2,g2=reserve(ticket2);assert inv2!=inv1
_,other=login('outsider-0802@example.test');status,d=http(R,'/rpc/preview_club_invite_rebind',{'p_invite':inv1,'p_generation':g1,'p_secret':secret1},other['access_token']);assert status==200 and d.get('status')=='not_found',(status,d)
db("UPDATE club_invite_private.invitations SET created_at=statement_timestamp()-interval '9 days',expires_at=statement_timestamp()-interval '2 days' WHERE id='%s';"%inv2)
advance_attempts();ticket3=check();assert ticket3 not in (ticket1,ticket2);op3,inv3,g3=reserve(ticket3);assert inv3 not in (inv1,inv2)
count=db("SELECT count(*) FROM club_invite_private.send_attempts WHERE member_id='%s';"%member);assert count=='3',count
print('PASS same-address cancel/expired -> fresh ticket/invitation; old bearer denied; 3 quota attempts retained')
