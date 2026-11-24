"""H56: real application SDK against synthetic local Auth + app schema.
Capture is READ ONLY, schema and metadata only, never application rows.
Restore/test steps never receive hosted credentials.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import uuid
HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
ROOT=Path(os.environ["RUNNER_TEMP"])/"task08-h56-schema"
SCHEMAS=("public","events_identity_private","events_operation_private",
 "fixed_pair_private","lineup_private","match_identity_private",
 "participants_identity_private","profile_link_private","profile_media_private",
 "shared_read_private","team_attendance_private","team_rounds_private")
S="("+",".join("'"+x+"'" for x in SCHEMAS)+")"

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

h44=load("h44","151_h43_cost_free_isolated_rehearsal.py")
b=h44.b
h55=load("h55","172_h55_local_auth_http_environment.py")
h54=load("h54","170_h54_atomic_cutover_rehearsal.py")
require=h55.require
FINGERPRINT=f"""SELECT jsonb_build_object(
 'relations',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(a.grantee::regrole::text,a.privilege_type,a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a)) ORDER BY n.nspname,c.relname),'[]'::jsonb)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {S} AND c.relkind IN ('r','p','v','m','S')),
 'functions',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),md5(pg_get_functiondef(p.oid)),pg_get_userbyid(p.proowner),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(a.grantee::regrole::text,a.privilege_type,a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type,a.is_grantable),'[]'::jsonb) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN {S} AND p.prokind='f'),
 'policies',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY schemaname,tablename,policyname),'[]'::jsonb) FROM pg_policies t WHERE schemaname IN {S}),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(x.grantee::regrole::text,x.privilege_type,x.is_grantable) ORDER BY x.grantee::regrole::text,x.privilege_type,x.is_grantable),'[]'::jsonb) FROM aclexplode(a.attacl) x)) ORDER BY n.nspname,c.relname,a.attnum),'[]'::jsonb)
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname IN {S} AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,t.relname,c.conname,pg_get_constraintdef(c.oid),c.convalidated) ORDER BY n.nspname,t.relname,c.conname),'[]'::jsonb) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname IN {S}),
 'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY n.nspname,c.relname,t.tgname),'[]'::jsonb) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {S} AND NOT t.tgisinternal),
 'views',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,pg_get_viewdef(c.oid),c.reloptions) ORDER BY n.nspname,c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {S} AND c.relkind IN ('v','m')),
 'indexes',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY schemaname,tablename,indexname),'[]'::jsonb) FROM pg_indexes i WHERE schemaname IN {S})
)"""

def trusted():
    require(os.getenv("GITHUB_ACTIONS")=="true" and os.getenv("GITHUB_REPOSITORY")=="g-ambe/Padel-match" and os.getenv("GITHUB_REF")=="refs/heads/codex/task-08-group-foundation","trusted_runner_required")
    require(ROOT.parent==Path(os.environ["RUNNER_TEMP"]),"runner_temp_required")

def capture():
    require(not ROOT.exists(),"fresh_capture_required")
    ROOT.mkdir(mode=0o700)
    ca=b.probe.custom_ca_file()
    require(ca is not None,"source_ca_missing")
    env=b.clean_env()
    env.update(b.probe.connection_environment(os.environ["SUPABASE_DB_URL"]))
    env["PGSSLROOTCERT"]="/run/padel-supabase-ca.crt"
    env["PGOPTIONS"]="-c default_transaction_read_only=on"
    with b.Snapshot(b.source_prefix(ca),env) as snap:
        inv=snap.query(f"""SELECT json_build_object(
         'schemas',(SELECT json_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname IN {S}),
         'unexpected_private',(SELECT count(*) FROM pg_namespace WHERE nspname LIKE '%_private' AND nspname NOT IN {S}),
         'external_functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN {S} AND p.prokind='f' AND p.prosrc ~* '(net[.]http_|http_post|http_get|dblink|vault[.]|apikey|service_role_key|postgres(ql)?://|sb_secret_)'),
         'managed_auth_triggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal),
         'foreign_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {S} AND c.relkind='f'))""")
        require(inv["schemas"]==sorted(SCHEMAS) and not any(v for k,v in inv.items() if k!="schemas"),"source_schema_review_required")
        catalog=snap.query(h44.remote_schema_catalog_query())
        require(catalog["legacy_fixed_pairs"] and catalog["legacy_media"] and not catalog["new_shared_rpc"],"source_baseline_changed")
        fingerprint=snap.query(FINGERPRINT)
        history=snap.query("SELECT coalesce(json_agg(json_build_object('version',version,'name',name) ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations")
        (ROOT/"metadata.json").write_text(json.dumps({"fingerprint":fingerprint,"history":history,"catalog":catalog}))
        snap.dump(["--schema-only","--format=custom","--no-comments","--no-security-labels","--no-publications","--no-subscriptions"]+["--schema="+x for x in SCHEMAS],ROOT/"app-schema.dump")
    print("H56 PASS: source app schema only captured; no managed Auth/Storage or real rows",flush=True)

def query(s):
    return json.loads(h55.sql("BEGIN READ ONLY; SET LOCAL search_path=''; "+s+"; ROLLBACK;"))

def restore_and_test(url,key,credentials):
    require(not os.getenv("SUPABASE_DB_URL") and not os.getenv("PADEL_BACKUP_DB_URL"),"hosted_credential_forbidden")
    metadata=json.loads((ROOT/"metadata.json").read_text())
    h55.sql("DROP TABLE public.h55_auth_probe; DROP FUNCTION public.h55_whoami();")
    require(query("SELECT json_build_object('n',count(*)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')")=={"n":0},"local_public_not_empty")
    rendered=b.run(b.DOCKER+["run","--rm","--interactive","--network","none",b.probe.POSTGRES_IMAGE,"pg_restore","--schema-only","--no-owner","--no-comments","--file","-"],phase="H56_schema_render_failed",data=(ROOT/"app-schema.dump").read_bytes(),timeout=300).decode()
    rendered=re.sub(r"(?m)^CREATE SCHEMA public;[ \t]*$","",rendered)
    require(not re.search(r"(?mi)^(COPY |INSERT INTO |CREATE (?:SCHEMA|TABLE) (?:auth|storage|vault)\b|CREATE (?:PUBLICATION|SUBSCRIPTION|SERVER|USER MAPPING)\b)",rendered),"unexpected_schema_archive_content")
    h55.sql(rendered)
    actual=query(FINGERPRINT)
    for name in metadata["fingerprint"]:
        require(actual[name]==metadata["fingerprint"][name],"schema_fingerprint_diff_"+name)
    require(query(h44.remote_schema_catalog_query())==metadata["catalog"],"source_catalog_diff")
    h55.sql(f"""DO $check$ DECLARE r record; v bigint; BEGIN
      FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {S} AND c.relkind IN ('r','p') LOOP
       EXECUTE format('SELECT count(*) FROM %I.%I',r.nspname,r.relname) INTO v;
       IF v<>0 THEN RAISE EXCEPTION 'H56 unexpected nonempty app table'; END IF;
      END LOOP; END $check$;""")
    print("H56 PASS: source app schema fingerprint matches, app tables empty",flush=True)
    h55.sql("CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);")
    require(query("SELECT json_build_object('n',count(*)) FROM supabase_migrations.schema_migrations")=={"n":0},"local_migration_history_not_empty")
    rows=",".join("("+b.literal(x["version"])+","+b.literal(x["name"])+",ARRAY['H56 schema metadata only']::text[])" for x in metadata["history"])
    h55.sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES "+rows+";")
    h55.sql(h44.PHASE1.read_text())
    h55.sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20990101010001','task08_prod_phase1_additive',ARRAY['H56 isolated test']);")
    combined="BEGIN;\n"+h54.body(h44.PHASE2,require)+"""
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('20990101010002','task08_prod_phase2_atomic',ARRAY['H56 isolated test']);
"""+h54.body(HERE/"164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql",require)+"""
CREATE TABLE public.h51_postcutover_data_preservation(marker text PRIMARY KEY);
REVOKE ALL ON public.h51_postcutover_data_preservation FROM PUBLIC,anon,authenticated;
INSERT INTO public.h51_postcutover_data_preservation VALUES('retained');
"""+h54.body(HERE/"168_h52_media_reference_guard_CANDIDATE.sql",require)+"\nCOMMIT;"
    h55.sql(combined)
    require(query("SELECT json_build_object('guard',position('最新版の連携画面' IN pg_get_functiondef('public.review_player_profile_link(uuid,text,text)'::regprocedure))>0,'anon',has_any_column_privilege('anon','public.club_members','SELECT'),'count',to_regprocedure('public.get_public_club_member_count(uuid)') IS NOT NULL)")=={"guard":True,"anon":False,"count":True},"post_cutover_contract")
    print("H56 PASS: verified Phase1 plus atomic Phase2/H51/H52 on local stack",flush=True)
    ids=seed(credentials)
    h55.sql("NOTIFY pgrst,'reload schema';")
    payload=json.dumps({"url":url,"key":key,"actors":credentials,"ids":ids})
    raw=h55.run(["node",str(REPO/"tests/integration/task08-h56-real-sdk.cjs")],"real_sdk",data=payload,cwd=REPO,timeout=180)
    report=json.loads(raw)
    require(report.get("ok") is True and report.get("checks")==15,"sdk_report_failed")
    print("H56 PASS: 15 real SDK/RPC assertions including public/private approval and join",flush=True)
    q=lambda x:b.literal(ids[x])+"::uuid"
    check=query(f"""SELECT json_build_object(
     'public_link',(SELECT count(*)=1 FROM public.club_members WHERE club_id={q('public')} AND player_profile_id={q('recipient_profile')} AND club_display_name='H56 public chosen' AND club_display_name_public_confirmed_at IS NOT NULL),
     'private_link',(SELECT count(*)=1 FROM public.club_members WHERE club_id={q('private')} AND player_profile_id={q('recipient_profile')} AND club_display_name='H56 private chosen' AND club_display_name_public_confirmed_at IS NULL),
     'joined',(SELECT count(*)=1 FROM public.club_members WHERE club_id={q('join')} AND player_profile_id={q('outsider_profile')} AND club_display_name='H56 join chosen' AND club_display_name_public_confirmed_at IS NOT NULL),
     'retired',(SELECT count(*)=2 FROM public.player_profiles WHERE id IN ({q('public_source')},{q('private_source')}) AND NOT is_active),
     'rejected_source',(SELECT is_active FROM public.player_profiles WHERE id={q('legacy_source')}),
     'media',(SELECT count(*)=1 FROM public.player_profile_private WHERE profile_id={q('recipient_profile')} AND instagram_username='h56_synthetic' AND avatar_version=1),
     'audit',(SELECT count(*)=2 FROM public.player_profile_merges WHERE target_player_profile_id={q('recipient_profile')} AND restored_at IS NULL),
     'joins',(SELECT count(*)=1 FROM public.join_requests WHERE club_id={q('join')} AND status='approved')
    )""")
    require(all(v is True for v in check.values()),"committed_row_checks_failed")
    print("H56 PASS: 8 independent committed-row/merge/media checks",flush=True)
    print("H56 LIMITATION: SDK/HTTP only; browser/Worker local preview not tested; no real rows or R2 bytes",flush=True)

def seed(credentials):
    # Auth users are the actual local signups, no manual auth.users inserts.
    ids={role: next(x["uid"] for x in credentials if x["role"]==role) for role in ("owner","recipient","outsider")}
    for role in ("owner","recipient","outsider"):
        ids[role+"_profile"]=str(uuid.uuid4())
    for club in ("public","private","join"):
        ids[club]=str(uuid.uuid4())
    for name in ("public","private","legacy"):
        ids[name+"_source"]=str(uuid.uuid4())
        ids[name+"_member"]=str(uuid.uuid4())
    q=lambda x:b.literal(str(uuid.UUID(ids[x])))+"::uuid"
    stmts=["BEGIN; SET LOCAL lock_timeout='5s';"]
    for role in ("owner","recipient","outsider"):
        email=next(x["email"] for x in credentials if x["role"]==role)
        stmts += [f"INSERT INTO public.profiles(id,display_name,email) VALUES({q(role)},'H56 {role}',{b.literal(email)});",
                  f"INSERT INTO public.player_profiles(id,display_name,linked_auth_user_id,created_by_auth_user_id,is_active) VALUES({q(role+'_profile')},'H56 {role}',{q(role)},{q(role)},true);"]
    for club in ("public","private","join"):
        vis="private" if club=="private" else "public"
        stmts += [f"INSERT INTO public.clubs(id,name,owner_id,is_active,visibility) VALUES({q(club)},'H56 {club}',{q('owner')},true,'{vis}');",
                  f"INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status) VALUES({q(club)},{q('owner')},{q('owner_profile')},'main_admin',true,'active');"]
    for name in ("public","private","legacy"):
        club="public" if name=="legacy" else name
        stmts += [f"INSERT INTO public.player_profiles(id,display_name,created_by_auth_user_id,is_active) VALUES({q(name+'_source')},'H56 {name} provisional',{q('owner')},true);",
                  f"INSERT INTO public.club_members(id,club_id,player_profile_id,role,is_active,status,club_display_name) VALUES({q(name+'_member')},{q(club)},{q(name+'_source')},'member',true,'active','H56 {name} current');"]
    media_request=str(uuid.uuid4()); media_key="profiles/"+ids["recipient_profile"]+"/"+media_request+".webp"
    stmts += [f"INSERT INTO public.profile_media_objects(object_key,profile_id,request_id,state) VALUES({b.literal(media_key)},{q('recipient_profile')},{b.literal(media_request)},'active');",
              f"INSERT INTO public.profile_media_operations(request_id,actor_id,profile_id,kind,status,object_key,expected_version,committed_at) VALUES({b.literal(media_request)},{q('recipient')},{q('recipient_profile')},'upload','committed',{b.literal(media_key)},0,now());",
              f"INSERT INTO public.player_profile_private(profile_id,owner_id,instagram_username,instagram_version,avatar_version,avatar_key) VALUES({q('recipient_profile')},{q('recipient')},'h56_synthetic',1,1,{b.literal(media_key)}) ON CONFLICT(profile_id) DO UPDATE SET owner_id=excluded.owner_id,instagram_username=excluded.instagram_username,instagram_version=1,avatar_version=1,avatar_key=excluded.avatar_key;",
              "COMMIT;"]
    h55.sql("\n".join(stmts))
    return ids

if __name__=="__main__":
    try:
        trusted()
        if sys.argv[1:]==["capture"]: capture()
        elif sys.argv[1:]==["test"]:
            require(not os.getenv("SUPABASE_DB_URL"),"hosted_credential_forbidden")
            h55.main(restore_and_test)
        else: require(False,"mode_required")
    except (RuntimeError,b.BackupError,b.probe.ProbeError) as e:
        print("H56 FAIL: "+str(e),flush=True);sys.exit(1)
    except Exception as e:
        print("H56 FAIL: unexpected_"+type(e).__name__,flush=True);sys.exit(1)
