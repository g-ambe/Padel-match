"""H61: rehearse the exact generated production package on disposable H56.
No hosted DDL/DML or deployment. All SQL applied here is local only.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import sys

HERE=pathlib.Path(__file__).resolve().parent
def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,HERE/filename)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

pkg=load("h61pkg","178_h61_release_package.py")
h58=load("h58","175_h58_real_share_acceptance.py")
h57=h58.h57
h56=h58.h56
h55=h56.h55
b=h56.b
require=h55.require
OUT=pathlib.Path(os.environ["RUNNER_TEMP"])/"task08-h61-release-sql"

def history():
    return h56.query("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations t")

def contract():
    # Original schema inventory plus newly created private schemas and exact history.
    new=h56.query("""SELECT jsonb_build_object(
      'schemas',(SELECT coalesce(jsonb_agg(nspname ORDER BY nspname),'[]') FROM pg_namespace WHERE nspname IN ('security_private','group_read_private')),
      'functions',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),md5(pg_get_functiondef(p.oid)),p.proacl::text) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('security_private','group_read_private') AND p.prokind='f'),
      'relations',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relacl::text) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('security_private','group_read_private')),
      'marker_absent',to_regclass('public.h51_postcutover_data_preservation') IS NULL
    )""")
    return {"schema":h56.query(h56.FINGERPRINT),"new":new,"history":history()}

def reject(sql,code,label):
    try:
        h56.local_sql(sql,label)
    except RuntimeError as e:
        require("_state_"+code+"_" in str(e),label+"_unexpected_failure_"+str(e))
    else:require(False,label+"_unexpected_success")

def apply_one(index,sqls):
    filename=list(sqls)[index]
    sql=sqls[filename]
    before=contract()
    require(before["new"]["marker_absent"],"h61_test_marker_present")
    injected=re.sub(r"COMMIT;\s*$","SELECT 1/0;\nCOMMIT;\n",sql)
    require(injected!=sql,"h61_injection_anchor")
    reject(injected,"22012","h61_phase"+str(index+1)+"_injection")
    require(contract()==before,"h61_failed_transaction_changed_schema_or_history")
    print("H61 PASS: phase "+str(index+1)+" final-statement failure rolls back schema, ACL and full history",flush=True)
    h56.local_sql(sql,"h61_phase"+str(index+1)+"_exact_package")
    after=contract()
    old=before["history"]
    new=after["history"]
    require(after["new"]["marker_absent"] and new[:-1]==old and len(new)==len(old)+1,"h61_history_old_rows_changed")
    version,name=pkg.RELEASE[index]
    last=new[-1]
    require(last["version"]==version and last["name"]==name and isinstance(last["statements"],list) and len(last["statements"])>=3,"h61_history_new_entry_incomplete")
    expected=[list(x) for x in pkg.BASELINE+pkg.RELEASE[:index+1]]
    require([[x["version"],x["name"]] for x in new]==expected,"h61_history_exact_ids")
    reject(sql,"P0001","h61_phase"+str(index+1)+"_repeat")
    require(contract()==after,"h61_repeat_changed_contract")
    print("H61 PASS: phase "+str(index+1)+" committed exact package and real version/history atomically, repeated apply denied",flush=True)

def after_auth(url,key,actors):
    sqls=pkg.write_package(OUT)
    require(all((OUT/f).read_bytes()==s.encode() for f,s in sqls.items()),"h61_output_mismatch")
    manifest=json.loads((OUT/"manifest.json").read_text())
    require(all(hashlib.sha256((OUT/f).read_bytes()).hexdigest()==manifest["sha256"][f] for f in sqls),"h61_manifest_mismatch")
    def phases12():
        before=contract()
        require([[x["version"],x["name"]] for x in before["history"]]==[list(x) for x in pkg.BASELINE],"h61_source_history_drift")
        for idx in (1,2):reject(list(sqls.values())[idx],"P0001","h61_out_of_order_"+str(idx+1))
        require(contract()==before,"h61_out_of_order_changed_contract")
        print("H61 PASS: out-of-order phase2/3 refused on original baseline",flush=True)
        apply_one(0,sqls)
        apply_one(1,sqls)
    ids=h56.restore_and_test(url,key,actors,release_runner=phases12)
    require(isinstance(ids,dict),"h61_fixture_missing")
    h58.seed(ids)
    def share(url,key,base,ids):
        h58.share_runner(url,key,base,ids,close_runner=lambda:apply_one(2,sqls))
    h57.browser_test(url,key,actors,ids,browser_runner=share)
    require([[x["version"],x["name"]] for x in history()]==[list(x) for x in pkg.BASELINE+pkg.RELEASE],"h61_final_history")
    print("H61 PASS: exact three-file package, 22 original+3 formal history rows, H56 SDK and H58 actual shared browser/HTTP",flush=True)
    print("H61 LIMITATION: synthetic local package rehearsal only; independent release review, latest backup, production target/deploy and approval remain required",flush=True)

if __name__=="__main__":
    try:
        h56.trusted()
        require(not os.getenv("SUPABASE_DB_URL") and not os.getenv("PADEL_BACKUP_DB_URL"),"hosted_credential_forbidden")
        h56.instagram_parser_selftest()
        h55.main(after_auth)
    except (RuntimeError,b.BackupError,b.probe.ProbeError) as e:
        print("H61 FAIL: "+str(e),flush=True);sys.exit(1)
    except Exception as e:
        print("H61 FAIL: unexpected_"+type(e).__name__,flush=True);sys.exit(1)
