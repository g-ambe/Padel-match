"""H60: real media HTTP / actual bytes in disposable local R2.
H47 unchanged code evidence and H54 data preservation are separate gates.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import secrets
import sys
import time
import uuid

HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("h57",HERE/"174_h57_real_worker_browser.py")
h57=importlib.util.module_from_spec(spec)
spec.loader.exec_module(h57)
h56=h57.h56
h55=h57.h55
b=h56.b
require=h57.require

def after_auth(url,key,actors):
    ids=h56.restore_and_test(url,key,actors)
    require(isinstance(ids,dict),"h60_h56_fixture_missing")
    proof=secrets.token_hex(32)
    require(h56.query("SELECT jsonb_build_object('n',count(*)) FROM profile_media_private.settings")=={"n":0},"h60_local_settings_not_empty")
    hashed=hashlib.sha256(proof.encode()).hexdigest()
    h56.local_sql("INSERT INTO profile_media_private.settings(singleton,commit_secret_sha256) VALUES(true,decode("+b.literal(hashed)+",'hex'));","h60_local_proof_seed")
    q=lambda k:b.literal(str(uuid.UUID(ids[k])))+"::uuid"
    media=lambda: h56.query(f"""SELECT jsonb_build_object(
       'target_private',(SELECT to_jsonb(t) FROM public.player_profile_private t WHERE profile_id={q('recipient_profile')}),
       'target_objects',(SELECT jsonb_agg(to_jsonb(t) ORDER BY object_key) FROM public.profile_media_objects t WHERE profile_id={q('recipient_profile')}),
       'target_operations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY request_id) FROM public.profile_media_operations t WHERE profile_id={q('recipient_profile')}),
       'members',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.club_members t),
       'merges',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.player_profile_merges t)
    )""")
    before=media()
    def run_media(local_url,local_key,base,fixture):
        payload=json.dumps({"url":local_url,"key":local_key,"base":base,"actors":actors,"ids":fixture})
        raw=h55.run(["node",str(h57.REPO/"tests/integration/task08-h60-real-media.cjs")],"h60_real_media",data=payload,cwd=h57.REPO,timeout=240)
        report=json.loads(raw)
        if report.get("ok") is not True:
            phase=report.get("phase")
            allowed=("setup","auth","initial","privacy","webp","upload","readback","retry","position","replace","stale","delete","final")
            status=report.get("httpStatus")
            kind=report.get("errorKind")
            require(False,"h60_media_"+(phase if phase in allowed else "unknown")+
                "_http_"+(str(status) if type(status) is int and 100<=status<=599 else "none")+
                "_"+(kind if kind in ("assertion","timeout","other") else "unknown")+
                "_checks_"+str(int(report.get("checks",0))))
        require(report.get("checks")==12,"h60_media_check_count")
        print("H60 PASS: 12 real Worker HTTP image lifecycle/privacy/byte and cache checks",flush=True)
        # Allow waitUntil GC to complete while the local Worker is still alive.
        until=time.monotonic()+20
        while True:
            result=h56.query(f"""SELECT jsonb_build_object(
              'private',(SELECT count(*)=1 FROM public.player_profile_private WHERE profile_id={q('owner_profile')} AND owner_id={q('owner')} AND avatar_version=3 AND avatar_key IS NULL),
              'operations',(SELECT count(*)=3 FROM public.profile_media_operations WHERE profile_id={q('owner_profile')} AND actor_id={q('owner')} AND status='committed'),
              'upload_ops',(SELECT count(*)=2 FROM public.profile_media_operations WHERE profile_id={q('owner_profile')} AND kind='upload' AND status='committed' AND length(content_sha256)=64),
              'delete_op',(SELECT count(*)=1 FROM public.profile_media_operations WHERE profile_id={q('owner_profile')} AND kind='delete' AND status='committed'),
              'objects',(SELECT count(*)=2 FROM public.profile_media_objects WHERE profile_id={q('owner_profile')}),
              'gc',(SELECT count(*)=2 FROM public.profile_media_objects WHERE profile_id={q('owner_profile')} AND state='deleted' AND deleted_at IS NOT NULL),
              'no_pending',(SELECT count(*)=0 FROM public.profile_media_operations WHERE profile_id={q('owner_profile')} AND status='pending')
            )""")
            if len(result)==7 and all(v is True for v in result.values()):break
            if time.monotonic()>=until:
                failed=','.join(k for k,v in result.items() if v is not True)
                raise RuntimeError("h60_db_media_checks_failed_"+failed)
            time.sleep(.2)
        require(media()==before,"h60_unrelated_profile_or_group_data_changed")
        print("H60 PASS: seven independent DB assertions, GC acknowledged two object deletions, unrelated media/group/merges unchanged",flush=True)
    h57.browser_test(url,key,actors,ids,browser_runner=run_media,local_media_proof=proof)
    print("H60 LIMITATION: actual WebP bytes with local R2 emulation, not hosted R2 or device-specific browser upload UI; H47/H54 earlier evidence distinct",flush=True)

if __name__=="__main__":
    try:
        h56.trusted()
        require(not os.getenv("SUPABASE_DB_URL") and not os.getenv("PADEL_BACKUP_DB_URL"),"hosted_credential_forbidden")
        h56.instagram_parser_selftest()
        h55.main(after_auth)
    except (RuntimeError,b.BackupError,b.probe.ProbeError) as e:
        print("H60 FAIL: "+str(e),flush=True);sys.exit(1)
    except Exception as e:
        print("H60 FAIL: unexpected_"+type(e).__name__,flush=True);sys.exit(1)
