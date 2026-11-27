"""Existing public join flow through real JWT and PostgREST."""
from pathlib import Path
exec((Path(__file__).parent/'auth-check.py').read_text().split("manager='manager-0802@example.test'")[0])
_,mgr=login('manager-0802@example.test');_,outsider=login('outsider-0802@example.test');club='30000000-0000-4000-8000-000000000001'
args={'p_club_id':club,'p_reference':None,'p_message':None,'p_review_token':None,'p_club_display_name':'架空加入者','p_public_confirmation':True}
status,request=http(R,'/rpc/submit_public_club_claim_named',args,outsider['access_token']);assert status==200 and isinstance(request,str),(status,request)
status,result=http(R,'/rpc/review_profile_join_request',{'p_request_id':request,'p_decision':'approved'},mgr['access_token']);assert status==200 and result.get('status')=='approved',(status,result)
uid=outsider['user']['id']; assert re.fullmatch('[a-f0-9-]{36}',uid)
sql="SELECT (SELECT count(*) FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=cm.player_profile_id WHERE cm.club_id='%s' AND pp.linked_auth_user_id='%s' AND cm.is_active) || '|' || (SELECT count(*) FROM public.notifications WHERE related_join_request_id='%s');"%(club,uid,request)
r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-c',sql],capture_output=True,text=True);assert r.returncode==0,r.stderr
member_count,notice_count=map(int,r.stdout.strip().split('|')); assert member_count==1 and notice_count>=1,(member_count,notice_count)
print('PASS existing public join named request / manager approval / membership / notification via real JWT')
