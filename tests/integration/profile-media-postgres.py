"""Synthetic localhost PostgreSQL only. Never accepts a production connection."""
import concurrent.futures, json, os, pathlib, subprocess, threading, urllib.parse
url=os.environ.get('PROFILE_MEDIA_TEST_PG_URL','')
u=urllib.parse.urlsplit(url)
if u.hostname not in ('127.0.0.1','localhost') or u.path!='/profile_media_test': raise SystemExit('Local synthetic database is required')
uid='00000000-0000-4000-8000-000000000001';pid='00000000-0000-4000-8000-000000000011';proof='a'*64
rid=lambda n:f'00000000-0000-4000-8000-{n:012d}'
def sql(text,actor=None,ok=True):
    prefix=f"set role authenticated;select set_config('request.jwt.claim.sub','{actor}',false);" if actor else ''
    r=subprocess.run(['psql',url,'-XAtq','-v','ON_ERROR_STOP=1'],input=prefix+text,text=True,capture_output=True,timeout=25)
    if ok and r.returncode: raise AssertionError(r.stderr[-1500:])
    return r
sql("create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;create table player_profiles(id uuid primary key,linked_auth_user_id uuid,is_active boolean not null default true);grant select on player_profiles to authenticated,anon;")
sql(f"insert into player_profiles values('{pid}','{uid}',true);")
sql(pathlib.Path('supabase/migrations/0048_private_profile_media.sql').read_text())
sql(f"insert into profile_media_private.settings values(true,sha256(convert_to('{proof}','UTF8')));")
def ticket():return sql('select profile_media_attempt();',uid).stdout.strip().splitlines()[-1]
def prepare(n,version=0):
    t=ticket();return f"select prepare_profile_image('{pid}','{rid(n)}',{version},'upload','{t}','{'0'*64}');"
queries=[prepare(100),prepare(101)];barrier=threading.Barrier(2)
def reserve(q):barrier.wait();return sql(q,uid,False)
with concurrent.futures.ThreadPoolExecutor(2) as pool: result=list(pool.map(reserve,queries))
assert sum(r.returncode==0 for r in result)==1,'Concurrent reservations must have one winner'
assert sql("select count(*) from profile_media_operations where status='pending';").stdout.strip()=='1'
winning=sql("select request_id from profile_media_operations where status='pending';").stdout.strip()
query=f"select commit_profile_image('{pid}','{winning}','{proof}');"
barrier=threading.Barrier(2)
with concurrent.futures.ThreadPoolExecutor(2) as pool: result=list(pool.map(reserve,[query,query]))
assert all(r.returncode==0 for r in result)
assert sql('select avatar_version from player_profile_private;').stdout.strip()=='1'
assert sql("select count(*) from profile_media_operations where status='committed';").stdout.strip()=='1'
print('PASS PostgreSQL multi-connection reservation / idempotent commit / quota counter')
# Failure after commit inside a transaction must roll all DB updates back.
sql(prepare(102,1),uid)
r=sql(f"begin;{query.replace(winning,rid(102))}do $$begin raise exception 'synthetic rollback';end$$;commit;",uid,False)
assert r.returncode
assert sql('select avatar_version from player_profile_private;').stdout.strip()=='1'
assert sql(f"select status from profile_media_operations where request_id='{rid(102)}';").stdout.strip()=='pending'
print('PASS PostgreSQL transaction rollback / previous reference preserved')
# Link change and commit racing: new owner never inherits private data.
new_owner=rid(2);barrier=threading.Barrier(2)
def race(index):
    barrier.wait()
    return sql(f"update player_profiles set linked_auth_user_id='{new_owner}' where id='{pid}';" if index else query.replace(winning,rid(102)),None if index else uid,False)
with concurrent.futures.ThreadPoolExecutor(2) as pool: result=list(pool.map(race,[0,1]))
assert result[1].returncode==0
assert sql('select avatar_key is null from player_profile_private;').stdout.strip()=='t'
assert sql('select count(*) from player_profile_private;',uid).stdout.strip().splitlines()[-1]=='0'
print('PASS PostgreSQL owner-change / commit race / RLS privacy')

# Cross-connection trial counters include rejected API requests and cannot overshoot 10.
sql('delete from profile_media_attempts;')
barrier=threading.Barrier(15)
def attempt(_):
    barrier.wait()
    return sql("select coalesce(profile_media_attempt()::text,'limited');",uid).stdout.strip().splitlines()[-1]
with concurrent.futures.ThreadPoolExecutor(15) as pool: attempts=list(pool.map(attempt,range(15)))
assert sum(x!='limited' for x in attempts)==10
assert attempts.count('limited')==5
print('PASS PostgreSQL 15 concurrent attempts / exactly 10 accepted')
