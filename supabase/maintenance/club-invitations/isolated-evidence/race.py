#!/usr/bin/env python3
"""One accept/cancel race using only the caller's synthetic container."""
import concurrent.futures,json,os,re,subprocess
D=os.environ['TASK0802_CONTAINER']; inv=os.environ['TASK0802_INVITE']; token=os.environ['TASK0802_REVIEW_TOKEN']
assert re.fullmatch('[a-f0-9-]{36}',inv) and re.fullmatch('[a-f0-9]{32}',token)
def run(sql):
 return subprocess.run(['docker','exec',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-c',sql],capture_output=True,text=True)
def action(i):
 if i==0:s="SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000088',true); SELECT public.accept_my_club_invite('"+inv+"',1,'60000000-0000-4000-8000-000000000089','"+token+"',NULL,'public','同時本人',true,true);"
 else:s="SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true); SELECT public.cancel_club_invite('"+inv+"',1);"
 r=run('BEGIN; '+s+' COMMIT;'); assert r.returncode==0,r.stderr;return json.loads(r.stdout.splitlines()[-1])['status']
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: statuses=list(pool.map(action,[0,1]))
r=run("SELECT status||'|'||(SELECT count(*) FROM player_profile_merges WHERE source_player_profile_id='20000000-0000-4000-8000-000000000003' AND restored_at IS NULL) FROM club_invite_private.invitations WHERE id='"+inv+"'"); assert r.returncode==0,r.stderr;state,count=r.stdout.strip().split('|');assert (state,count) in [('approved','1'),('cancelled','0')],(statuses,state,count)
if state=='cancelled':
 r=run("SELECT (SELECT player_profile_id::text FROM club_members WHERE id='40000000-0000-4000-8000-000000000002')||'|'||(SELECT score_a||':'||score_b||':'||winner_team FROM match_results WHERE id='54000000-0000-4000-8000-000000000001')||'|'||(SELECT count(*) FROM profile_link_private.merge_changes)||'|'||(SELECT count(*) FROM notifications)||'|'||(SELECT count(*) FROM club_invite_private.lookup_tickets WHERE consumed_at IS NOT NULL)||'|'||(SELECT count(*) FROM club_invite_private.send_attempts WHERE invite_id='"+inv+"')")
 assert r.returncode==0,r.stderr
 assert r.stdout.strip()=='20000000-0000-4000-8000-000000000003|6:4:A|0|0|1|1',r.stdout
print('PASS simultaneous accept/cancel:',statuses,'final',state,'merges',count)
