#!/usr/bin/env python3
"""Disposable local GoTrue/PostgREST/Mailpit integration; synthetic data only."""
import os,pathlib,subprocess,time,uuid,tempfile,shutil
H=pathlib.Path(__file__).resolve().parent
suffix=uuid.uuid4().hex[:10];network='task0802-http-'+suffix
names={k:'task0802-'+k+'-'+suffix for k in ('db','auth','rest','mail')}
env={k:v for k,v in os.environ.items() if k in ('PATH','HOME','USER','LANG','LC_ALL')}
env.update({'DOCKER_HOST':'unix:///var/run/docker.sock','TASK0802_DB':names['db'],'TASK0802_AUTH':names['auth'],'TASK0802_REST':names['rest'],'TASK0802_MAIL':names['mail']})
if os.environ.get('TASK0802_FORMAL') == '1': env['TASK0802_FORMAL']='1'
if os.environ.get('TASK0802_RELEASE') == '1': env['TASK0802_FORMAL']='1'
if os.environ.get('TASK0802_SCORE') == '1': env['TASK0802_FORMAL']='1';env['TASK0802_SCORE']='1'
state_dir=tempfile.mkdtemp(prefix='task0802-fake-')
env['TASK0802_STATE_DIR']=state_dir
created=[];network_created=False
def run(args,**kw):return subprocess.run(args,env=env,check=True,**kw)
def docker(*args,**kw):return run(['docker','--host=unix:///var/run/docker.sock',*args],**kw)
def start(name,image,*options):
 docker('run','-d','--pull=never','--name',names[name],'--network',network,*options,image,capture_output=True,text=True);created.append(names[name])
try:
 docker('network','create','--internal',network,capture_output=True,text=True);network_created=True
 start('db','postgres:17-alpine','--network-alias','db','--tmpfs','/var/lib/postgresql/data:rw,size=512m','-e','POSTGRES_PASSWORD=synthetic-local-only')
 for _ in range(80):
  if subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec',names['db'],'psql','-U','postgres','-d','postgres','-qAt','-c','SELECT 1'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('local DB not ready')
 time.sleep(2)
 sql='CREATE SCHEMA auth; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; ALTER ROLE postgres IN DATABASE postgres SET search_path=auth,public,extensions;'
 docker('exec',names['db'],'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c',sql)
 authenv=['-e','GOTRUE_DB_DRIVER=postgres','-e','GOTRUE_DB_DATABASE_URL=postgres://postgres:synthetic-local-only@db:5432/postgres?sslmode=disable','-e','GOTRUE_DB_NAMESPACE=auth','-e','GOTRUE_JWT_SECRET=local-only-fake-jwt-secret-0123456789abcdef','-e','API_EXTERNAL_URL=http://127.0.0.1:18080','-e','GOTRUE_SITE_URL=http://localhost:3000']
 docker('run','--rm','--pull=never','--network',network,*authenv,'ghcr.io/supabase/gotrue:v2.197.0','auth','migrate',stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 start('mail','ghcr.io/supabase/mailpit:v1.31.3','--network-alias','mail')
 start('auth','ghcr.io/supabase/gotrue:v2.197.0',*authenv,'-e','GOTRUE_API_HOST=0.0.0.0','-e','GOTRUE_API_PORT=9999','-e','GOTRUE_JWT_AUD=authenticated','-e','GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated','-e','GOTRUE_DISABLE_SIGNUP=false','-e','GOTRUE_EXTERNAL_EMAIL_ENABLED=true','-e','GOTRUE_MAILER_AUTOCONFIRM=false','-e','GOTRUE_SMTP_HOST=mail','-e','GOTRUE_SMTP_PORT=1025','-e','GOTRUE_SMTP_ADMIN_EMAIL=synthetic@example.test','-e','GOTRUE_SMTP_SENDER_NAME=Synthetic','-e','GOTRUE_MAILER_URLPATHS_CONFIRMATION=/verify')
 run(['python3',str(H/'bootstrap.py')]);start('rest','ghcr.io/supabase/postgrest:v16.5','-e','PGRST_DB_URI=postgres://authenticator:fake-postgrest-password@db:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET=local-only-fake-jwt-secret-0123456789abcdef')
 time.sleep(3)
 names_to_run = ('formal-check.py','score-probe.py') if os.environ.get('TASK0802_SCORE') == '1' else ('release-check.py',) if os.environ.get('TASK0802_RELEASE') == '1' else ('formal-check.py','formal-regression.py') if os.environ.get('TASK0802_FORMAL') == '1' else ('final-three.py',) if os.environ.get('TASK0802_FINAL_THREE') == '1' else ('auth-check.py','unregistered.py','restore-check.py','operations.py','reinvite.py','scope-check.py','legacy-join.py','role-check.py')
 for name in names_to_run:run(['python3',str(H/name)])
 print('PASS selected local Auth / Mailpit / PostgREST tests; see omissions')
finally:
 for c in reversed(created):subprocess.run(['docker','--host=unix:///var/run/docker.sock','rm','-f',c],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 if network_created:subprocess.run(['docker','--host=unix:///var/run/docker.sock','network','rm',network],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 for c in created:
  if subprocess.run(['docker','--host=unix:///var/run/docker.sock','inspect',c],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:raise RuntimeError('container cleanup failed')
 if network_created and subprocess.run(['docker','--host=unix:///var/run/docker.sock','network','inspect',network],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:raise RuntimeError('network cleanup failed')
 shutil.rmtree(state_dir)
 print('local containers, network and synthetic state removed')
