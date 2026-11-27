"""Report exact score RPC body and dependency parity in synthetic setup."""
import os,subprocess,importlib.util,pathlib
D=os.environ['TASK0802_DB']
cmd=['docker','--host=unix:///var/run/docker.sock','exec',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-c',"SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.save_friendly_match_score(uuid,uuid,bigint,jsonb,jsonb,integer,integer,uuid)')"]
r=subprocess.run(cmd,capture_output=True,text=True);assert r.returncode==0,r.stderr
assert r.stdout.strip()=='4b5c3e60a1c8772541c5fb285c0a324b',r.stdout
print('PASS score RPC prosrc matches reviewed production and 0041',flush=True)
spec=importlib.util.spec_from_file_location('release',pathlib.Path(__file__).resolve().parent.parent/'08_release_package_DRAFT.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
for signature, expected in m.SCORE_DEFINITIONS:
 escaped=signature.replace("'","''")
 cmd[-1]="SET search_path=pg_catalog; SELECT md5(pg_get_functiondef(to_regprocedure('%s')))"%escaped
 r=subprocess.run(cmd,capture_output=True,text=True);assert r.returncode==0,r.stderr
 assert r.stdout.strip()==expected,(signature,r.stdout.strip(),expected)
print('PASS all 11 score dependency definitions match reviewed production hashes',flush=True)

from pathlib import Path
exec((Path(__file__).parent/'auth-check.py').read_text().split("args={'p_club':club")[0])
def db(query):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-'],input=query,text=True,capture_output=True)
 assert r.returncode==0,r.stderr[-2500:]
 return r.stdout.strip()
ev='50000000-0000-4000-8000-000000000080';rnd='53000000-0000-4000-8000-000000000080';match='52000000-0000-4000-8000-000000000080'
s="INSERT INTO events(id,club_id,name,court_count,event_mode,status,created_by_auth_user_id) VALUES('%s','%s','架空試合',1,'auto','active','%s'); INSERT INTO rounds(id,event_id,round_number) VALUES('%s','%s',1); INSERT INTO matches(id,event_id,round_id,court_number,completed) VALUES('%s','%s','%s',1,false);"%(ev,club,ids[manager],rnd,ev,match,ev,rnd)
for n in range(4):
 pp='51000000-0000-4000-8000-%012d'%(80+n);team='A' if n<2 else 'B'
 s+="INSERT INTO event_participants(id,event_id,guest_name,status,participant_type) VALUES('%s','%s','架空','active','guest'); INSERT INTO match_players(match_id,participant_id,team) VALUES('%s','%s','%s');"%(pp,ev,match,pp,team)
db(s)
players=json.loads(db("SELECT lineup_private.players('%s')"%match))
score=json.loads(db("SELECT lineup_private.score('%s')"%match))
request={'p_event_id':ev,'p_match_id':match,'p_revision':0,'p_players':players,'p_expected_score':score,'p_a':6,'p_b':3,'p_request_id':str(uuid.uuid4())}
status,first=http(R,'/rpc/save_friendly_match_score',request,tokens[manager]);assert status==200,(status,first)
status,retry=http(R,'/rpc/save_friendly_match_score',request,tokens[manager]);assert status==200 and first==retry,(status,first,retry)
state=db("SELECT (SELECT score_a||':'||score_b||':'||winner_team FROM match_results WHERE match_id='%s')||'|'||(SELECT completed::text FROM matches WHERE id='%s')||'|'||(SELECT count(*) FROM friendly_match_operations WHERE request_id='%s')"%(match,match,request['p_request_id']))
assert state=='6:3:A|true|1',state
print('PASS actual JWT/PostgREST score save and same-operation idempotency',flush=True)

# Two unrelated clubs each supply one normal link request. The score is in a
# third club. The holder uses local SQL claims solely to control commit order;
# the competing operation is the real Auth/JWT PostgREST endpoint.
import concurrent.futures,time
def link_fixture(n):
 c='30000000-0000-4000-8000-%012d'%n;memb='40000000-0000-4000-8000-%012d'%n;p='20000000-0000-4000-8000-%012d'%n;admin='41000000-0000-4000-8000-%012d'%n
 db("INSERT INTO clubs(id,name,owner_id,visibility) VALUES('%s','別グループ','%s','public'); INSERT INTO player_profiles(id,display_name) VALUES('%s','仮選手'); INSERT INTO club_members(id,club_id,profile_id,player_profile_id,role) VALUES('%s','%s','%s','20000000-0000-4000-8000-000000000001','main_admin'),('%s','%s',NULL,'%s','member');"%(c,ids[manager],p,admin,c,ids[manager],memb,c,p))
 st,link=http(R,'/rpc/request_player_profile_link',{'p_club_id':c,'p_member_id':memb,'p_target_auth_user_id':ids[recipient]},tokens[manager]);assert st==200 and isinstance(link,str),(st,link)
 st,pv=http(R,'/rpc/get_player_profile_link_request',{'p_request_id':link},tokens[recipient]);assert st==200 and pv.get('review_token'),(st,pv)
 args={'p_request_id':link,'p_review_token':pv['review_token'],'p_club_display_name':'本人','p_expected_club_display_name':None,'p_public_confirmation':True}
 return p,memb,args
def literal(x):
 if x is None:return 'NULL'
 if isinstance(x,bool):return 'true' if x else 'false'
 return "'"+str(x).replace("'","''")+"'"
def open_tx(uid, query):
 proc=subprocess.Popen(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 proc.stdin.write("BEGIN; SET LOCAL request.jwt.claim.sub='%s';\n%s\n"%(uid,query));proc.stdin.flush()
 line=proc.stdout.readline().strip()
 if not line:raise RuntimeError('holder failed: '+proc.stderr.read()[-2000:])
 return proc,json.loads(line)
def commit(proc):
 proc.stdin.write('COMMIT;\n\\q\n');proc.stdin.flush();proc.stdin.close();proc.stdin=None
 out,err=proc.communicate(timeout=15);assert proc.returncode==0,err
def score_args(a,b):
 return {'p_event_id':ev,'p_match_id':match,'p_revision':0,'p_players':players,'p_expected_score':json.loads(db("SELECT lineup_private.score('%s')"%match)),'p_a':a,'p_b':b,'p_request_id':str(uuid.uuid4())}
def score_sql(args):
 j=lambda x:literal(json.dumps(x))+'::jsonb'
 return 'SELECT public.save_friendly_match_score(%s,%s,%s,%s,%s,%s,%s,%s);'%(literal(ev),literal(match),args['p_revision'],j(players),j(args['p_expected_score']),args['p_a'],args['p_b'],literal(args['p_request_id']))
def link_sql(args):
 return 'SELECT public.review_player_profile_link_named(%s,%s,%s,%s,%s);'%tuple(literal(args[k]) for k in ('p_request_id','p_review_token','p_club_display_name','p_expected_club_display_name','p_public_confirmation'))
source1,member1,link1=link_fixture(91)
sc2=score_args(5,3);hold,result=open_tx(ids[manager],score_sql(sc2));assert result.get('result',{}).get('score_a')==5,result
before=db("SELECT (SELECT score_a||':'||score_b FROM match_results WHERE match_id='%s')||'|'||(SELECT player_profile_id::text FROM club_members WHERE id='%s')||'|'||(SELECT count(*) FROM player_profile_merges WHERE source_player_profile_id='%s')"%(match,member1,source1))
# Deliberate competing transaction timeout; it must not partially merge.
timeout_sql="BEGIN; SET LOCAL lock_timeout='250ms'; SET LOCAL request.jwt.claim.sub='%s'; %s COMMIT;"%(ids[recipient],link_sql(link1))
r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','VERBOSITY=verbose','-v','ON_ERROR_STOP=1','-f','-'],input=timeout_sql,capture_output=True,text=True)
assert r.returncode and '55P03' in r.stderr,(r.returncode,r.stderr[-1000:])
assert db("SELECT (SELECT score_a||':'||score_b FROM match_results WHERE match_id='%s')||'|'||(SELECT player_profile_id::text FROM club_members WHERE id='%s')||'|'||(SELECT count(*) FROM player_profile_merges WHERE source_player_profile_id='%s')"%(match,member1,source1))==before
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
 pending=pool.submit(http,R,'/rpc/review_player_profile_link_named',link1,tokens[recipient]);time.sleep(.5);assert not pending.done(),'approval did not wait for score';commit(hold);st,res=pending.result(timeout=15)
assert st==200 and res.get('status')=='approved',(st,res)
assert db("SELECT score_a||':'||score_b||':'||winner_team FROM match_results WHERE match_id='%s'"%match)=='5:3:A'
print('PASS score-first cross-group merge wait, timeout rollback and real-JWT retry',flush=True)
source2,member2,link2=link_fixture(92)
sc3=score_args(4,3);hold,result=open_tx(ids[recipient],link_sql(link2));assert result.get('status')=='approved',result
before=db("SELECT (SELECT score_a||':'||score_b FROM match_results WHERE match_id='%s')||'|'||(SELECT count(*) FROM friendly_match_operations WHERE request_id='%s')||'|'||(SELECT player_profile_id::text FROM club_members WHERE id='%s')||'|'||(SELECT count(*) FROM player_profile_merges WHERE source_player_profile_id='%s')"%(match,sc3['p_request_id'],member2,source2))
timeout_sql="BEGIN; SET LOCAL lock_timeout='250ms'; SET LOCAL request.jwt.claim.sub='%s'; %s COMMIT;"%(ids[manager],score_sql(sc3))
r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','VERBOSITY=verbose','-v','ON_ERROR_STOP=1','-f','-'],input=timeout_sql,capture_output=True,text=True)
assert r.returncode and '55P03' in r.stderr,(r.returncode,r.stderr[-1000:])
assert db("SELECT (SELECT score_a||':'||score_b FROM match_results WHERE match_id='%s')||'|'||(SELECT count(*) FROM friendly_match_operations WHERE request_id='%s')||'|'||(SELECT player_profile_id::text FROM club_members WHERE id='%s')||'|'||(SELECT count(*) FROM player_profile_merges WHERE source_player_profile_id='%s')"%(match,sc3['p_request_id'],member2,source2))==before
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
 pending=pool.submit(http,R,'/rpc/save_friendly_match_score',sc3,tokens[manager]);time.sleep(.5);assert not pending.done(),'score did not wait for merge';commit(hold);st,res=pending.result(timeout=15)
assert st==200 and res.get('result',{}).get('score_a')==4,(st,res)
st,retry=http(R,'/rpc/save_friendly_match_score',sc3,tokens[manager]);assert st==200 and retry==res,(st,retry)
assert db("SELECT (SELECT score_a||':'||score_b FROM match_results WHERE match_id='%s')||'|'||(SELECT count(*) FROM friendly_match_operations WHERE request_id='%s')||'|'||(SELECT count(*) FROM player_profile_merges WHERE source_player_profile_id='%s' AND restored_at IS NULL)"%(match,sc3['p_request_id'],source2))=='4:3|1|1'
print('PASS merge-first cross-group score wait, timeout rollback and real-JWT idempotent retry',flush=True)
