"""Versioned TASK-08 production release package compiler. OFFLINE RENDER ONLY.
No DB connections, credentials, network, CLI deployment, or automatic apply.
The emitted SQL is a release candidate until independent review, fresh backup,
target checks and explicit production authorization are complete.
"""
import hashlib
import json
import pathlib
import re
import sys

HERE=pathlib.Path(__file__).resolve().parent
REPO=HERE.parents[2]
BASELINE=(
 ("0047","event_result_video"),
 ("0048","private_profile_media"),
 ("0049","profile_avatar_position"),
 ("0050","private_profile_home_court"),
 ("0051","shared_home_facility"),
 ("0052","jpa_existing_facility_corrections"),
 ("0053","jpa_add_15_facilities"),
 ("20261026080052","security_emergency_revoke_anon_writes_official_open_access_20261026"),
 ("20261030013638","rls01_clubs_update_main_admin"),
 ("20261030015325","rls02_clubs_delete_denied"),
 ("20261030023350","rls03_clubs_insert_self"),
 ("20261030033535","rls04a_shared_official_club_name"),
 ("20261030040526","rls04c_clubs_select_visible"),
 ("20261030043914","events_identity_guard"),
 ("20261030050944","rls_batch01_event_insert_delete_and_truncate"),
 ("20261030054948","close_unused_player_stats_client_access"),
 ("20261030072912","restrict_event_participants_insert_update"),
 ("20261030080501","restrict_match_data_delete_and_guard_identities"),
 ("20261030084101","restrict_match_data_insert_update"),
 ("20261102024320","restrict_event_updates_preserve_member_operations"),
 ("20261102050844","restrict_event_scope_select_and_shared_tokens"),
 ("20261102054001","allow_active_members_to_rename_friendly_events"),
)
RELEASE=(
 ("20261124044001","task08_prod_phase1_additive"),
 ("20261124044002","task08_prod_phase2_atomic"),
 ("20261124044003","task08_prod_share_anon_close"),
)
SOURCES={
 "phase1":(HERE/"147_h41_prod_phase1_additive_candidate.sql","5f2a344ec23957554d5a243b292b2e514652abb1"),
 "phase2":(HERE/"145_h40_prod_phase2_atomic_cutover_candidate.sql","024d5b6614e222cbb0da8cb96628c9971994100d"),
 "h51":(HERE/"164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql","355708f527f4fb2b574d10c5cf7540d3fecebb44"),
 "h52":(HERE/"168_h52_media_reference_guard_CANDIDATE.sql","084fc072b2979d2daa10cc535ab1cd713ab9c787"),
 "h12_close":(HERE/"53_h12_anon_shared_base_acl_candidate.sql","a74b446351e1b364523cb219046088b52c59c628"),
 "h62_boundary":(HERE/"183_h62_membership_read_boundary_CANDIDATE.sql","029a91370d6a8fb596c14cb9f771cc541ef9416b"),
 "h35_close":(REPO/"supabase/migrations/20261121131943_task08_h35_legacy_video_click_anon_close.sql","9662868395e39c58d5fa61ad5b214c06b6f3aaed"),
}
def require(condition,reason):
    if not condition:raise RuntimeError(reason)

def body(key):
    path,expected=SOURCES[key]
    raw=path.read_bytes()
    blob=hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
    require(blob==expected,"h61_source_blob_drift_"+key)
    lines=raw.decode("utf-8").splitlines()
    starts=[i for i,l in enumerate(lines) if re.fullmatch(r"\s*BEGIN\s*;\s*",l,re.I)]
    ends=[i for i,l in enumerate(lines) if re.fullmatch(r"\s*COMMIT\s*;\s*",l,re.I)]
    require(len(starts)==len(ends)==1 and starts[0]<ends[0] and not any(l.strip() and not l.lstrip().startswith("--") for l in lines[ends[0]+1:]),"h61_outer_transaction_drift_"+key)
    return "\n".join(lines[:starts[0]]+lines[starts[0]+1:ends[0]]).rstrip()+"\n"

def replace_once(s,old,new):
    require(s.count(old)==1,"h61_expected_anchor_drift")
    return s.replace(old,new,1)

def quote(s):
    return "'"+s.replace("'","''")+"'"

def dollar(s,tag):
    d="$"+tag+"$"
    require(d not in s,"h61_history_quote_collision")
    return d+s+d

def history_gate(expected,tag):
    expected_json=json.dumps(expected,separators=(",",":"))
    return f"""DO ${tag}$
BEGIN
 IF current_user<>'postgres' OR
 (SELECT coalesce(jsonb_agg(jsonb_build_array(version,name) ORDER BY version),'[]'::jsonb)
    FROM supabase_migrations.schema_migrations) IS DISTINCT FROM {quote(expected_json)}::jsonb
 THEN RAISE EXCEPTION 'H61 exact migration history mismatch; STOP'; END IF;
END ${tag}$;
"""

def preflight(index):
    return ("SET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='120s';\n"
            "SET LOCAL standard_conforming_strings=on;\n"
            "LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;\n"
            +history_gate(BASELINE+RELEASE[:index],"h61_before"))

def register(index,segments):
    version,name=RELEASE[index]
    # Record the actual ordered SQL segments (excluding the registration
    # statement itself and outer BEGIN/COMMIT). No pretend historical rows.
    values=",".join(dollar(s,"h61_history_"+str(n)) for n,s in enumerate(segments))
    return f"INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES({quote(version)},{quote(name)},ARRAY[{values}]::text[]);\n"

