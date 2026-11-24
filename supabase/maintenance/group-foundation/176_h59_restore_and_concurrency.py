"""H59: real concurrent HTTP and reviewed restore on the disposable H56 DB.
No hosted writes. The checked-in restore script is not changed.
"""
import concurrent.futures
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import uuid

HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("h56",HERE/"173_h56_local_app_schema_http.py")
h56=importlib.util.module_from_spec(spec)
spec.loader.exec_module(h56)
h55=h56.h55
b=h56.b
require=h55.require
REPO=HERE.parents[2]

def q(value):
    return b.literal(str(uuid.UUID(value)))+"::uuid"

def login(url,key,actors,role):
    a=next(x for x in actors if x["role"]==role)
    status,data=h55.request(url,"/auth/v1/token?grant_type=password",key,body={"email":a["email"],"password":a["password"]})
    require(status==200 and data.get("user",{}).get("id")==a["uid"] and isinstance(data.get("access_token"),str),"h59_login_"+role)
    return data["access_token"]

def rpc(url,key,token,name,args):
    return h55.request(url,"/rest/v1/rpc/"+name,key,token,args)

def ok(url,key,token,name,args):
    status,data=rpc(url,key,token,name,args)
    require(status==200,"h59_"+name+"_http_"+str(status))
    return data

def seed(ids):
    ids=dict(ids)
    for name in ("club","source","member","event","participant","match","result","slot"):
        ids["race_"+name]=str(uuid.uuid4())
    v=lambda k:q(ids[k])
    h56.local_sql(f"""BEGIN;
    INSERT INTO public.clubs(id,name,owner_id,is_active,visibility) VALUES({v('race_club')},'H59 history club',{v('owner')},true,'public');
    INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
      VALUES({v('race_club')},{v('owner')},{v('owner_profile')},'main_admin',true,'active');
    INSERT INTO public.player_profiles(id,display_name,created_by_auth_user_id,is_active)
      VALUES({v('race_source')},'H59 provisional',{v('owner')},true);
    INSERT INTO public.club_members(id,club_id,player_profile_id,role,is_active,status,club_display_name)
      VALUES({v('race_member')},{v('race_club')},{v('race_source')},'member',true,'active','H59 original');
    INSERT INTO public.events(id,club_id,name,category,court_count,status,closed_at,event_mode,created_by_auth_user_id)
      VALUES({v('race_event')},{v('race_club')},'H59 history','club',1,'closed',now(),'manual',{v('owner')});
    INSERT INTO public.event_participants(id,event_id,player_profile_id,participant_type,status)
      VALUES({v('race_participant')},{v('race_event')},{v('race_source')},'member','active');
    INSERT INTO public.event_participants(event_id,guest_name,participant_type,status)
      SELECT {v('race_event')},'H59 guest '||n,'guest','active' FROM generate_series(1,3)n;
    INSERT INTO public.matches(id,event_id,court_number,completed,youtube_url)
      VALUES({v('race_match')},{v('race_event')},1,true,'https://youtu.be/TASK08H59');
    INSERT INTO public.match_players(id,match_id,participant_id,team)
      VALUES({v('race_slot')},{v('race_match')},{v('race_participant')},'A');
    INSERT INTO public.match_players(match_id,participant_id,team)
      SELECT {v('race_match')},id,CASE WHEN guest_name='H59 guest 1' THEN 'A' ELSE 'B' END
      FROM public.event_participants WHERE event_id={v('race_event')} AND participant_type='guest';
    INSERT INTO public.match_results(id,match_id,score_a,score_b,winner_team)
      VALUES({v('race_result')},{v('race_match')},4,2,'A');
    COMMIT;""","h59_history_seed")
    return ids

