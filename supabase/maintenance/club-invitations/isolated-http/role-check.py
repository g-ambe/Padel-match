from pathlib import Path
exec((Path(__file__).parent/'auth-check.py').read_text().split("manager='manager-0802@example.test'")[0])
_,s=login('manager-0802@example.test');token=s['access_token'];mgr=s['user']['id'];club='30000000-0000-4000-8000-000000000001'; member='40000000-0000-4000-8000-000000000088';src='20000000-0000-4000-8000-000000000088'
sql="INSERT INTO public.player_profiles(id,display_name) VALUES('%s','仮');INSERT INTO public.club_members(id,club_id,player_profile_id,role) VALUES('%s','%s','%s','member');"%(src,member,club,src)
r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr
args={'p_club':club,'p_member':member,'p_email':'scope0802@example.test'}
status,d=http(R,'/rpc/check_club_invite_account',args,token);assert status==200 and d.get('status')=='signup_required',(status,d)
sql="UPDATE public.club_members SET role='member' WHERE club_id='%s' AND profile_id='%s';"%(club,mgr)
r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr
status,d=http(R,'/rpc/check_club_invite_account',args,token);assert status==200 and d.get('status')=='not_found',(status,d)
print('PASS actual JWT / PostgREST denies manager check after role demotion')
