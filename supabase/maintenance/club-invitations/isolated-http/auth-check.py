import subprocess,json,re,urllib.parse,time,uuid,hmac,hashlib,base64,os
D=os.environ['TASK0802_DB']
def http(host,path,data=None,token=None):
 assert host in (A,R,M) and path.startswith('/')
 cmd=['docker','--host=unix:///var/run/docker.sock','exec','-e','http_proxy=','-e','https_proxy=','-e','HTTP_PROXY=','-e','HTTPS_PROXY=','-e','ALL_PROXY=','-e','all_proxy=',D,'wget','-S','-O','-','-T','10']
 if token:cmd+=['--header=Authorization: Bearer '+token]
 if data is not None:cmd+=['--header=Content-Type: application/json','--post-data='+json.dumps(data)]
 cmd+=['http://'+host+path]
 r=subprocess.run(cmd,capture_output=True,text=True,timeout=15);codes=re.findall(r'HTTP/\S+\s+(\d+)',r.stderr);status=int(codes[-1]) if codes else 0
 try:body=json.loads(r.stdout)
 except:body={}
 return status,body
A=os.environ['TASK0802_AUTH']+':9999';R=os.environ['TASK0802_REST']+':3000';M=os.environ['TASK0802_MAIL']+':8025'; pw='syntheticPass123!'
def signup(email):
 status,data=http(A,'/signup',{'email':email,'password':pw});assert status==200,(status,data);return data['id']
def confirm(email):
 status,d=http(M,'/api/v1/messages');assert status==200
 mid=next(x['ID'] for x in d['messages'] if any(t['Address']==email for t in x['To']))
 _,msg=http(M,'/api/v1/message/'+mid)
 link=re.search(r'http://127\.0\.0\.1:18080/verify\?[^"\s<]+',msg['HTML']).group(0).replace('&amp;','&')
 qs=urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
 status,out=http(A,'/verify',{'type':'signup','token_hash':qs['token'][0]});assert status==200,(status,out)
def login(email): return http(A,'/token?grant_type=password',{'email':email,'password':pw})
manager='manager-0802@example.test';recipient='recipient-0802@example.test';outsider='outsider-0802@example.test';unconfirmed='pending-0802@example.test'
ids={}
for e in [manager,recipient,outsider,unconfirmed]:ids[e]=signup(e)
status,_=login(unconfirmed);assert status in (400,401,403),status;print('PASS unconfirmed cannot password login')
for e in [manager,recipient,outsider]:confirm(e)
tokens={}
for e in [manager,recipient,outsider]:
 status,data=login(e);assert status==200 and data.get('access_token'),(e,status);tokens[e]=data['access_token']
print('PASS real GoTrue signup / Mailpit confirmation / login for three users')
for v in ids.values():assert re.fullmatch('[a-f0-9-]{36}',v)
club='30000000-0000-4000-8000-000000000001';member='40000000-0000-4000-8000-000000000002';src='20000000-0000-4000-8000-000000000003'
sql="""INSERT INTO public.profiles(id,display_name,email) VALUES {profiles};
INSERT INTO public.player_profiles(id,linked_auth_user_id,display_name) VALUES ('20000000-0000-4000-8000-000000000001','{mgr}','管理者'),('20000000-0000-4000-8000-000000000002','{rec}','本人'),('20000000-0000-4000-8000-000000000004','{out}','第三者'),('{src}',NULL,'仮選手');
INSERT INTO public.clubs(id,name,owner_id,visibility) VALUES ('{club}','架空A','{mgr}','public');
INSERT INTO public.club_members(id,club_id,profile_id,player_profile_id,role) VALUES ('40000000-0000-4000-8000-000000000001','{club}','{mgr}','20000000-0000-4000-8000-000000000001','main_admin'),('{member}','{club}',NULL,'{src}','member');""".format(profiles=','.join("('%s','架空利用者','%s')"%(ids[e],e) for e in ids),mgr=ids[manager],rec=ids[recipient],out=ids[outsider],src=src,club=club,member=member)
r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr
args={'p_club':club,'p_member':member,'p_email':recipient}
status,d=http(R,'/rpc/check_club_invite_account',args);assert status in (401,403),status;print('PASS anonymous RPC denied',status)
status,d=http(R,'/rpc/check_club_invite_account',args,tokens[outsider]);assert status==200 and d.get('status')=='not_found',(status,d);print('PASS outsider check denied')
status,d=http(R,'/rpc/check_club_invite_account',args,tokens[manager]);assert status==200 and d.get('status')=='registered',(status,d);ticket=d['ticket'];print('PASS manager authenticated registered classification')
args={'p_club':club,'p_member':member,'p_email':recipient,'p_ticket':ticket,'p_operation_id':str(uuid.uuid4()),'p_confirm_registered':True}
status,d=http(R,'/rpc/consume_club_invite_lookup',args,tokens[manager]);assert status==200 and d.get('status')=='requested',(status,d);link=d['link_id'];print('PASS PostgREST registered link request')
status,d=http(R,'/rpc/get_player_profile_link_request',{'p_request_id':link},tokens[recipient]);assert status==200 and d.get('review_token'),(status,d);review=d['review_token']
args={'p_request_id':link,'p_review_token':review,'p_club_display_name':'架空本人','p_expected_club_display_name':None,'p_public_confirmation':True}
status,d=http(R,'/rpc/review_player_profile_link_named',args,tokens[outsider]);assert status>=400 or d.get('status') not in ('approved',),(status,d);print('PASS outsider approval refused',status)
status,d=http(R,'/rpc/review_player_profile_link_named',args,tokens[recipient]);assert status==200 and d.get('status')=='approved',(status,d);print('PASS recipient named consent / real JWT / PostgREST approval')
