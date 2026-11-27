"""Registered invitation: add other-club history after preview, before approval."""
from pathlib import Path
exec((Path(__file__).parent/'auth-check.py').read_text().split("manager='manager-0802@example.test'")[0])
_,mgr=login('manager-0802@example.test');_,recipient=login('recipient-0802@example.test');club='30000000-0000-4000-8000-000000000090';member='40000000-0000-4000-8000-000000000090';source='20000000-0000-4000-8000-000000000090';other='30000000-0000-4000-8000-000000000001'
def db(sql):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True);assert r.returncode==0,r.stderr;return r.stdout.strip()
uid=mgr['user']['id'];assert re.fullmatch('[a-f0-9-]{36}',uid)
db("INSERT INTO public.clubs(id,name,owner_id,visibility) VALUES('%s','架空対象','%s','public'); INSERT INTO public.player_profiles(id,display_name) VALUES('%s','仮対象'); INSERT INTO public.club_members(id,club_id,profile_id,player_profile_id,role) VALUES('40000000-0000-4000-8000-000000000091','%s','%s','20000000-0000-4000-8000-000000000001','main_admin'),('%s','%s',NULL,'%s','member');"%(club,uid,source,club,uid,member,club,source))
args={'p_club':club,'p_member':member,'p_email':'recipient-0802@example.test'};status,d=http(R,'/rpc/check_club_invite_account',args,mgr['access_token']);assert status==200 and d.get('status')=='registered',(status,d)
args.update({'p_ticket':d['ticket'],'p_operation_id':str(uuid.uuid4()),'p_confirm_registered':True});status,d=http(R,'/rpc/consume_club_invite_lookup',args,mgr['access_token']);assert status==200 and d.get('status')=='requested',(status,d);link=d['link_id']
status,d=http(R,'/rpc/get_player_profile_link_request',{'p_request_id':link},recipient['access_token']);assert status==200 and d.get('review_token'),(status,d);review=d['review_token']
db("INSERT INTO public.events(id,club_id,name,court_count) VALUES('50000000-0000-4000-8000-000000000090','%s','別グループ',1);INSERT INTO public.event_participants(event_id,player_profile_id,status,participant_type) VALUES('50000000-0000-4000-8000-000000000090','%s','active','member');"%(other,source))
args={'p_request_id':link,'p_review_token':review,'p_club_display_name':'本人','p_expected_club_display_name':None,'p_public_confirmation':True};status,d=http(R,'/rpc/review_player_profile_link_named',args,recipient['access_token']);assert status>=400 or d.get('status')!='approved',(status,d)
counts=db("SELECT (SELECT count(*) FROM public.player_profile_merges WHERE source_player_profile_id='%s')||'|'||(SELECT count(*) FROM public.club_members WHERE id='%s' AND player_profile_id='%s');"%(source,member,source));assert counts=='0|1',counts
print('PASS real JWT registered approval refused after other-club history was added; source remains')
