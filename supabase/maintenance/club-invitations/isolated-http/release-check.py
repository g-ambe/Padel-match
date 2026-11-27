"""Release compiler atomicity checks. Synthetic disposable DB only."""
import importlib.util,json,hashlib,os,pathlib,subprocess,tempfile
H=pathlib.Path(__file__).resolve().parent;P=H.parent;D=os.environ['TASK0802_DB'];VERSION='20261127043127'
spec=importlib.util.spec_from_file_location('compiler',P/'08_release_package_DRAFT.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def sql(s,ok=True):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-'],input=s,text=True,capture_output=True)
 if ok and r.returncode:raise RuntimeError(r.stderr[-3000:])
 return r
def val(s):return sql(s).stdout.strip()
q=lambda s:"'"+s.replace("'","''")+"'"
sql('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text primary key,name text,statements text[]); CREATE SCHEMA lineup_private;')
sql('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES '+','.join('(%s,%s,ARRAY[\'synthetic-existing-statement\'])'%(q(v),q(n)) for v,n in m.BASELINE))
# The 0040–0043 baseline is absent. Stubs are used ONLY to exercise the
# compiler's score fingerprint guard; this is not a score RPC behavior test.
for sig,_ in m.SCORE_DEFINITIONS:
 sql('CREATE FUNCTION '+sig+' RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;')
local_scores=[]
for sig,_ in m.SCORE_DEFINITIONS:
 digest=val('SET search_path=pg_catalog; SELECT md5(pg_get_functiondef(to_regprocedure(%s)));'%q(sig));assert len(digest)==32;local_scores.append((sig,digest))
cat=json.loads(sql((P/'06_catalog_readonly.sql').read_text()).stdout.strip());assert cat['missing']==0
raw=(P/'05_formal_install_CANDIDATE.sql').read_text();expected="v_fingerprint IS DISTINCT FROM 'cb7dd9058615a43fe0efa1f2378254fb'"
assert raw.count(expected)==1 and raw.count('v_count<>56')==1
local=raw.replace(expected,"v_fingerprint IS DISTINCT FROM '%s'"%cat['fingerprint']).replace('v_count<>56','v_count<>%d'%cat['count'])
with tempfile.TemporaryDirectory(prefix='task0802-release-') as temp:
 local_source=pathlib.Path(temp)/'local-only.sql';local_source.write_text(local)
 m.SOURCE=local_source;m.SOURCE_SHA256=hashlib.sha256(local_source.read_bytes()).hexdigest();m.SCORE_DEFINITIONS=tuple(local_scores)
 package=m.render(VERSION)
 approval="SET padel.invite_install_approved='task-08-02-rev06-install';\n"
 old=val("SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY version)::text) FROM supabase_migrations.schema_migrations h")
 def intact():
  assert val("SELECT coalesce(to_regnamespace('club_invite_private')::text,'absent')")=='absent'
  assert val("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='%s'"%VERSION)=='0'
  assert val("SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY version)::text) FROM supabase_migrations.schema_migrations h")==old
 sql("UPDATE supabase_migrations.schema_migrations SET name='drift' WHERE version='0047'")
 r=sql(approval+package,False);assert r.returncode and 'history mismatch' in r.stderr
 assert val("SELECT coalesce(to_regnamespace('club_invite_private')::text,'absent')")=='absent'
 sql("UPDATE supabase_migrations.schema_migrations SET name='event_result_video' WHERE version='0047'");intact();print('PASS history mismatch blocks DDL',flush=True)
 sql("INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('%s','collision')"%VERSION)
 r=sql(approval+package,False);assert r.returncode and 'history mismatch' in r.stderr
 assert val("SELECT coalesce(to_regnamespace('club_invite_private')::text,'absent')")=='absent'
 sql("DELETE FROM supabase_migrations.schema_migrations WHERE version='%s'"%VERSION);intact();print('PASS version collision blocks DDL',flush=True)
 sql("CREATE FUNCTION supabase_migrations.fail_new() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'test history failure'; END$$; CREATE TRIGGER fail_new BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION supabase_migrations.fail_new();")
 r=sql(approval+package,False);assert r.returncode and 'test history failure' in r.stderr;intact()
 sql('DROP TRIGGER fail_new ON supabase_migrations.schema_migrations; DROP FUNCTION supabase_migrations.fail_new();');print('PASS history INSERT failure rolls back DDL and history',flush=True)
 marker='DO $invite_score_after$';assert package.count(marker)==2
 pos=package.rindex(marker);failure=package[:pos]+"DO $injected$ BEGIN RAISE EXCEPTION 'test post-insert failure'; END $injected$;\n"+package[pos:]
 r=sql(approval+failure,False);assert r.returncode and 'test post-insert failure' in r.stderr;intact();print('PASS post-insert failure rolls back DDL and history',flush=True)
 sql(approval+package)
 assert val("SELECT count(*) FROM supabase_migrations.schema_migrations")=='31'
 assert val("SELECT md5(jsonb_agg(to_jsonb(h) ORDER BY version)::text) FROM supabase_migrations.schema_migrations h WHERE version<>'%s'"%VERSION)==old
 assert val("SELECT (name='task08_club_invitations' AND cardinality(statements)=2 AND position('CREATE SCHEMA club_invite_private' in statements[1])>0 AND position('invite_history_after' in statements[2])>0)::text FROM supabase_migrations.schema_migrations WHERE version='%s'"%VERSION)=='true'
 assert val('SELECT send_enabled::text FROM club_invite_private.settings')=='false'
 r=sql(approval+package,False);assert r.returncode;assert val("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='%s'"%VERSION)=='1'
 print('PASS atomic commit 30->31, existing history retained, segments recorded, hard OFF and duplicate rejected',flush=True)
