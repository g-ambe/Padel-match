"""Small existing-link/legacy-score/ranking regression after formal DDL."""
from pathlib import Path
exec((Path(__file__).parent/'auth-check.py').read_text().split("args={'p_club':club")[0])
def db(s):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-'],input=s,text=True,capture_output=True)
 assert r.returncode==0,r.stderr[-2000:]
 return r.stdout.strip()
# Local baseline lacks Supabase default grants. Test-only grants are limited to
# existing legacy score and ranking tables, never to invitation/private tables.
db("GRANT SELECT ON public.events,public.event_participants,public.matches,public.match_players,public.match_results TO authenticated; GRANT UPDATE ON public.match_results TO authenticated;")
ev='50000000-0000-4000-8000-000000000088';match='52000000-0000-4000-8000-000000000088';part='51000000-0000-4000-8000-000000000088'
s="INSERT INTO events(id,club_id,name,court_count,status,stats_mode) VALUES('%s','%s','架空戦績',1,'closed','official'); INSERT INTO matches(id,event_id,court_number,completed) VALUES('%s','%s',1,true); INSERT INTO event_participants(id,event_id,player_profile_id,status,participant_type) VALUES('%s','%s','%s','active','member'); INSERT INTO match_players(match_id,participant_id,team) VALUES('%s','%s','A'); INSERT INTO match_results(match_id,score_a,score_b,winner_team) VALUES('%s',6,2,'A');"%(ev,club,match,ev,part,ev,src,match,part,match)
for n,team in ((71,'A'),(72,'B'),(73,'B')):
 pp='20000000-0000-4000-8000-%012d'%n;cm='40000000-0000-4000-8000-%012d'%n;ep='51000000-0000-4000-8000-%012d'%n
 s+="INSERT INTO player_profiles(id,display_name) VALUES('%s','架空'); INSERT INTO club_members(id,club_id,player_profile_id,role) VALUES('%s','%s','%s','member'); INSERT INTO event_participants(id,event_id,player_profile_id,status,participant_type) VALUES('%s','%s','%s','active','member'); INSERT INTO match_players(match_id,participant_id,team) VALUES('%s','%s','%s');"%(pp,cm,club,pp,ep,ev,pp,match,ep,team)
db(s)
# Legacy manual score path updates match_results; fixture role claims/ACL are synthetic.
db("BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='%s'; UPDATE public.match_results SET score_b=3 WHERE match_id='%s'; COMMIT;"%(ids[manager],match))
assert db("SELECT score_a||':'||score_b||':'||winner_team FROM match_results WHERE match_id='%s'"%match)=='6:3:A'
print('PASS legacy score result update in synthetic RLS baseline',flush=True)
def ranking(expected,forbidden=None):
 node_env=dict(os.environ,NODE_PATH='/workspace/Padel-match/node_modules');args={'container':D,'rest':R,'token':tokens[manager],'club':club,'expected':expected,'forbidden':forbidden}
 r=subprocess.run(['node',str(Path(__file__).parent/'ranking-check.cjs')],input=json.dumps(args),text=True,capture_output=True,env=node_env);assert r.returncode==0,r.stderr[-2500:];return json.loads(r.stdout)
before=ranking(src)
status,link=http(R,'/rpc/request_player_profile_link',{'p_club_id':club,'p_member_id':member,'p_target_auth_user_id':ids[recipient]},tokens[manager]);assert status==200 and isinstance(link,str),(status,link)
status,pv=http(R,'/rpc/get_player_profile_link_request',{'p_request_id':link},tokens[recipient]);assert status==200 and pv.get('review_token'),(status,pv)
status,result=http(R,'/rpc/review_player_profile_link_named',{'p_request_id':link,'p_review_token':pv['review_token'],'p_club_display_name':'本人','p_expected_club_display_name':None,'p_public_confirmation':True},tokens[recipient]);assert status==200 and result.get('status')=='approved',(status,result)
print('PASS existing direct profile linking after formal install',flush=True)
after=ranking('20000000-0000-4000-8000-000000000002',src)
assert {k:v for k,v in before.items() if k!='playerId'}=={k:v for k,v in after.items() if k!='playerId'},(before,after)
print('PASS existing group history loader/ranking after formal install and direct link',flush=True)