def digest(ids):
    # Entire synthetic relevant tables; no row contents printed.
    tables=("clubs","club_members","player_profiles","event_participants","events","matches","match_players","match_results","join_requests","player_profile_link_requests","player_profile_merges","notifications","player_profile_private","profile_media_objects","profile_media_operations")
    parts=[b.literal(t)+",(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) FROM public."+t+" x)" for t in tables]
    parts+=["'merge_changes',(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) FROM profile_link_private.merge_changes x)"]
    return h56.query("SELECT jsonb_build_object("+",".join(parts)+")")

def history(ids):
    v=lambda k:q(ids[k])
    return h56.query(f"""SELECT jsonb_build_object(
      'event',(SELECT to_jsonb(t) FROM public.events t WHERE id={v('race_event')}),
      'match',(SELECT to_jsonb(t) FROM public.matches t WHERE id={v('race_match')}),
      'slots',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.match_players t WHERE match_id={v('race_match')}),
      'score',(SELECT to_jsonb(t) FROM public.match_results t WHERE id={v('race_result')}),
      'participant',(SELECT to_jsonb(t)-'player_profile_id' FROM public.event_participants t WHERE id={v('race_participant')})
    )""")

def raced(url,key,token,name,args1,args2,lock_sql):
    # Hold the actual database lock so both independent HTTP transactions
    # are observable waiting at once; parallel submissions alone are not proof.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        holder=pool.submit(h56.local_sql,"BEGIN; SET LOCAL application_name='task08-h59-gate'; "+lock_sql+"; SELECT pg_sleep(5); COMMIT;","h59_gate")
        until=time.monotonic()+3
        while time.monotonic()<until:
            state=h56.query("SELECT jsonb_build_object('ready',count(*)=1) FROM pg_stat_activity WHERE application_name='task08-h59-gate' AND wait_event='PgSleep'")
            if state["ready"]:break
            time.sleep(.05)
        else: raise RuntimeError("h59_lock_holder_not_ready")
        a=pool.submit(rpc,url,key,token,name,args1)
        c=pool.submit(rpc,url,key,token,name,args2)
        observed=False
        until=time.monotonic()+3
        while time.monotonic()<until and not holder.done():
            report=h56.query("SELECT jsonb_build_object('waiting',count(*)) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE "+b.literal("%"+name+"%"))
            if report["waiting"]>=2:
                observed=True
                break
            time.sleep(.05)
        holder.result(timeout=20)
        results=[a.result(timeout=25),c.result(timeout=25)]
    require(observed,"h59_concurrency_not_observed_"+name)
    print("H59 PASS: two independent HTTP transactions observed concurrently waiting on DB locks for "+name,flush=True)
    return results

def restore_sql(merge,commit):
    sql=(REPO/"supabase/maintenance/profile-linking/04_restore_reviewed_merge.sql").read_text()
    anchor="-- 復旧対象挿入位置"
    require(sql.count(anchor)==1 and re.search(r"(?i)rollback;\s*$",sql) is not None,"h59_restore_source_drift")
    sql=sql.replace(anchor,"INSERT INTO reviewed_merge_restore VALUES("+q(merge)+");")
    if commit:sql=re.sub(r"(?i)rollback;\s*$","COMMIT;",sql)
    return sql

def reject_restore(merge,reason):
    # Capture expected SQLSTATE and reason locally, not raw row IDs/stderr.
    args=h55.DOCKER+["exec","-i",h55.DB,"psql","-U","postgres","-d","postgres","-X","-qAt","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose","-f","-"]
    result=subprocess.run(args,input=restore_sql(merge,True),text=True,capture_output=True,env=h55.ENV,timeout=150)
    require(result.returncode!=0 and re.search(r"ERROR:\s+P0001:",result.stderr) is not None and reason in result.stderr,"h59_restore_expected_rejection_missing")

