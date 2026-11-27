"""Formal-candidate gates against a synthetic disposable local database only."""
import json, os, pathlib, re, subprocess

H=pathlib.Path(__file__).resolve().parent
P=H.parents[0]; D=os.environ['TASK0802_DB']
def sql(script, ok=True):
 r=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',D,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1','-f','-'],input=script,text=True,capture_output=True)
 if ok and r.returncode: raise RuntimeError(r.stderr[-4000:])
 return r
def val(s):return sql(s).stdout.strip()
def no_ddl():assert val("SELECT coalesce(to_regnamespace('club_invite_private')::text,'absent')")=='absent'
sql("CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text,name text); INSERT INTO supabase_migrations.schema_migrations VALUES ('20261124044002','task08_prod_phase2_atomic'),('20261125032915','group_member_public_choice');")
catalog=json.loads(sql((P/'06_catalog_readonly.sql').read_text()).stdout.strip())
assert catalog['read_only']=='on' and catalog['missing']==0, catalog
count=int(catalog['count']);fingerprint=catalog['fingerprint'];assert re.fullmatch('[0-9a-f]{32}',fingerprint)
original=(P/'05_formal_install_CANDIDATE.sql').read_text()
expected="v_fingerprint IS DISTINCT FROM 'cb7dd9058615a43fe0efa1f2378254fb'"
assert original.count('v_count<>56')==1 and original.count(expected)==1
# Test-copy substitutions only: derive this disposable database's catalog and
# preserve every guard, rather than forging production catalog definitions.
candidate=original.replace('v_count<>56','v_count<>%d'%count).replace(expected,"v_fingerprint IS DISTINCT FROM '%s'"%fingerprint)
approval="SET padel.invite_install_approved='task-08-02-rev06-install';\n"
r=sql(candidate,False);assert r.returncode and 'requires separately approved operator and opt-in' in r.stderr;no_ddl();print('PASS missing opt-in rejected without DDL',flush=True)
bad=candidate.replace("v_fingerprint IS DISTINCT FROM '%s'"%fingerprint,"v_fingerprint IS DISTINCT FROM '%s'"%('0'*32));assert bad!=candidate
r=sql(approval+bad,False);assert r.returncode and 'catalog drift' in r.stderr;no_ddl();print('PASS catalog mismatch rejected without DDL',flush=True)
sql("DELETE FROM supabase_migrations.schema_migrations WHERE version='20261125032915'")
r=sql(approval+candidate,False);assert r.returncode and 'prerequisite migration history differs' in r.stderr;no_ddl()
sql("INSERT INTO supabase_migrations.schema_migrations VALUES ('20261125032915','group_member_public_choice')")
print('PASS missing prerequisite migration rejected without DDL',flush=True)
injected=candidate.replace('CREATE SCHEMA club_invite_private;',"CREATE SCHEMA club_invite_private;\nDO $injected$ BEGIN RAISE EXCEPTION 'isolated injected failure'; END $injected$;",1)
assert injected!=candidate
r=sql(approval+injected,False);assert r.returncode and 'isolated injected failure' in r.stderr;no_ddl()
print('PASS failure after DDL rolls back schema',flush=True)
def functions_snapshot():
 raw=val("SELECT coalesce(jsonb_object_agg(p.oid::regprocedure::text,md5(jsonb_build_array(pg_get_functiondef(p.oid),p.proacl,p.proconfig,p.proowner)::text)),'{}'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND n.nspname IN ('public','profile_link_private')")
 return json.loads(raw)
before_functions=functions_snapshot()
needle='END $formal_install_gate$;';assert candidate.count(needle)==1
test_assert="\nDO $test_search_path$ BEGIN IF current_setting('search_path')<>'public, extensions' THEN RAISE EXCEPTION 'search_path not restored'; END IF; END $test_search_path$;\n"
run_copy=candidate.replace(needle,needle+test_assert)
r=sql("SET search_path TO public, extensions;\n"+approval+run_copy+"\nSELECT current_setting('search_path');")
assert r.stdout.strip().endswith('public, extensions'),r.stdout[-1000:]
print('PASS normal conditions commit and search_path restored',flush=True)
after_functions=functions_snapshot()
assert all(after_functions.get(k)==v for k,v in before_functions.items()),'existing function definition or ACL changed'
print('PASS existing public/private function definitions and ACL unchanged',flush=True)
result=val("SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='club_invite_private' AND c.relkind='r')||'|'||(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='club_invite_private')||'|'||(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(ARRAY['check_club_invite_account','consume_club_invite_lookup','reserve_club_invite_send','reserve_club_invite_resend','claim_club_invite_send','finalize_club_invite_send','cancel_club_invite','get_club_invite_status','list_my_club_invites','preview_my_club_invite','preview_club_invite_rebind','rebind_club_invite','accept_my_club_invite','reject_my_club_invite']))")
assert result=='6|31|14',result
assert val("SELECT send_enabled::text FROM club_invite_private.settings")=='false'
r=sql('UPDATE club_invite_private.settings SET send_enabled=true;',False);assert r.returncode and 'club_invite_review_send_off' in r.stderr
assert val("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='club_invite_private' AND c.relkind='r' AND c.relrowsecurity")=='6'
assert val("SELECT has_schema_privilege('authenticated','club_invite_private','USAGE') OR has_schema_privilege('anon','club_invite_private','USAGE')")=='f'
print('PASS 6 tables/31 internal/14 public RPC, RLS, private schema ACL, hard OFF',flush=True)
r=sql(approval+candidate,False);assert r.returncode and ('catalog drift' in r.stderr or 'already installed' in r.stderr)
print('PASS reapplication rejected',flush=True)
print('local catalog entries:',count,'missing:',catalog['missing'],'(not production)',flush=True)
