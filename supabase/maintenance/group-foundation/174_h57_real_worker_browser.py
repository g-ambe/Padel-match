"""H57: real mobile browser against the new app and disposable H56 DB.
No production/staging Auth, R2, deployment, or business rows.
"""
import importlib.util
import json
import os
import pathlib
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

HERE=pathlib.Path(__file__).resolve().parent
REPO=HERE.parents[2]
spec=importlib.util.spec_from_file_location("h56",HERE/"173_h56_local_app_schema_http.py")
h56=importlib.util.module_from_spec(spec)
spec.loader.exec_module(h56)
h55=h56.h55
b=h56.b
require=h55.require
TEMP=pathlib.Path(os.environ["RUNNER_TEMP"])/"task08-h57-browser"
ORIGIN="http://127.0.0.1:3070"

def seed_browser(ids):
    ids=dict(ids)
    for name in ("public","private","join","public_source","private_source","public_member","private_member"):
        ids["browser_"+name]=str(uuid.uuid4())
    q=lambda x:b.literal(str(uuid.UUID(ids[x])))+"::uuid"
    stmts=["BEGIN; SET LOCAL lock_timeout='5s';"]
    for club in ("public","private","join"):
        vis="private" if club=="private" else "public"
        stmts += [f"INSERT INTO public.clubs(id,name,owner_id,is_active,visibility) VALUES({q('browser_'+club)},'H57 {club}',{q('owner')},true,'{vis}');",
                  f"INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status) VALUES({q('browser_'+club)},{q('owner')},{q('owner_profile')},'main_admin',true,'active');"]
    for club in ("public","private"):
        stmts += [f"INSERT INTO public.player_profiles(id,display_name,created_by_auth_user_id,is_active) VALUES({q('browser_'+club+'_source')},'H57 {club} provisional',{q('owner')},true);",
                  f"INSERT INTO public.club_members(id,club_id,player_profile_id,role,is_active,status,club_display_name) VALUES({q('browser_'+club+'_member')},{q('browser_'+club)},{q('browser_'+club+'_source')},'member',true,'active','H57 {club} current');"]
    for actor,theme in (("owner","light"),("recipient","dark"),("outsider","light")):
        stmts += [f"INSERT INTO public.user_preferences(auth_user_id,theme_mode,tutorial_status) VALUES({q(actor)},'{theme}','completed') ON CONFLICT(auth_user_id) DO UPDATE SET theme_mode=excluded.theme_mode,tutorial_status=excluded.tutorial_status;"]
    h56.local_sql("\n".join(stmts+["COMMIT;"]),"h57_seed")
    return ids

def browser_requests(url,key,actors,ids):
    # Preparatory real owner RPC, not a simulated browser manager-create test.
    actor=next(x for x in actors if x["role"]=="owner")
    status,value=h55.request(url,"/auth/v1/token?grant_type=password",key,body={"email":actor["email"],"password":actor["password"]})
    require(status==200 and isinstance(value,dict) and isinstance(value.get("access_token"),str),"h57_owner_login")
    for club,target in (("public","recipient"),("private","outsider")):
        status,request=h55.request(url,"/rest/v1/rpc/request_player_profile_link",key,value["access_token"],{"p_club_id":ids["browser_"+club],"p_member_id":ids["browser_"+club+"_member"],"p_target_auth_user_id":ids[target]})
        require(status==200 and isinstance(request,str),"h57_request_"+club+"_http_"+str(status))
        ids["browser_"+club+"_request"]=str(uuid.UUID(request))
    print("H57 PASS: prepared two pending requests through real owner RPC",flush=True)

def build_env(url,key):
    require(url=="http://127.0.0.1:54321","h57_local_db_only")
    require(not any(os.getenv(x) for x in ("SUPABASE_DB_URL","SUPABASE_SERVICE_ROLE_KEY","CLOUDFLARE_API_TOKEN","CLOUDFLARE_API_KEY","CLOUDFLARE_ACCOUNT_ID")),"h57_hosted_credentials_forbidden")
    return {**h55.ENV,"NEXT_PUBLIC_SUPABASE_URL":url,"NEXT_PUBLIC_SUPABASE_ANON_KEY":key,
            "NEXT_TELEMETRY_DISABLED":"1","WRANGLER_SEND_METRICS":"false","CI":"true",
            "CLOUDFLARE_ENV":"","NO_PROXY":"127.0.0.1,localhost"}

