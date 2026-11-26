#!/usr/bin/env python3
"""Synthetic-only PostgreSQL check. No hosted DB, HTTP, credentials or email."""
import hashlib, os, pathlib, re, subprocess, time, uuid
HERE=pathlib.Path(__file__).resolve().parent
REPO=HERE.parents[3]
MIG=REPO/'supabase/migrations'
GF=REPO/'supabase/maintenance/group-foundation'
CAND=HERE.parent/'04_integrated_review_candidate.sql'
NAME='codex-task0802-'+uuid.uuid4().hex[:12]
assert hashlib.sha256(CAND.read_bytes()).hexdigest()=='10a191b43f10751c28f23cbf06210affb81438e8ff3d81bb93b85a0b9818526e','candidate SHA differs; review required'
ENV={k:v for k,v in os.environ.items() if k in ('PATH','HOME','USER','LANG','LC_ALL','DOCKER_HOST')}
def docker(*args,**kwargs): return subprocess.run(['docker',*args],env=ENV,check=True,**kwargs)
def sql(data,quiet=True):
 r=docker('exec','-i','-e','PGOPTIONS=-c search_path=public,extensions',NAME,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-',input=data,text=True,capture_output=True)
 if r.stderr: print(r.stderr.strip(),flush=True)
 return r.stdout
created=False
try:
 docker('run','-d','--name',NAME,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=512m','-e','POSTGRES_PASSWORD=synthetic-local-only','postgres:17-alpine',capture_output=True,text=True)
 created=True
 for _ in range(60):
  if subprocess.run(['docker','exec',NAME,'psql','-X','-U','postgres','-d','postgres','-qAt','-c','SELECT 1'],env=ENV,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('local postgres not ready')
 time.sleep(2)  # wait for the image entrypoint's temporary init server to shut down
 sql((HERE/'init.sql').read_text())
 for p in sorted(MIG.glob('*.sql')):
  if '0001'<=p.name[:4]<='0039' or '0044'<=p.name[:4]<='0052' or p.name[:4] in ('0054','0055'):sql(p.read_text())
 sql('REVOKE ALL ON public.club_members FROM anon;')
 for p in sorted(MIG.glob('*.sql')):
  if '0056'<=p.name[:4]<='0060':sql(p.read_text())
 sql((GF/'139_h38_prod_link_scoped_preview_candidate.sql').read_text())
 sql((MIG/'0061_receiver_named_profile_link.sql').read_text())
 h51=(GF/'164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql').read_text()
 for old in (" OR to_regclass('public.club_owner_transfer_requests') IS NULL\n", " OR (SELECT count(*) FROM supabase_migrations.schema_migrations\n     WHERE name='task08_prod_phase2_atomic') <> 1\n"):
  assert h51.count(old)==1;h51=h51.replace(old,'')
 sql(h51);sql((MIG/'20261125032915_group_member_public_choice.sql').read_text())
 h52=(GF/'168_h52_media_reference_guard_CANDIDATE.sql').read_text()
 for old in (" OR to_regclass('public.h51_postcutover_data_preservation') IS NULL\n"," OR NOT EXISTS(SELECT 1 FROM public.h51_postcutover_data_preservation WHERE marker='retained')\n"," OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name='task08_prod_phase2_atomic')<>1\n"):
  assert h52.count(old)==1;h52=h52.replace(old,'')
 sql(h52)
 candidate=CAND.read_text();assert candidate.count('ROLLBACK;')==1
 sql("SET padel.invite_review_isolated='synthetic-only';\n"+candidate.replace('ROLLBACK;','COMMIT;'))
 sql((HERE/'fixtures.sql').read_text());sql((HERE/'history-fixture.sql').read_text())
 for f in ('unregistered-accept.sql','retention-key-role.sql'):
  print('TEST',f,flush=True);sql((HERE/f).read_text())
 sql((HERE/'locks-fixture.sql').read_text());sql((HERE/'rebind-check.sql').read_text())
 out=sql((HERE/'make-links.sql').read_text()).strip().splitlines()[-1]
 link,token=out.split('|'); assert re.fullmatch(r'[a-f0-9-]{36}',link) and re.fullmatch(r'[a-f0-9]{32}',token)
 testenv=ENV|{'TASK0802_CONTAINER':NAME,'TASK0802_LINK_ID':link,'TASK0802_REVIEW_TOKEN':token}
 subprocess.run(['python3',str(HERE/'lock-snapshot.py')],env=testenv,check=True)
 print('PASS synthetic-only tests; other cases not covered',flush=True)
finally:
 if created:
  subprocess.run(['docker','rm','-f',NAME],env=ENV,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  check=subprocess.run(['docker','inspect',NAME],env=ENV,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if check.returncode==0: raise RuntimeError('synthetic container cleanup failed')
  print('synthetic container and tmpfs removed',flush=True)
