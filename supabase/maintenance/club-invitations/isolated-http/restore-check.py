"""Exercise existing reviewed restore SQL only inside the disposable local DB."""
from pathlib import Path
exec((Path(__file__).parent/'auth-check.py').read_text().split("manager='manager-0802@example.test'")[0])
ROOT=Path(__file__).resolve().parents[3]
def db(sql,expect=True):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','VERBOSITY=verbose','-v','ON_ERROR_STOP=1','-f','-'],input=sql,text=True,capture_output=True)
 if expect and r.returncode: raise RuntimeError(r.stderr[-2000:])
 return r
_,mgr=login('manager-0802@example.test');_,rec=login('recipient-0802@example.test');uid=mgr['user']['id'];target=rec['user']['id'];c='30000000-0000-4000-8000-000000000066';m='40000000-0000-4000-8000-000000000066';src='20000000-0000-4000-8000-000000000066'
db("INSERT INTO public.clubs(id,name,owner_id,visibility) VALUES('%s','復元用','%s','public');INSERT INTO public.player_profiles(id,display_name) VALUES('%s','復元元');INSERT INTO public.club_members(id,club_id,profile_id,player_profile_id,role) VALUES('40000000-0000-4000-8000-000000000067','%s','%s','20000000-0000-4000-8000-000000000001','main_admin'),('%s','%s',NULL,'%s','member');"%(c,uid,src,c,uid,m,c,src))
db("INSERT INTO public.events(id,club_id,name,court_count) VALUES('50000000-0000-4000-8000-000000000066','%s','架空直接試合',1); INSERT INTO public.event_participants(id,event_id,player_profile_id,status,participant_type) VALUES('51000000-0000-4000-8000-000000000066','50000000-0000-4000-8000-000000000066','%s','active','member'); INSERT INTO public.matches(id,event_id,court_number,completed) VALUES('52000000-0000-4000-8000-000000000066','50000000-0000-4000-8000-000000000066',1,true); INSERT INTO public.match_players(match_id,participant_id,team) VALUES('52000000-0000-4000-8000-000000000066','51000000-0000-4000-8000-000000000066','A'); INSERT INTO public.match_results(match_id,score_a,score_b,winner_team) VALUES('52000000-0000-4000-8000-000000000066',5,2,'A');"%(c,src))
status,link=http(R,'/rpc/request_player_profile_link',{'p_club_id':c,'p_member_id':m,'p_target_auth_user_id':target},mgr['access_token']);assert status==200 and isinstance(link,str),(status,link)
status,pv=http(R,'/rpc/get_player_profile_link_request',{'p_request_id':link},rec['access_token']);assert status==200 and pv.get('review_token'),(status,pv)
status,out=http(R,'/rpc/review_player_profile_link_named',{'p_request_id':link,'p_review_token':pv['review_token'],'p_club_display_name':'復元本人','p_expected_club_display_name':None,'p_public_confirmation':True},rec['access_token']);assert status==200 and out.get('status')=='approved',(status,out)
path=ROOT/'maintenance/profile-linking/04_restore_reviewed_merge.sql';original=path.read_text();assert original.count('rollback;')==1;assert original.count('-- 復旧対象挿入位置')==1
# A test-only copy selects one synthetic ID and commits. Source remains unchanged.
def restore(merge):
 assert re.fullmatch('[a-f0-9-]{36}',merge)
 return original.replace('-- 復旧対象挿入位置',"INSERT INTO reviewed_merge_restore VALUES ('"+merge+"');").replace('rollback;','commit;')
def one(sql):return db(sql).stdout.strip()
direct=out['merge_id'];inv=one("SELECT m.id FROM public.player_profile_merges m JOIN auth.users u ON u.id=m.target_auth_user_id WHERE u.email='new-http-0802@example.test' AND m.restored_at IS NULL;");assert re.fullmatch('[a-f0-9-]{36}',inv)
# Edited audited source row must be rejected, without clearing audit or undoing edits.
db("UPDATE public.player_profiles SET bio='temporary-change' WHERE id='%s';"%src)
r=db(restore(direct),False);assert r.returncode and '編集・削除' in r.stderr,(r.returncode,r.stderr[-600:]);assert one("SELECT bio FROM public.player_profiles WHERE id='%s';"%src)=='temporary-change';db("UPDATE public.player_profiles SET bio=NULL WHERE id='%s';"%src)
print('PASS edited audited row rejects restore and retains edit')
for label,merge,member,source in [('direct',direct,m,src),('invite',inv,'40000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000099')]:
 r=db(restore(merge),False)
 if r.returncode:raise RuntimeError(label+' restore SQLSTATE/error: '+r.stderr[-1400:])
 check=one("SELECT (SELECT player_profile_id::text FROM public.club_members WHERE id='%s')||'|'||(SELECT is_active::text FROM public.player_profiles WHERE id='%s')||'|'||(SELECT (restored_at IS NOT NULL)::text FROM public.player_profile_merges WHERE id='%s')||'|'||(SELECT count(*) FROM public.notifications WHERE type='profile_merge_restored' AND (related_profile_link_request_id=(SELECT link_request_id FROM public.player_profile_merges WHERE id='%s')));"%(member,source,merge,merge))
 assert check==source+'|true|true|1',(label,check)
 event='50000000-0000-4000-8000-'+('000000000066' if label=='direct' else '000000000098')
 score='5:2:A' if label=='direct' else '6:3:A'
 actual=one("SELECT ep.player_profile_id::text||'|'||mr.score_a||':'||mr.score_b||':'||mr.winner_team FROM public.event_participants ep JOIN public.match_players mp ON mp.participant_id=ep.id JOIN public.match_results mr ON mr.match_id=mp.match_id WHERE ep.event_id='%s';"%event)
 assert actual==source+'|'+score,(label,actual)
 r=db(restore(merge),False);assert r.returncode and '復旧済み' in r.stderr,(label,r.returncode,r.stderr[-600:])
 print('PASS',label,'reviewed restore membership/source/audit/notification and repeat denial')

# Replay exactly the same synthetic invitation operation after the merge was restored.
args=json.loads((Path(os.environ['TASK0802_STATE_DIR'])/'invite-args.json').read_text());_,actor=login('new-http-0802@example.test')
status,result=http(R,'/rpc/accept_my_club_invite',args,actor['access_token']);assert status==200 and result.get('status')!='approved',(status,result)
assert one("SELECT count(*) FROM public.player_profile_merges WHERE target_auth_user_id=(SELECT id FROM auth.users WHERE email='new-http-0802@example.test') AND restored_at IS NULL;")=='0'
print('PASS old invitation operation cannot re-merge after restore')
