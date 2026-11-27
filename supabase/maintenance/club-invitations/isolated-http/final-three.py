"""Focused local-only follow-up fixtures. Uses actual local Auth and PostgREST."""
from pathlib import Path

fixture = (Path(__file__).parent/'auth-check.py').read_text()
exec(fixture.split("args={'p_club':club")[0])

# First open an ordinary link request, then attempt the different invitation
# route for the very same source. Keep the product's conflict guards intact.
status, direct = http(R, '/rpc/request_player_profile_link', {
    'p_club_id': club, 'p_member_id': member,
    'p_target_auth_user_id': ids[recipient],
}, tokens[manager])
assert status == 200 and isinstance(direct, str), (status, direct)
status, checked = http(R, '/rpc/check_club_invite_account', {
    'p_club': club, 'p_member': member, 'p_email': recipient,
}, tokens[manager])
print('different route while direct pending:', status, checked, flush=True)
if status == 200 and checked.get('status') == 'registered':
    status, result = http(R, '/rpc/consume_club_invite_lookup', {
        'p_club': club, 'p_member': member, 'p_email': recipient,
        'p_ticket': checked['ticket'], 'p_operation_id': str(uuid.uuid4()),
        'p_confirm_registered': True,
    }, tokens[manager])
    print('different route consume:', status, result, flush=True)
    assert status >= 400 or result.get('status') != 'requested', (status, result)
else:
    assert status >= 400 or checked.get('status') != 'registered', (status, checked)
guard = subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-c',
    "SELECT (SELECT count(*) FROM public.player_profile_link_requests WHERE source_player_profile_id='%s' AND status='pending')||'|'||(SELECT count(*) FROM public.player_profile_merges WHERE source_player_profile_id='%s')||'|'||(SELECT player_profile_id::text FROM public.club_members WHERE id='%s')"%(src,src,member)],capture_output=True,text=True)
assert guard.returncode==0 and guard.stdout.strip()=='1|0|'+src,(guard.stdout,guard.stderr)
print('PASS second distinct invitation route refused while direct request pending', flush=True)

# Prepare a separate unregistered invitation using the existing real-Auth
# fixture, stopping immediately before its accept call.
invite_fixture = (Path(__file__).parent/'unregistered.py').read_text()
exec(invite_fixture.split("status,d=http(R,'/rpc/accept_my_club_invite'")[0])
accept_args = args.copy()
assert re.fullmatch('[a-f0-9-]{36}', uid)

# Complete a four-player official friendly result for the real group ranking
# loader. The existing fixture's 6:3 winner is the invited provisional player.
fixture_sql = "GRANT SELECT ON public.events,public.event_participants,public.matches,public.match_players,public.match_results TO authenticated; UPDATE public.events SET status='closed', stats_mode='official' WHERE id='50000000-0000-4000-8000-000000000098';"
for n,team in ((71,'A'),(72,'B'),(73,'B')):
    pp='20000000-0000-4000-8000-%012d'%n
    cm='40000000-0000-4000-8000-%012d'%n
    ep='51000000-0000-4000-8000-%012d'%n
    fixture_sql += "INSERT INTO public.player_profiles(id,display_name) VALUES('%s','試験選手'); INSERT INTO public.club_members(id,club_id,player_profile_id,role) VALUES('%s','%s','%s','member'); INSERT INTO public.event_participants(id,event_id,player_profile_id,status,participant_type) VALUES('%s','50000000-0000-4000-8000-000000000098','%s','active','member'); INSERT INTO public.match_players(match_id,participant_id,team) VALUES('52000000-0000-4000-8000-000000000098','%s','%s');" % (pp,cm,club,pp,ep,pp,ep,team)
r = subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1','-f','-'],input=fixture_sql,text=True,capture_output=True)
assert r.returncode==0,r.stderr
def ranking(expected,forbidden=None):
    node_env = dict(os.environ, NODE_PATH='/workspace/Padel-match/node_modules')
    req={'container':D,'rest':R,'token':mgr_token,'club':club,'expected':expected,'forbidden':forbidden}
    r=subprocess.run(['node',str(Path(__file__).parent/'ranking-check.cjs')],input=json.dumps(req),text=True,capture_output=True,env=node_env)
    assert r.returncode==0,r.stderr[-3000:]
    return json.loads(r.stdout)