def run_checked(args,env,phase,timeout):
    try:
        result=subprocess.run(args,cwd=REPO,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError(phase+"_timeout") from None
    require(result.returncode==0,phase+"_exit_"+str(result.returncode))

def browser_test(url,key,actors,ids):
    env=build_env(url,key)
    TEMP.mkdir(mode=0o700)
    run_checked(["node","node_modules/typescript/bin/tsc","--noEmit"],env,"h57_typescript",180)
    print("H57 PASS: TypeScript",flush=True)
    run_checked(["npm","run","cf:build"],env,"h57_opennext_build",600)
    run_checked(["node","-e","if (!require('./scripts/ensure-cloudflare-worker.cjs').current()) process.exit(1)"],env,"h57_worker_build_id",30)
    print("H57 PASS: OpenNext build ID and Worker/assets",flush=True)
    # Explicit local mode, no remote resources and no hosted credentials.
    with (TEMP/"worker.log").open("wb") as log:
        worker=subprocess.Popen(["node_modules/.bin/wrangler","dev","--local","--ip","127.0.0.1","--port","3070","--persist-to",str(TEMP/"state"),"--config","wrangler.jsonc"],cwd=REPO,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        try:
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            until=time.monotonic()+150
            while time.monotonic()<until:
                require(worker.poll() is None,"h57_worker_exited_"+str(worker.returncode))
                try:
                    with opener.open(ORIGIN+"/login",timeout=3) as response:
                        if response.status==200:break
                except (OSError,urllib.error.URLError):pass
                time.sleep(1)
            else: raise RuntimeError("h57_worker_readiness_timeout")
            print("H57 PASS: built Worker serving loopback HTTP; local R2 only",flush=True)
            payload=json.dumps({"url":url,"base":ORIGIN,"actors":actors,"ids":ids})
            raw=h55.run(["node",str(REPO/"tests/browser/task08-h57-real-worker.cjs")],"h57_browser",data=payload,cwd=REPO,timeout=240)
            report=json.loads(raw)
            allowed=("setup","login_owner","login_recipient","login_outsider","public_boundary","private_boundary","manager_view","third_party","public_approval","private_approval","public_readback","member_readback","join_submit","join_approve","join_approve_rpc","join_approve_feedback","join_approve_status","join_readback","finish")
            stage=report.get("phase")
            if report.get("ok") is not True:
                kind=report.get("errorKind")
                kind=kind if kind in ("timeout","assertion","ambiguous_locator","other") else "unknown"
                status=report.get("joinStatus")
                status=str(status) if type(status) is int and 100<=status<=599 else "none"
                require(False,"h57_browser_failed_"+(stage if stage in allowed else "unknown")+"_checks_"+str(int(report.get("checks",0)))+"_kind_"+kind+"_join_http_"+status)
            require(report.get("checks")==14,"h57_browser_report_failed")
            print("H57 PASS: 14 real 375px light/dark Worker browser assertions; no API mocks",flush=True)
        finally:
            if worker.poll() is None:
                os.killpg(worker.pid,signal.SIGTERM)
                try:worker.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(worker.pid,signal.SIGKILL)
                    worker.wait()

def verify(ids):
    q=lambda x:b.literal(str(uuid.UUID(ids[x])))+"::uuid"
    checks=h56.query(f"""SELECT json_build_object(
      'public_member',(SELECT count(*)=1 FROM public.club_members WHERE club_id={q('browser_public')} AND player_profile_id={q('recipient_profile')} AND club_display_name='H57 公開本人名' AND club_display_name_public_confirmed_at IS NOT NULL AND is_active AND status='active'),
      'private_member',(SELECT count(*)=1 FROM public.club_members WHERE club_id={q('browser_private')} AND player_profile_id={q('outsider_profile')} AND club_display_name='H57 非公開本人名' AND club_display_name_public_confirmed_at IS NULL AND is_active AND status='active'),
      'normal_join',(SELECT count(*)=1 FROM public.club_members WHERE club_id={q('browser_join')} AND player_profile_id={q('outsider_profile')} AND club_display_name='H57 加入本人名' AND club_display_name_public_confirmed_at IS NOT NULL AND is_active AND status='active'),
      'sources_retired',(SELECT count(*)=2 FROM public.player_profiles WHERE id IN ({q('browser_public_source')},{q('browser_private_source')}) AND NOT is_active),
      'merge_audits',(SELECT count(*)=2 FROM public.player_profile_merges WHERE source_player_profile_id IN ({q('browser_public_source')},{q('browser_private_source')}) AND restored_at IS NULL),
      'link_requests',(SELECT count(*)=2 FROM public.player_profile_link_requests WHERE id IN ({q('browser_public_request')},{q('browser_private_request')}) AND status='approved'),
      'join_request',(SELECT count(*)=1 FROM public.join_requests WHERE club_id={q('browser_join')} AND requester_auth_user_id={q('outsider')} AND status='approved'),
      'canonical_media',(SELECT count(*)=1 FROM public.player_profile_private WHERE profile_id={q('recipient_profile')} AND instagram_username='h56_synthetic' AND avatar_version=1)
    )""")
    require(len(checks)==8 and all(v is True for v in checks.values()),"h57_committed_checks_failed")
    print("H57 PASS: 8 independent DB committed-row assertions",flush=True)

def after_auth(url,key,actors):
    ids=h56.restore_and_test(url,key,actors)
    require(isinstance(ids,dict),"h57_h56_fixture_missing")
    ids=seed_browser(ids)
    browser_requests(url,key,actors,ids)
    browser_test(url,key,actors,ids)
    verify(ids)
    print("H57 LIMITATION: representative group and link/join flows only; no shared events, R2 bytes, restore concurrency or device hardware acceptance",flush=True)

if __name__=="__main__":
    try:
        h56.trusted()
        require(not os.getenv("SUPABASE_DB_URL"),"hosted_credential_forbidden")
        h56.instagram_parser_selftest()
        h55.main(after_auth)
    except (RuntimeError,b.BackupError,b.probe.ProbeError) as e:
        print("H57 FAIL: "+str(e),flush=True);sys.exit(1)
    except Exception as e:
        print("H57 FAIL: unexpected_"+type(e).__name__,flush=True);sys.exit(1)
