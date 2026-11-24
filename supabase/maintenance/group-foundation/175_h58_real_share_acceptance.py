"""H58: actual share pages on the proven local Worker/DB.
Only disposable synthetic fixtures; existing H12/H35 candidates are applied
locally after the first share browser/HTTP pass. No hosted DDL/DML/deploy.
"""
import importlib.util
import json
import os
import pathlib
import sys
import uuid

HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("h57",HERE/"174_h57_real_worker_browser.py")
h57=importlib.util.module_from_spec(spec)
spec.loader.exec_module(h57)
h56=h57.h56
h55=h57.h55
b=h56.b
require=h57.require

def seed(ids):
    # Reuse reviewed H34 fixture verbatim except for the three stage lookup
    # statements, replacing them with real LOCAL Auth/club fixture IDs.
    sql=(HERE/"129_h34_share_fixture_setup.sql").read_text()
    replacements={
      "SELECT id INTO STRICT c1 FROM public.clubs WHERE name='TASK08-P0-20261119-A' AND is_active AND NOT coalesce(is_deleted,false);":
        "SELECT id INTO STRICT c1 FROM public.clubs WHERE id="+b.literal(str(uuid.UUID(ids["public"])))+"::uuid AND is_active AND NOT coalesce(is_deleted,false);",
      "SELECT id INTO STRICT c2 FROM public.clubs WHERE name='TASK08-P0-20261119-B' AND is_active AND NOT coalesce(is_deleted,false);":
        "SELECT id INTO STRICT c2 FROM public.clubs WHERE id="+b.literal(str(uuid.UUID(ids["private"])))+"::uuid AND is_active AND NOT coalesce(is_deleted,false);",
      "SELECT id INTO STRICT actor FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;":
        "SELECT id INTO STRICT actor FROM auth.users WHERE id="+b.literal(str(uuid.UUID(ids["owner"])))+"::uuid AND email_confirmed_at IS NOT NULL;"
    }
    for old,new in replacements.items():
        require(sql.count(old)==1,"h58_fixture_source_drift")
        sql=sql.replace(old,new)
    h56.local_sql(sql,"h58_share_fixture")
    result=h56.query("""SELECT jsonb_build_object(
      'events',(SELECT count(*) FROM public.events),
      'official',(SELECT count(*) FROM public.official_events),
      'matches',(SELECT count(*) FROM public.matches),
      'team',(SELECT count(*) FROM public.event_team_matches),
      'official_matches',(SELECT count(*) FROM public.official_matches),
      'guest_ids',(SELECT jsonb_agg(id::text) FROM public.event_team_guests)
    )""")
    require(all(result[k]==n for k,n in (("events",2),("official",1),("matches",1),("team",1),("official_matches",1))) and len(result["guest_ids"])==4,"h58_fixture_counts")
    ids["private_ids"]=[ids[k] for k in ("owner","recipient","outsider","owner_profile","recipient_profile","outsider_profile","public","private","join")]+result["guest_ids"]
    print("H58 PASS: reviewed H34 fixture reproduced using actual local actor and clubs",flush=True)

def run_browser(url,key,base,ids,mode,expected):
    payload=json.dumps({"url":url,"base":base,"key":key,"mode":mode,"privateIds":ids["private_ids"]})
    raw=h55.run(["node",str(h57.REPO/"tests/browser/task08-h58-real-share.cjs")],"h58_browser_"+mode,data=payload,cwd=h57.REPO,timeout=240)
    report=json.loads(raw)
    phases=("setup","dto_friendly","dto_mixed","dto_official","token_negative","click_http","legacy_click_denied","raw_table_denied","raw_other_scope","browser_friendly","browser_mixed","browser_official","browser_invalid","browser_errors","disabled_http")
    if report.get("ok") is not True:
        phase=report.get("phase")
        kind=report.get("errorKind")
        status=report.get("httpStatus")
        require(False,"h58_"+mode+"_"+(phase if phase in phases else "unknown")+
          "_"+(kind if kind in ("timeout","assertion","ambiguous_locator","other") else "unknown")+
          "_http_"+(str(status) if type(status) is int and 100<=status<=599 else "none")+
          "_checks_"+str(int(report.get("checks",0))))
    require(report.get("checks")==expected,"h58_check_count_"+mode)
    print("H58 PASS: "+mode+" HTTP/browser checks="+str(expected),flush=True)

