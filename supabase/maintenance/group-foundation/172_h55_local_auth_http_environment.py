"""H55 local Supabase Auth/PostgREST infrastructure acceptance only.
No production/stage credentials, rows, APIs or deployment. Synthetic sentinel.
Runs on a dedicated fresh GitHub-hosted runner, inside a private temp directory.
"""
import base64
import json
import os
import pathlib
import re
import secrets
import subprocess
import sys
import urllib.request
import urllib.error
from urllib.parse import urlsplit

ROOT=pathlib.Path(os.environ["RUNNER_TEMP"])/"task08-h55-synthetic"
CLI=pathlib.Path(os.environ["RUNNER_TEMP"])/"supabase-tools"/"supabase"
NETWORK="task08-h55-local"
DB="supabase_db_task08-h55-synthetic"
DOCKER=["docker","--host=unix:///var/run/docker.sock"]
# Start subprocesses without hosted credentials even if unexpectedly inherited.
ENV={k:v for k,v in os.environ.items() if k in {
    "PATH","HOME","USER","LANG","LC_ALL","TMPDIR","RUNNER_TEMP","CI",
    "GITHUB_ACTIONS","GITHUB_REPOSITORY","GITHUB_REF"}}
ENV["SUPABASE_TELEMETRY_DISABLED"]="1"

def require(ok,code):
    if not ok: raise RuntimeError(code)

def run(args,phase,data=None,timeout=60,cwd=None):
    try:
        r=subprocess.run([str(x) for x in args],input=data,text=True,capture_output=True,
                         env=ENV,cwd=cwd,timeout=timeout,check=False)
    except (OSError,subprocess.TimeoutExpired):
        raise RuntimeError(phase+"_execution_failed") from None
    if r.returncode:
        # Log only static phase and SQLSTATE (not raw CLI output, keys or URLs).
        state=re.search(r"(?:ERROR|FATAL):\s+([0-9A-Z]{5}):",r.stderr)
        raise RuntimeError(phase+"_exit_"+str(r.returncode)+("_"+state.group(1) if state else ""))
    return r.stdout

def cli(args,phase,timeout=60):
    return run([CLI,*args],phase,cwd=ROOT,timeout=timeout)

def sql(s):
    return run(DOCKER+["exec","-i",DB,"psql","-U","postgres","-d","postgres",
                       "-X","-qAt","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose","-f","-"],
               "local_sql",data=s)

def request(url,path,key,token=None,body=None):
    require(urlsplit(url).hostname=="127.0.0.1" and urlsplit(url).port==54321,"local_api_required")
    h={"apikey":key,"Content-Type":"application/json"}
    if token: h["Authorization"]="Bearer "+token
    req=urllib.request.Request(url+path,data=json.dumps(body).encode() if body is not None else None,
                               headers=h)
    # Never follow redirects off localhost and never use proxy env.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    try:
        with opener.open(req,timeout=20) as response:
            raw=response.read()
            return response.status,json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        try: return e.code,json.loads(e.read())
        except (ValueError,UnicodeError): return e.code,None