def after_auth(url,key,actors):
    ids=h56.restore_and_test(url,key,actors)
    require(isinstance(ids,dict),"h59_h56_fixture_missing")
    ids=seed(ids); v=lambda k:q(ids[k])
    owner=login(url,key,actors,"owner")
    recipient=login(url,key,actors,"recipient")
    req=ok(url,key,owner,"request_player_profile_link",{"p_club_id":ids["race_club"],"p_member_id":ids["race_member"],"p_target_auth_user_id":ids["recipient"]})
    req=str(uuid.UUID(req))
    detail=lambda:ok(url,key,recipient,"get_player_profile_link_request",{"p_request_id":req})
    initial=detail()
    require(initial["participant_count"]==1 and initial["match_count"]==1 and initial["result_count"]==1,"h59_preview_history_missing")
    args=lambda d,name:{"p_request_id":req,"p_review_token":d["review_token"],"p_club_display_name":name,"p_expected_club_display_name":d["group_display_name_current"],"p_public_confirmation":True}
    # A real history change invalidates a previously issued consent token.
    h56.local_sql(f"UPDATE public.match_results SET score_a=3 WHERE id={v('race_result')};","h59_history_edit")
    before=digest(ids)
    status,data=rpc(url,key,recipient,"review_player_profile_link_named",args(initial,"H59 stale"))
    require(status==400 and data.get("code")=="P0001" and digest(ids)==before,"h59_stale_history_not_rejected")
    print("H59 PASS: stale consent after score edit rejected; all relevant data unchanged",flush=True)
    fresh=detail()
    require(fresh["review_token"]!=initial["review_token"],"h59_review_token_unchanged")
    original_history=history(ids)
    original_refs=h56.query(f"""SELECT jsonb_build_object(
      'source',(SELECT to_jsonb(t) FROM public.player_profiles t WHERE id={v('race_source')}),
      'member',(SELECT to_jsonb(t) FROM public.club_members t WHERE id={v('race_member')}),
      'participant',(SELECT to_jsonb(t) FROM public.event_participants t WHERE id={v('race_participant')})
    )""")
    outcomes=raced(url,key,recipient,"review_player_profile_link_named",args(fresh,"H59 winner A"),args(fresh,"H59 winner B"),"SELECT profile_link_private.serialize_operations()")
    wins=[data for status,data in outcomes if status==200 and isinstance(data,dict) and data.get("status")=="approved"]
    failures=[data for status,data in outcomes if status==403 and isinstance(data,dict) and data.get("code")=="42501"]
    require(len(wins)==len(failures)==1,"h59_duplicate_approval_outcomes")
    merge=str(uuid.UUID(wins[0]["merge_id"]))
    chosen=wins[0]["club_display_name"]
    require(chosen in ("H59 winner A","H59 winner B"),"h59_winner_name")
    check=h56.query(f"""SELECT jsonb_build_object(
      'audit',(SELECT count(*)=1 FROM public.player_profile_merges WHERE link_request_id={q(req)} AND restored_at IS NULL),
      'source',(SELECT NOT is_active FROM public.player_profiles WHERE id={v('race_source')}),
      'member',(SELECT count(*)=1 FROM public.club_members WHERE club_id={v('race_club')} AND player_profile_id={v('recipient_profile')} AND club_display_name={b.literal(chosen)} AND club_display_name_public_confirmed_at IS NOT NULL),
      'participant',(SELECT player_profile_id={v('recipient_profile')} FROM public.event_participants WHERE id={v('race_participant')}),
      'request',(SELECT status='approved' FROM public.player_profile_link_requests WHERE id={q(req)})
    )""")
    require(all(x is True for x in check.values()) and history(ids)==original_history,"h59_race_committed_rows")
    print("H59 PASS: duplicate approval exactly one success, one denial, one audit; history and score unchanged",flush=True)
    # Unedited merge: exercise original rollback trial and actual disposable commit.
    merged=digest(ids)
    h56.local_sql(restore_sql(merge,False),"h59_restore_trial")
    require(digest(ids)==merged,"h59_restore_trial_mutated")
    h56.local_sql(restore_sql(merge,True),"h59_restore_commit")
    restored=h56.query(f"""SELECT jsonb_build_object(
      'source',(SELECT to_jsonb(t) FROM public.player_profiles t WHERE id={v('race_source')}),
      'member',(SELECT to_jsonb(t) FROM public.club_members t WHERE id={v('race_member')}),
      'participant',(SELECT to_jsonb(t) FROM public.event_participants t WHERE id={v('race_participant')})
    )""")
    require(restored==original_refs and history(ids)==original_history,"h59_restore_original_rows_diff")
    check=h56.query(f"""SELECT jsonb_build_object(
      'audit',(SELECT restored_at IS NOT NULL AND restored_by IS NOT NULL FROM public.player_profile_merges WHERE id={q(merge)}),
      'request',(SELECT status='cancelled' FROM public.player_profile_link_requests WHERE id={q(req)}),
      'other_merges',(SELECT count(*)=2 FROM public.player_profile_merges WHERE source_player_profile_id IN ({v('public_source')},{v('private_source')}) AND restored_at IS NULL),
      'media',(SELECT count(*)=1 FROM public.player_profile_private WHERE profile_id={v('recipient_profile')} AND instagram_username='h56_synthetic' AND avatar_version=1)
    )""")
    require(all(x is True for x in check.values()),"h59_restore_audit_or_other_data")
    print("H59 PASS: reviewed rollback trial and local commit restore exact original source/member/participant, scores and unrelated merges/media retained",flush=True)
    before=digest(ids)
    reject_restore(merge,"復旧済み")
    require(digest(ids)==before,"h59_repeat_restore_mutated")
    print("H59 PASS: repeated restore denied without mutation",flush=True)
    # Two concurrent name changes by actual linked owner on previously merged public membership.
    alias=lambda name:{"p_club_id":ids["public"],"p_member_id":ids["public_member"],"p_display_name":name,"p_expected_club_display_name":"H56 public chosen","p_public_confirmation":True}
    outcomes=raced(url,key,recipient,"save_club_member_display_name",alias("H59 rename A"),alias("H59 rename B"),"SELECT id FROM public.clubs WHERE id="+v("public")+" FOR UPDATE")
    wins=[data for status,data in outcomes if status==200 and isinstance(data,dict)]
    failures=[data for status,data in outcomes if status==409 and isinstance(data,dict) and data.get("code")=="PT409"]
    require(len(wins)==len(failures)==1,"h59_alias_race_outcomes")
    chosen=wins[0]["club_display_name"]
    check=h56.query(f"SELECT jsonb_build_object('saved',club_display_name={b.literal(chosen)} AND club_display_name_public_confirmed_at IS NOT NULL) FROM public.club_members WHERE id={v('public_member')}")
    require(chosen in ("H59 rename A","H59 rename B") and check=={"saved":True},"h59_alias_winner_not_saved")
    print("H59 PASS: concurrent alias CAS one success, one HTTP 409; winner retained",flush=True)
    public_merge=h56.query(f"SELECT jsonb_build_object('id',id) FROM public.player_profile_merges WHERE source_player_profile_id={v('public_source')} AND restored_at IS NULL")["id"]
    before=digest(ids)
    reject_restore(public_merge,"編集・削除")
    require(digest(ids)==before,"h59_edited_restore_mutated")
    print("H59 PASS: restore after actual linked-user edit rejected; entire relevant state unchanged",flush=True)
    print("H59 LIMITATION: synthetic normal match history and two controlled HTTP races; no physical device or exhaustive concurrency/legacy audit coverage",flush=True)

if __name__=="__main__":
    try:
        h56.trusted()
        require(not os.getenv("SUPABASE_DB_URL"),"hosted_credential_forbidden")
        h56.instagram_parser_selftest()
        h55.main(after_auth)
    except (RuntimeError,b.BackupError,b.probe.ProbeError) as e:
        print("H59 FAIL: "+str(e),flush=True);sys.exit(1)
    except Exception as e:
        print("H59 FAIL: unexpected_"+type(e).__name__,flush=True);sys.exit(1)
