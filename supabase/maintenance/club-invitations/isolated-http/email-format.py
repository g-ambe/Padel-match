"""Synthetic invite format and pre-quota checks; no real email."""
from pathlib import Path
H=Path(__file__).parent
exec((H/'auth-check.py').read_text().split("args={'p_club':club")[0])
exec((H/'unregistered.py').read_text().split("status,d=http(R,'/rpc/reserve_club_invite_send'")[0])
def db(sql):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr;return r.stdout.strip()
valid=['a@example.com','First.Last+tag@example.co.jp','user@xn--e1afmkfd.xn--p1ai']
invalid=['利用者@example.com','a@例え.jp','a..b@example.com','.a@example.com','a@example..com','a@-test.com','a@test-.com','a@localhost','a b@example.com','a'*65+'@example.com','a@'+'x'*64+'.com']
for address in valid+invalid:
 quoted=address.replace("'","''");result=db("SELECT club_invite_private.supported_delivery_email('%s')"%quoted)
 assert result==('t' if address in valid else 'f'),(address,result)
assert db("SELECT club_invite_private.normalize_email('利用者@example.com')")=='利用者@example.com'
before=db("SELECT (SELECT count(*) FROM club_invite_private.lookup_limits)||'|'||(SELECT count(*) FROM club_invite_private.send_attempts)")
for address in invalid:
 status,result=http(R,'/rpc/check_club_invite_account',{'p_club':club,'p_member':member,'p_email':address},mgr_token);assert status==200 and result.get('status')=='invalid',(status,result)
assert db("SELECT (SELECT count(*) FROM club_invite_private.lookup_limits)||'|'||(SELECT count(*) FROM club_invite_private.send_attempts)")==before
bad=dict(args,p_email='利用者@example.com');status,result=http(R,'/rpc/reserve_club_invite_send',bad,service);assert status==200 and result.get('status')=='invalid',(status,result)
assert db('SELECT count(*) FROM club_invite_private.send_attempts')=='0'
puny='user@xn--e1afmkfd.xn--p1ai';status,result=http(R,'/rpc/check_club_invite_account',{'p_club':club,'p_member':member,'p_email':puny},mgr_token);assert status==200 and result.get('status')=='signup_required',(status,result)
request=dict(args,p_email=puny,p_ticket=result['ticket'],p_operation_id=str(uuid.uuid4()));status,result=http(R,'/rpc/reserve_club_invite_send',request,service);assert status==200 and result.get('status')=='reserved',(status,result)
status,result=http(R,'/rpc/claim_club_invite_send',{'p_operation_id':request['p_operation_id']},service);assert status==200 and result.get('status')=='claimed' and result.get('email')==puny
# Synthetic legacy unsupported address: resend must not reserve or use quota.
invite_id=db("SELECT id::text FROM club_invite_private.invitations WHERE member_id='%s' ORDER BY created_at DESC LIMIT 1"%member)
db("UPDATE club_invite_private.send_attempts SET status='failed',finished_at=clock_timestamp(),failure_code='pre_data_failure' WHERE operation_id='%s'; UPDATE club_invite_private.invitations SET email_ciphertext=club_invite_private.encrypt_email('利用者@example.com'),email_digest=club_invite_private.email_hmac('利用者@example.com') WHERE id='%s';"%(request['p_operation_id'],invite_id))
count=db('SELECT count(*) FROM club_invite_private.send_attempts')
resend={'p_actor':mgr,'p_mode':'manager','p_invite':invite_id,'p_generation':1,'p_operation_id':str(uuid.uuid4()),'p_kind':'group_invite','p_secret':None,'p_ip_digest':None}
status,result=http(R,'/rpc/reserve_club_invite_resend',resend,service);assert status==200 and result.get('status')!='reserved',(status,result)
assert db('SELECT count(*) FROM club_invite_private.send_attempts')==count
uid=signup(puny);confirm(puny);status,session=login(puny);assert status==200 and session.get('access_token')
print('PASS ASCII/Punycode, malformed rejection before lookup/send quota, existing normalization, Punycode reservation/claim, legacy unsupported resend denial and local Auth signup/login',flush=True)