def postflight(index):
    return history_gate(BASELINE+RELEASE[:index+1],"h61_after")

def render():
    # H62-1 closes the confirmed C1 gap atomically in Phase2.
    boundary=body("h62_boundary")
    p1=body("phase1")
    p2=body("phase2")
    h51=body("h51")
    h52=body("h52")
    h52=replace_once(h52,"-- Requires H51's protected review path and the disposable marker table.","-- Requires H51's protected review path in the SAME release transaction.")
    h52=replace_once(h52," OR to_regclass('public.h51_postcutover_data_preservation') IS NULL\n OR NOT EXISTS(SELECT 1 FROM public.h51_postcutover_data_preservation WHERE marker='retained')",
        """ OR has_any_column_privilege('anon','public.club_members','SELECT')
 OR to_regprocedure('public.review_player_profile_link_named(uuid,text,text,text,boolean)') IS NULL
 OR position('最新版の連携画面' IN pg_get_functiondef('public.review_player_profile_link(uuid,text,text)'::regprocedure))=0
 OR position('profile_link_private.review_player_profile_link_original(p_request_id,''approved'',p_review_token)' IN pg_get_functiondef('public.review_player_profile_link_named(uuid,text,text,text,boolean)'::regprocedure))=0""")
    h52=replace_once(h52,"H52_media_candidate_requires_isolated_post_H51","H61_media_guard_requires_atomic_H51")
    closure=body("h12_close")
    probe="""SELECT jsonb_build_object(
 'anon_raw_tables_closed',true,
 'anon_friendly_valid',public.get_shared_event('TASK08H12HTTPFRIENDLYONLY','event') IS NOT NULL,
 'anon_team_valid',public.get_shared_event('TASK08H12HTTPMIXEDONLY','event') IS NOT NULL,
 'anon_official_valid',public.get_shared_event('TASK08H12HTTPOFFICIALONLY','official') IS NOT NULL,
 'invalid_token_null',public.get_shared_event('TASK08H12INVALID','event') IS NULL
) AS report;\n"""
    closure=replace_once(closure,probe,"")
    h35=body("h35_close")
    checks="""DO $h61_atomic_postflight$
BEGIN
 IF has_any_column_privilege('anon','public.club_members','SELECT')
 OR has_function_privilege('authenticated','profile_link_private.review_player_profile_link_original(uuid,text,text)','EXECUTE')
 OR has_function_privilege('anon','profile_link_private.review_player_profile_link_original(uuid,text,text)','EXECUTE')
 OR position('最新版の連携画面' IN pg_get_functiondef('public.review_player_profile_link(uuid,text,text)'::regprocedure))=0
 OR position('profile_link_private.review_player_profile_link_original(p_request_id,''approved'',p_review_token)' IN pg_get_functiondef('public.review_player_profile_link_named(uuid,text,text,text,boolean)'::regprocedure))=0
 OR position('H52 source private/media' IN pg_get_functiondef('profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'H61 atomic privacy postflight failed'; END IF;
END $h61_atomic_postflight$;
"""
    head="-- TASK-08 H61 REVIEWED-SOURCE RELEASE CANDIDATE. NOT AUTHORIZATION TO APPLY.\n-- Execute individually only after the runbook's external gates. Never db push.\nBEGIN;\n"
    pre=[preflight(i) for i in range(3)]
    post=[postflight(i) for i in range(3)]
    # Phase2 history row is inserted before H51/H52 because their original
    # prerequisite explicitly checks it. ALL segments and registration are
    # in one transaction, so the row cannot survive an H51/H52 failure.
    sqls=[
      head+pre[0]+p1+register(0,[pre[0],p1,post[0]])+post[0]+"COMMIT;\n",
      head+pre[1]+p2+register(1,[pre[1],p2,h51,h52,boundary,checks,post[1]])+h51+h52+boundary+checks+post[1]+"COMMIT;\n",
      "-- Run ONLY AFTER verified NEW Worker deployment and positive real share checks.\n"+head+pre[2]+closure+h35+register(2,[pre[2],closure,h35,post[2]])+post[2]+"COMMIT;\n",
    ]
    for sql in sqls:
        require("209901010100" not in sql and "h51_postcutover_data_preservation" not in sql and "TASK08H12HTTPFRIENDLYONLY" not in sql,"h61_test_only_content")
    return {version+"_"+name+".sql":sql for (version,name),sql in zip(RELEASE,sqls)}

def write_package(output):
    output=pathlib.Path(output)
    output.mkdir(parents=True,exist_ok=False)
    sqls=render()
    hashes={}
    for filename,sql in sqls.items():
        raw=sql.encode("utf-8")
        (output/filename).write_bytes(raw)
        hashes[filename]=hashlib.sha256(raw).hexdigest()
    manifest={"format":"task08-manual-release-v1","baseline":BASELINE,"release":RELEASE,"sha256":hashes,"source_git_blobs":{k:v[1] for k,v in SOURCES.items()},"authorization":"NOT APPROVED FOR PRODUCTION; independent review and H62/H63 required"}
    (output/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    for filename,sha in hashes.items():print("H61 PACKAGE "+filename+" SHA256="+sha,flush=True)
    return sqls

if __name__=="__main__":
    if len(sys.argv)!=3 or sys.argv[1]!="render":
        raise SystemExit("Usage: python 178_h61_release_package.py render NEW_OUTPUT_DIR")
    write_package(sys.argv[2])
