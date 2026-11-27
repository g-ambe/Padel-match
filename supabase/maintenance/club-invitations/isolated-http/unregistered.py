from pathlib import Path
exec((Path(__file__).parent/'auth-check.py').read_text().split("manager='manager-0802@example.test'")[0])
status,session=login('manager-0802@example.test');assert status==200;mgr_token=session['access_token'];mgr=session['user']['id']
status,session=login('outsider-0802@example.test');assert status==200;out_token=session['access_token']
club='30000000-0000-4000-8000-000000000001';member='40000000-0000-4000-8000-000000000099';source='20000000-0000-4000-8000-000000000099';mail='new-http-0802@example.test'
sql="INSERT INTO public.player_profiles(id,display_name) VALUES('%s','未連携'); INSERT INTO public.club_members(id,club_id,player_profile_id,role) VALUES('%s','%s','%s','member');"%(source,member,club,source)
r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr
status,d=http(R,'/rpc/check_club_invite_account',{'p_club':club,'p_member':member,'p_email':mail},mgr_token);assert status==200 and d.get('status')=='signup_required',(status,d);ticket=d['ticket']
def enc(b):return base64.urlsafe_b64encode(b).rstrip(b'=')
h=enc(json.dumps({'alg':'HS256','typ':'JWT'}).encode());p=enc(json.dumps({'role':'service_role','iss':'local','iat':int(time.time()),'exp':int(time.time())+600}).encode());sig=enc(hmac.new(b'local-only-fake-jwt-secret-0123456789abcdef',h+b'.'+p,hashlib.sha256).digest());service=(h+b'.'+p+b'.'+sig).decode();op=str(uuid.uuid4())
args={'p_actor':mgr,'p_club':club,'p_member':member,'p_operation_id':op,'p_ticket':ticket,'p_email':mail}
status,d=http(R,'/rpc/reserve_club_invite_send',args,out_token);assert status in (401,403),status
status,d=http(R,'/rpc/reserve_club_invite_send',args,service);assert status==200 and d.get('status')=='reserved',(status,d);inv=d['invite_id'];gen=d['generation']
status,d=http(R,'/rpc/claim_club_invite_send',{'p_operation_id':op},service);assert status==200 and d.get('status')=='claimed',(status,d)
status,d=http(R,'/rpc/finalize_club_invite_send',{'p_operation_id':op,'p_generation':gen,'p_result':'sent','p_failure_code':None},service);assert status==200 and d.get('status')=='sent',(status,d)
uid=signup(mail);status,_=login(mail);assert status in (400,401,403),status
confirm(mail);status,s=login(mail);assert status==200;token=s['access_token']
assert re.fullmatch('[a-f0-9-]{36}',uid)
sql="INSERT INTO public.profiles(id,display_name,email) VALUES('%s','本人','%s'); INSERT INTO public.player_profiles(id,linked_auth_user_id,display_name) VALUES('20000000-0000-4000-8000-000000000098','%s','本人');"%(uid,mail,uid)
r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr
status,d=http(R,'/rpc/preview_my_club_invite',{'p_invite':inv,'p_generation':gen},out_token);assert status==200 and d.get('status')=='not_found',(status,d)
status,d=http(R,'/rpc/preview_my_club_invite',{'p_invite':inv,'p_generation':gen},token);assert status==200 and d.get('status')=='ok',(status,d)
args={'p_invite':inv,'p_generation':gen,'p_operation_id':str(uuid.uuid4()),'p_review_token':d['review_token'],'p_expected_club_display_name':d.get('group_display_name_current'),'p_expected_visibility':d['group_visibility'],'p_club_display_name':'新規本人','p_public_confirmation':True,'p_inheritance_consent':True}
status,d=http(R,'/rpc/accept_my_club_invite',args,token);assert status==200 and d.get('status')=='approved',(status,d)
print('PASS service role restriction and mock reserve/claim/finalize; unconfirmed login denied; confirmation, outsider deny and recipient accept via real JWT/PostgREST')