def main():
    require(os.environ.get("GITHUB_ACTIONS")=="true" and
            os.environ.get("GITHUB_REPOSITORY")=="g-ambe/Padel-match" and
            os.environ.get("GITHUB_REF")=="refs/heads/codex/task-08-group-foundation",
            "trusted_runner_required")
    require(ROOT.parent==pathlib.Path(os.environ["RUNNER_TEMP"]) and not ROOT.exists(),"fresh_local_only")
    require(CLI.is_file(),"pinned_cli_missing")
    ROOT.mkdir(mode=0o700)
    version=run([CLI,"--version"],"cli_version")
    require("3.0.0" in version,"unexpected_cli_version")
    start_help=cli(["start","--help"],"start_help")
    require("--network-id" in start_help and "--exclude" in start_help,"cli_start_flags_missing")
    cli(["init"],"init")
    # Pin fresh project ID in generated config; never link to any hosted project.
    config=ROOT/"supabase"/"config.toml"
    require(config.is_file(),"generated_toml_missing")
    cfg=config.read_text()
    cfg,n=re.subn(r'(?m)^project_id\s*=\s*"[^"]+"','project_id = "task08-h55-synthetic"',cfg)
    require(n==1,"project_id_config_drift")
    # Confirmations disabled only for synthetic local accounts; use actual signup/password flow.
    require("[auth.email]" in cfg,"auth_email_config_missing")
    cfg,n=re.subn(r'(?m)^enable_confirmations[ \t]*=[ \t]*(?:true|false)[ \t]*$',"enable_confirmations = false",cfg,count=1)
    require(n==1,"auth_confirmation_config_missing")
    config.write_text(cfg)
    run(DOCKER+["network","create","-o","com.docker.network.bridge.host_binding_ipv4=127.0.0.1",NETWORK],"network_create")
    print("H55: start pinned local Supabase (no hosted keys or data)",flush=True)
    cli(["start","--network-id",NETWORK,"--exclude","realtime,imgproxy,studio,edge-runtime,logflare,vector,supavisor"],"local_stack_start",timeout=900)
    # Inspect every container on this dedicated network; reject public port bindings.
    inspect=json.loads(run(DOCKER+["network","inspect",NETWORK],"network_inspect"))[0]
    containers=list((inspect.get("Containers") or {}).keys())
    require(containers,"local_network_empty")
    ports=json.loads(run(DOCKER+["inspect",*containers],"local_container_inspect"))
    for obj in ports:
        for binds in (obj.get("NetworkSettings",{}).get("Ports") or {}).values():
            for bind in binds or []:
                require(bind.get("HostIp") in ("127.0.0.1","::1"),"non_loopback_port_binding")
    require(any(obj.get("Name")=="/"+DB for obj in ports),"unexpected_local_db_container")
    status_help=cli(["status","--help"],"status_help")
    require("--output" in status_help,"status_output_flag_missing")
    info=json.loads(cli(["status","--output","json"],"local_status"))
    url=info.get("API_URL") or info.get("api_url")
    key=info.get("PUBLISHABLE_KEY") or info.get("ANON_KEY") or info.get("anon_key")
    require(isinstance(url,str) and urlsplit(url).hostname in ("localhost","127.0.0.1")
            and urlsplit(url).port==54321 and isinstance(key,str),"local_status_contract")
    url="http://127.0.0.1:54321"
    if not key.startswith("sb_publishable_"):
        # Verify local legacy key has anon, not service_role, JWT role.
        parts=key.split(".")
        require(len(parts)==3,"local_public_key_format")
        payload=json.loads(base64.urlsafe_b64decode(parts[1]+"="*(-len(parts[1])%4)))
        require(payload.get("role")=="anon","local_anon_key_required")
    print("H55 PASS: local stack reachable and all published ports loopback",flush=True)
    # Isolated infrastructure probe, not an application table/RPC.
    sql("""
BEGIN;
CREATE TABLE public.h55_auth_probe(owner_id uuid PRIMARY KEY, value text NOT NULL);
ALTER TABLE public.h55_auth_probe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.h55_auth_probe FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.h55_auth_probe TO authenticated;
CREATE POLICY h55_self_read ON public.h55_auth_probe FOR SELECT TO authenticated USING(owner_id=(SELECT auth.uid()));
CREATE POLICY h55_self_insert ON public.h55_auth_probe FOR INSERT TO authenticated WITH CHECK(owner_id=(SELECT auth.uid()));
CREATE FUNCTION public.h55_whoami() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$SELECT auth.uid()$$;
REVOKE ALL ON FUNCTION public.h55_whoami() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.h55_whoami() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
""")
    actors=[]
    for role in ("owner","recipient","outsider"):
        email="h55-"+role+"-"+secrets.token_hex(4)+"@example.com"
        password=secrets.token_urlsafe(24)
        status,signup=request(url,"/auth/v1/signup",key,body={"email":email,"password":password})
        require(status in (200,201) and isinstance(signup,dict),"local_signup_failed_"+role)
        status,session=request(url,"/auth/v1/token?grant_type=password",key,body={"email":email,"password":password})
        require(status==200 and isinstance(session,dict) and isinstance(session.get("access_token"),str),"local_password_login_failed_"+role)
        token=session["access_token"]
        status,user=request(url,"/auth/v1/user",key,token)
        require(status==200 and user.get("id")==session.get("user",{}).get("id"),"local_get_user_failed_"+role)
        uid=user["id"]
        status,value=request(url,"/rest/v1/rpc/h55_whoami",key,token,body={})
        require(status==200 and value==uid,"jwt_auth_uid_mismatch_"+role)
        actors.append((uid,token))
        print("H55 PASS: real signup/password JWT/getUser/PostgREST identity "+role,flush=True)
    owner,owner_token=actors[0]
    outsider,outsider_token=actors[2]
    status,_=request(url,"/rest/v1/h55_auth_probe",key,owner_token,body={"owner_id":owner,"value":"synthetic"})
    require(status==201,"owner_insert_failed")
    # POST with Prefer minimal may return no body. request() handles that below.
    status,rows=request(url,"/rest/v1/h55_auth_probe?select=value",key,owner_token)
    require(status==200 and rows==[{"value":"synthetic"}],"owner_read_failed")
    status,rows=request(url,"/rest/v1/h55_auth_probe?select=value",key,outsider_token)
    require(status==200 and rows==[],"outsider_read_leak")
    status,_=request(url,"/rest/v1/h55_auth_probe",key,outsider_token,body={"owner_id":owner,"value":"forbidden"})
    require(status==403,"outsider_insert_not_denied")
    status,_=request(url,"/rest/v1/rpc/h55_whoami",key,body={})
    require(status in (401,403),"anon_rpc_not_denied")
    status,_=request(url,"/rest/v1/h55_auth_probe?select=value",key)
    require(status in (401,403),"anon_table_not_denied")
    status,_=request(url,"/rest/v1/rpc/h55_whoami",key,owner_token+"tampered",body={})
    require(status==401,"invalid_jwt_not_denied")
    print("H55 PASS: RLS own row, cross-account read/write denial, anonymous and invalid JWT",flush=True)
    print("H55 LIMITATION: local infrastructure sentinel only; app schema/RPC/UI not tested",flush=True)

if __name__=="__main__":
    try:
        main()
    except RuntimeError as e:
        print("H55 FAIL: "+str(e),flush=True)
        sys.exit(1)
    except Exception as e:
        print("H55 FAIL: unexpected_"+type(e).__name__,flush=True)
        sys.exit(1)