def click_counts(expected):
    # Exact counts across all three synthetic tables, including no writes
    # from cross-token, invalid-token and revoked legacy HTTP calls.
    report=h56.query("""SELECT jsonb_build_object(
      'friendly',(SELECT count(*) FROM public.event_video_clicks),
      'event_video',(SELECT count(*) FROM public.event_video_link_clicks),
      'official',(SELECT count(*) FROM public.official_video_clicks),
      'friendly_valid',(SELECT count(*) FROM public.event_video_clicks v JOIN public.matches m ON m.id=v.match_id AND m.event_id=v.event_id JOIN public.events e ON e.id=v.event_id WHERE e.name='TASK08-H12-HTTP-FRIENDLY-ONLY' AND v.source='share' AND v.referrer IS NULL AND v.user_agent IN ('task08-h58-http','task08-h58-browser')),
      'video_valid',(SELECT count(*) FROM public.event_video_link_clicks v JOIN public.event_video_links l ON l.id=v.event_video_link_id AND l.event_id=v.event_id JOIN public.events e ON e.id=v.event_id WHERE e.name='TASK08-H12-HTTP-FRIENDLY-ONLY' AND v.source='share' AND v.referrer IS NULL AND v.user_agent IN ('task08-h58-http','task08-h58-browser')),
      'official_valid',(SELECT count(*) FROM public.official_video_clicks v JOIN public.official_matches m ON m.id=v.official_match_id AND m.official_event_id=v.official_event_id JOIN public.official_events e ON e.id=v.official_event_id WHERE e.title='TASK08-H12-HTTP-OFFICIAL-ONLY' AND v.source='share' AND v.referrer IS NULL AND v.user_agent IN ('task08-h58-http','task08-h58-browser'))
    )""")
    require(len(report)==6 and all(v==expected for v in report.values()),"h58_click_count_or_scope_diff_expected_"+str(expected))
    print("H58 PASS: independent DB click scope/count/referrer checks; each table="+str(expected),flush=True)

def verify_disabled_clicks(url,key):
    ids=h56.query("""SELECT jsonb_build_object(
      'friendly',(SELECT id FROM public.matches LIMIT 1),
      'video',(SELECT id FROM public.event_video_links LIMIT 1),
      'official',(SELECT id FROM public.official_matches LIMIT 1))""")
    for func,arg,k,t in (
      ("record_event_video_click_by_token","p_match_id","friendly","TASK08H12HTTPFRIENDLYONLY"),
      ("record_event_video_link_click_by_token","p_video_link_id","video","TASK08H12HTTPFRIENDLYONLY"),
      ("record_official_video_click_by_token","p_match_id","official","TASK08H12HTTPOFFICIALONLY")):
        status,data=h55.request(url,"/rest/v1/rpc/"+func,key,body={arg:ids[k],"p_share_token":t,"p_user_agent":"task08-h58-http","p_referrer":None})
        require(status in (200,204) and data is None,"h58_disabled_click_http_"+str(status))

def share_runner(url,key,base,ids,close_runner=None):
    click_counts(0)
    run_browser(url,key,base,ids,"before",10)
    click_counts(2)
    # Release ordering: first verify new share UI, then try the already
    # versioned later closure candidates only on this disposable local DB.
    if close_runner is None:
        h56.local_sql((HERE/"53_h12_anon_shared_base_acl_candidate.sql").read_text(),"h58_local_anon_base_close")
        h56.local_sql((h57.REPO/"supabase/migrations/20261121131943_task08_h35_legacy_video_click_anon_close.sql").read_text(),"h58_local_legacy_click_close")
    else:
        close_runner()
    h56.local_sql("NOTIFY pgrst,'reload schema';","h58_schema_reload")
    print("H58 PASS: existing H12/H35 closure candidates applied locally after positive share acceptance",flush=True)
    run_browser(url,key,base,ids,"after",13)
    click_counts(4)
    h56.local_sql("""BEGIN;
      UPDATE public.events SET share_enabled=false WHERE name IN ('TASK08-H12-HTTP-FRIENDLY-ONLY','TASK08-H12-HTTP-MIXED-ONLY');
      UPDATE public.official_events SET share_enabled=false WHERE title='TASK08-H12-HTTP-OFFICIAL-ONLY';
      COMMIT;""","h58_local_disable_shares")
    run_browser(url,key,base,ids,"disabled",1)
    verify_disabled_clicks(url,key)
    click_counts(4)
    print("H58 PASS: disabled share tokens and clicks denied without changing click counts",flush=True)
    print("H58 LIMITATION: synthetic fixtures; normal/mixed/official share; no live tokens, real YouTube playback, device hardware or authenticated full-event regression",flush=True)

def after_auth(url,key,actors):
    ids=h56.restore_and_test(url,key,actors)
    require(isinstance(ids,dict),"h58_h56_fixture_missing")
    seed(ids)
    h57.browser_test(url,key,actors,ids,browser_runner=share_runner)

if __name__=="__main__":
    try:
        h56.trusted()
        require(not os.getenv("SUPABASE_DB_URL"),"hosted_credential_forbidden")
        h56.instagram_parser_selftest()
        h55.main(after_auth)
    except (RuntimeError,b.BackupError,b.probe.ProbeError) as e:
        print("H58 FAIL: "+str(e),flush=True);sys.exit(1)
    except Exception as e:
        print("H58 FAIL: unexpected_"+type(e).__name__,flush=True);sys.exit(1)
