"""H62-2: exact revised release plus focused real REST regression.
Only schema capture is hosted READ ONLY. Local synthetic users/rows only.
"""
import importlib.util
import hashlib
import json
import os
import pathlib
import re
import sys

HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("h61",HERE/"179_h61_release_package_rehearsal.py")
h61=importlib.util.module_from_spec(spec)
spec.loader.exec_module(h61)
h56=h61.h56
h55=h61.h55
b=h61.b
require=h55.require

def after_auth(url,key,actors):
    # Only Phase2 may change. This check keeps the earlier Phase1/3 evidence.
    sqls=h61.pkg.render()
    hashes=[hashlib.sha256(s.encode()).hexdigest() for s in sqls.values()]
    require(len(hashes)==3 and hashes[0]=="0ccd82e5c550a04f6e9788904346fd7e1551cabe2b0e713b44e16feac9f4e24c" and hashes[2]=="50ed1b8f67a88faf086c8fb05e5e38f545f45d73d7143110bb8410aabb6eb463" and hashes[1]!="03759e9c36760c85ebc5d0548e225de64440deff512408f94cfe9248e1935aeb","h62_unexpected_release_diff")
    print("H62 PASS: Phase1/3 SHA256 unchanged, only revised Phase2 differs",flush=True)
    ids=h61.after_auth(url,key,actors)
    require(isinstance(ids,dict),"h62_fixture_missing")
    payload=json.dumps({"url":url,"key":key,"actors":actors,"ids":ids})
    raw=h55.run(["node",str(h61.h57.REPO/"tests/integration/task08-h62-membership-boundary.cjs")],"h62_boundary",data=payload,cwd=h61.h57.REPO,timeout=180)
    report=json.loads(raw)
    if report.get("ok") is not True:
        phase=report.get("phase")
        allowed=("setup","auth","direct_nonmember","embedded","public_rpc","member_reads","visibility_flip","manager_returning","new_club","normal_event","official_member","withdraw")
        status=report.get("httpStatus")
        kind=report.get("errorKind")
        code=report.get("sqlState")
        operation=report.get("operation")
        if operation in ("insert_club_returning","insert_founder_membership","read_founder_membership","read_as_unrelated_user"):
            safe_code=code if isinstance(code,str) and re.fullmatch("[0-9A-Z]{5}",code) else "none"
            print(f"H62 new_club operation={operation} SQLSTATE={safe_code}",flush=True)
        require(False,"h62_"+(phase if phase in allowed else "unknown")+"_http_"+(str(status) if type(status) is int and 100<=status<=599 else "none")+"_kind_"+(kind if kind in ("assertion","other") else "unknown")+"_checks_"+str(int(report.get("checks",0))))
    require(report.get("checks")==11,"h62_check_count")
    print("H62 PASS: 11 real Auth/REST boundary and normal group/event operation checks",flush=True)
    print("H62 LIMITATION: focused club_members SELECT boundary only; existing public player_profiles retained; hosted deploy/backup not executed",flush=True)

if __name__=="__main__":
    try:
        h56.trusted()
        require(not os.getenv("SUPABASE_DB_URL") and not os.getenv("PADEL_BACKUP_DB_URL"),"hosted_credential_forbidden")
        h56.instagram_parser_selftest()
        h55.main(after_auth)
    except (RuntimeError,b.BackupError,b.probe.ProbeError) as e:
        print("H62 FAIL: "+str(e),flush=True);sys.exit(1)
    except Exception as e:
        print("H62 FAIL: unexpected_"+type(e).__name__,flush=True);sys.exit(1)
