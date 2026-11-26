import subprocess,time,json
import os
D=os.environ['TASK0802_CONTAINER']; rid=os.environ['TASK0802_LINK_ID']; tok=os.environ['TASK0802_REVIEW_TOKEN']
def cmd(s):return ['docker','exec',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','VERBOSITY=verbose','-v','ON_ERROR_STOP=1','-c',s]
def run(s):
 t=time.monotonic();r=subprocess.run(cmd(s),capture_output=True,text=True);return r,round((time.monotonic()-t)*1000)
def snapshot():
 parts=[]
 for table in ['club_members','player_profiles','event_participants','matches','match_players','match_results','event_team_matches','official_matches','notifications','player_profile_merges','player_profile_link_requests','club_invite_private.invitations']:
  r,_=run("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM "+table+' t');assert r.returncode==0,r.stderr;parts.append(r.stdout)
 return parts
score="UPDATE match_results SET score_a=4,score_b=6,winner_team='B' WHERE id='54000000-0000-4000-8000-000000000002'"
approve="SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true); SELECT public.review_player_profile_link_named('"+rid+"','"+tok+"','本人2',NULL,true)"
before=snapshot(); holder=subprocess.Popen(cmd('BEGIN; '+score+'; SELECT pg_sleep(8); COMMIT;'),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True);time.sleep(.7)
r,ms=run("SET lock_timeout='500ms'; BEGIN; "+approve+'; COMMIT;');assert r.returncode and '55P03' in r.stderr,(r.stdout,r.stderr);after=snapshot();assert before==after,'unexpected changes after failed approval';print('score first: approval 55P03',ms,'ms; 12 table snapshot unchanged before holder commits')
_,err=holder.communicate();assert holder.returncode==0,err
r,_=run("SELECT score_a||':'||score_b||':'||winner_team FROM match_results WHERE id='54000000-0000-4000-8000-000000000002'");assert r.stdout.strip()=='4:6:B',r.stdout;print('actual changed score committed 4:6:B')
before=snapshot();holder=subprocess.Popen(cmd('BEGIN; '+approve+'; SELECT pg_sleep(8); ROLLBACK;'),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True);time.sleep(.7)
r,ms=run("SET lock_timeout='500ms'; UPDATE match_results SET score_a=5,score_b=6,winner_team='B' WHERE id='54000000-0000-4000-8000-000000000002'");assert r.returncode and '55P03' in r.stderr,(r.stdout,r.stderr);after=snapshot();assert before==after,'unexpected changes after failed score';print('approval first: score 55P03',ms,'ms; 12 table snapshot unchanged while approval uncommitted')
_,err=holder.communicate();assert holder.returncode==0,err; assert before==snapshot(),'rollback changed data'
r,ms=run('BEGIN; '+approve+'; COMMIT;');assert r.returncode==0 and 'approved' in r.stdout,(r.stdout,r.stderr);print('retry approval PASS',ms,'ms')
r,ms=run(score.replace('score_a=4','score_a=5'));assert r.returncode==0,(r.stdout,r.stderr)
r,_=run("SELECT score_a||':'||score_b||':'||winner_team FROM match_results WHERE id='54000000-0000-4000-8000-000000000002'");assert r.stdout.strip()=='5:6:B',r.stdout;print('retry score PASS final 5:6:B')
