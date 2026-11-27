"""Revision 06 operational guard tests against the local Auth/PostgREST stack."""
from pathlib import Path
exec((Path(__file__).parent/'auth-check.py').read_text().split("manager='manager-0802@example.test'")[0])
import concurrent.futures

def db(sql):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr[-1600:])
 return r.stdout.strip()
# Independent fixed windows and fail-closed controls; all digests are synthetic.
db("""BEGIN;
DO $$ DECLARE d bytea:=decode(repeat('55',32),'hex'); t timestamptz:=clock_timestamp(); b boolean; i int; BEGIN
 FOR i IN 1..10 LOOP IF NOT club_invite_private.take_anonymous_limit('ip',d,t) THEN RAISE EXCEPTION 'early ip';END IF;END LOOP;
 IF club_invite_private.take_anonymous_limit('ip',d,t) THEN RAISE EXCEPTION 'ip >10';END IF;
 FOR i IN 1..3 LOOP IF NOT club_invite_private.take_anonymous_limit('invite',d,t) THEN RAISE EXCEPTION 'early ref';END IF;END LOOP;
 IF club_invite_private.take_anonymous_limit('invite',d,t) THEN RAISE EXCEPTION 'ref >3';END IF;
 IF NOT club_invite_private.take_anonymous_limit('ip',d,t+interval '10 minutes') THEN RAISE EXCEPTION 'window rollover';END IF;
 UPDATE club_invite_private.settings SET anonymous_ip_10m_limit=NULL WHERE singleton;
 IF club_invite_private.take_anonymous_limit('ip',d,t+interval '11 minutes') THEN RAISE EXCEPTION 'null not closed'; END IF;
 END $$; ROLLBACK;""")
print('PASS anonymous fixed windows 10/IP, 3/invite, boundary and null fail-closed')
# Actual concurrent PostgreSQL sessions; each statement commits independently.
def attempt(_): return db("SELECT club_invite_private.take_anonymous_limit('ip',decode(repeat('66',32),'hex'),clock_timestamp())")
with concurrent.futures.ThreadPoolExecutor(max_workers=15) as p: results=list(p.map(attempt,range(15)))
assert results.count('t')==10 and results.count('f')==5,results
print('PASS anonymous 15 parallel calls: 10 accepted, 5 denied')
_,s=login('manager-0802@example.test');mgr=s['user']['id'];token=s['access_token']
club='30000000-0000-4000-8000-000000000001';member='40000000-0000-4000-8000-000000000077';src='20000000-0000-4000-8000-000000000077';mail='quota-test@example.test'
db("INSERT INTO public.player_profiles(id,display_name) VALUES('%s','仮'); INSERT INTO public.club_members(id,club_id,player_profile_id,role) VALUES('%s','%s','%s','member');"%(src,member,club,src))
status,d=http(R,'/rpc/check_club_invite_account',{'p_club':club,'p_member':member,'p_email':mail},token);assert status==200 and d.get('status')=='signup_required',(status,d);ticket=d['ticket']
# A separate group has synthetic records with the same email HMAC: destination-wide cooldown.
db("""DO $$ DECLARE inv uuid:=gen_random_uuid();dg bytea:=club_invite_private.email_hmac('quota-test@example.test');g uuid:=gen_random_uuid();m uuid:=gen_random_uuid();u uuid:=gen_random_uuid();BEGIN
 INSERT INTO club_invite_private.invitations(id,club_id,member_id,source_profile_id,inviter_auth_id,email_digest,generation,created_at,expires_at) VALUES(inv,g,m,gen_random_uuid(),u,dg,1,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day');
 INSERT INTO club_invite_private.send_attempts(operation_id,invite_id,club_id,member_id,quota_manager_id,email_digest,generation,actor_kind,reserved_at,day_jst,status,finished_at,kind,request_digest,actor_binding_digest,request_kind,reservation_auth_kind,reservation_actor_auth_id) VALUES(gen_random_uuid(),inv,g,m,u,dg,1,'manager',clock_timestamp(),(clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date,'failed',clock_timestamp(),'auth_confirmation',dg,dg,'auth_resend','manager',u);
 END $$;""")
status,view=http(R,'/rpc/get_club_invite_status',{'p_club':club,'p_member':member},token);assert status==200 and view.get('status')=='none' and view.get('member_attempts_today')==0,(status,view)
def enc(b):return base64.urlsafe_b64encode(b).rstrip(b'=')
h=enc(json.dumps({'alg':'HS256','typ':'JWT'}).encode());p=enc(json.dumps({'role':'service_role','iat':int(time.time()),'exp':int(time.time())+600}).encode());service=(h+b'.'+p+b'.'+enc(hmac.new(b'local-only-fake-jwt-secret-0123456789abcdef',h+b'.'+p,hashlib.sha256).digest())).decode()
args={'p_actor':mgr,'p_club':club,'p_member':member,'p_operation_id':str(uuid.uuid4()),'p_ticket':ticket,'p_email':mail}
status,denial=http(R,'/rpc/reserve_club_invite_send',args,service);assert status==200 and denial=={'status':'temporarily_unavailable'},(status,denial)
print('PASS separate-group same-email activity hidden in own status; reserve uses neutral response')
invalid={'p_actor':None,'p_mode':'bearer','p_invite':str(uuid.uuid4()),'p_generation':1,'p_operation_id':str(uuid.uuid4()),'p_kind':'group_invite','p_secret':'f'*64,'p_ip_digest':'\\x'+'77'*32}
status,denial=http(R,'/rpc/reserve_club_invite_resend',invalid,service);assert status==200 and denial.get('status')=='not_found',(status,denial)
print('PASS invalid bearer returns neutral not_found via PostgREST')
# Two legitimate, independently checked provisional members race to reserve
# the same destination; shared destination quota/in-flight must prevent both.
race_mail='parallel-0802@example.test';members=['40000000-0000-4000-8000-000000000071','40000000-0000-4000-8000-000000000072'];sources=['20000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000072']
for m,s in zip(members,sources):
 db("INSERT INTO public.player_profiles(id,display_name) VALUES('%s','並行'); INSERT INTO public.club_members(id,club_id,player_profile_id,role) VALUES('%s','%s','%s','member');"%(s,m,club,s))
requests=[]
for m in members:
 status,d=http(R,'/rpc/check_club_invite_account',{'p_club':club,'p_member':m,'p_email':race_mail},token);assert status==200 and d.get('status')=='signup_required',(status,d)
 requests.append({'p_actor':mgr,'p_club':club,'p_member':m,'p_operation_id':str(uuid.uuid4()),'p_ticket':d['ticket'],'p_email':race_mail})
def reserve(req):
 status,d=http(R,'/rpc/reserve_club_invite_send',req,service);assert status==200,(status,d);return d.get('status')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(reserve,requests))
assert sorted(results)==['reserved','temporarily_unavailable'],results
print('PASS two concurrent PostgREST reservations for same recipient: one reserved')