before_rank=ranking(source)

tables = ('public.club_members','public.player_profiles','public.event_participants',
          'public.matches','public.match_players','public.match_results',
          'public.player_profile_link_requests','public.join_requests',
          'public.player_profile_merges','profile_link_private.merge_changes',
          'public.notifications','club_invite_private.invitations',
          'club_invite_private.lookup_tickets','club_invite_private.send_attempts')
parts = ["(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM %s t)" % table for table in tables]
snapshot = "SELECT encode(extensions.digest(jsonb_build_array(%s)::text,'sha256'),'hex');" % ','.join(parts)
def lit(value):
    if value is None: return 'NULL'
    if isinstance(value, bool): return 'true' if value else 'false'
    return "'" + str(value).replace("'", "''") + "'"
keys = ('p_invite','p_generation','p_operation_id','p_review_token',
        'p_expected_club_display_name','p_expected_visibility','p_club_display_name',
        'p_public_confirmation','p_inheritance_consent')
call = 'SELECT public.accept_my_club_invite(%s);' % ','.join(lit(accept_args[k]) for k in keys)
holder = subprocess.Popen(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,
    'psql','-X','-U','postgres','-d','postgres','-qAt',
    '-v','ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
holder.stdin.write("BEGIN;\nSET LOCAL request.jwt.claim.sub='%s';\n%s\n%s\n" % (uid,call,snapshot))
holder.stdin.flush()
accepted_line = holder.stdout.readline().strip()
if not accepted_line:
    raise RuntimeError('accept transaction failed: ' + holder.stderr.read()[-2000:])
approved = json.loads(accepted_line)
assert approved.get('status') == 'approved', approved
before_hash = holder.stdout.readline().strip()
assert re.fullmatch('[a-f0-9]{64}', before_hash), before_hash
# The accept transaction remains uncommitted. Verify cancel actually waits,
# then commit and collect the blocked HTTP response.
import concurrent.futures
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    pending = pool.submit(http,R,'/rpc/cancel_club_invite',{'p_invite':inv,'p_generation':gen},mgr_token)
    time.sleep(0.5)
    assert not pending.done(), 'cancel did not wait on the accept transaction'
    holder.stdin.write('COMMIT;\n\\q\n');holder.stdin.flush()
    status, cancelled = pending.result(timeout=15)
assert status == 200 and cancelled.get('status') == 'conflict', (status, cancelled)
holder.stdin.close();holder.stdin=None
out, err = holder.communicate(timeout=15)
assert holder.returncode == 0, err
check = subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec',D,'psql',
    '-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-c',snapshot],
    capture_output=True,text=True)
assert check.returncode == 0,check.stderr
assert check.stdout.strip() == before_hash, 'cancel changed an audited dataset'
state = subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec',D,'psql',
    '-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-c',
    "SELECT status||'|'||(SELECT count(*) FROM public.player_profile_merges WHERE source_player_profile_id='%s' AND restored_at IS NULL) FROM club_invite_private.invitations WHERE id='%s'" % (source,inv)],capture_output=True,text=True)
assert state.returncode == 0 and state.stdout.strip() == 'approved|1', (state.stdout,state.stderr)
status, again = http(R,'/rpc/cancel_club_invite',{'p_invite':inv,'p_generation':gen},mgr_token)
assert status == 200 and again.get('status') == 'conflict',(status,again)
check = subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-c',snapshot],capture_output=True,text=True)
assert check.returncode == 0 and check.stdout.strip() == before_hash
print('PASS accept-first concurrent cancel: conflict and all 14 table snapshots unchanged',flush=True)
after_rank=ranking('20000000-0000-4000-8000-000000000098',source)
assert {k:v for k,v in before_rank.items() if k!='playerId'} == {k:v for k,v in after_rank.items() if k!='playerId'}, (before_rank,after_rank)
print('PASS real group history loader and page aggregation: one match, 1-0, 100%, goals 6:3, ownership transferred without duplicate',flush=True)
