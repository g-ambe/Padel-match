"""H46: real membership / simulated JWT role checks in isolated H45 DB.

All identities are selected from the imported real membership relationships.
The candidate's sub_admin -> main_admin change is TEST ONLY inside the local
PostgreSQL transaction and ALWAYS ROLLBACK. No auth records, credentials or
email are read from production. Tiny verified auth.users placeholder rows
(with no email or passwords) are created only inside these transactions.
No UUIDs, user names, JSON rows or JWT identifiers are logged.
"""
from __future__ import annotations
import json

def actor_context(data: dict, require, *, group_name: str = "Wytel Bule Owls") -> dict:
    clubs = [c for c in data["clubs"] if c["name"] == group_name and
             c["is_active"] and not c["is_deleted"]]
    require(len(clubs) == 1, "H46_target_club_not_unique")
    club = clubs[0]
    pp = {p["id"]: p for p in data["player_profiles"]}
    members = [m for m in data["club_members"] if m["club_id"] == club["id"]
               and m["is_active"] and m["status"] == "active"]
    def linked(member):
        player = pp.get(member["player_profile_id"])
        return player["linked_auth_user_id"] if player and player["is_active"] else None
    owners = [m for m in members if m["role"] == "main_admin" and
              linked(m) == club["owner_id"] and linked(m) is not None]
    candidates = [m for m in members if m["role"] == "sub_admin" and
                  linked(m) and linked(m) != club["owner_id"]]
    require(len(owners) == 1 and len(candidates) == 1,
            "H46_current_real_main_and_sub_membership_mismatch")
    require(sum(m["role"] == "main_admin" for m in members) == 1,
            "H46_current_main_admin_count_mismatch")
    users_in_club = {linked(m) for m in members if linked(m)}
    outsiders = sorted(p["id"] for p in data["profiles"]
                      if p["id"] not in users_in_club)
    require(bool(outsiders), "H46_no_real_other_club_account")
    userids = {p["id"] for p in data["profiles"]}
    require({club["owner_id"], linked(candidates[0]), outsiders[0]}
            .issubset(userids), "H46_missing_public_account_identity")
    return {
        "club": club["id"], "owner": club["owner_id"],
        "owner_member": owners[0]["id"], "candidate": linked(candidates[0]),
        "candidate_member": candidates[0]["id"], "outsider": outsiders[0],
    }

PREFIX = r"""
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
SET LOCAL ROLE postgres;
DO $guard$
BEGIN
 IF to_regprocedure('public.leave_my_club(uuid,uuid)') IS NULL
 OR to_regprocedure('public.request_club_owner_transfer(uuid,uuid)') IS NULL
 OR to_regprocedure('public.respond_club_owner_transfer(uuid,text)') IS NULL
 OR (SELECT count(*) FROM public.club_owner_transfer_requests)<>0
 OR (SELECT count(*) FROM auth.users)<>0
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.club_members)<>41
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations
     WHERE name IN('task08_prod_phase1_additive','task08_prod_phase2_atomic'))<>2
 THEN RAISE EXCEPTION 'H46_NOT_ISOLATED_MIGRATED_FIXTURE'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.clubs c JOIN public.club_members cm
   ON cm.club_id=c.id JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
  WHERE c.id=__CLUB__ AND c.owner_id=__OWNER__
   AND cm.id=__OWNER_MID__ AND cm.role='main_admin'
   AND cm.is_active AND cm.status='active'
   AND pp.linked_auth_user_id=__OWNER__
 ) OR NOT EXISTS (
  SELECT 1 FROM public.club_members cm JOIN public.player_profiles pp
   ON pp.id=cm.player_profile_id
  WHERE cm.id=__CANDIDATE_MID__ AND cm.club_id=__CLUB__
   AND cm.role='sub_admin' AND cm.is_active AND cm.status='active'
   AND pp.linked_auth_user_id=__CANDIDATE__
 ) THEN RAISE EXCEPTION 'H46_REAL_MEMBERSHIP_CHANGED'; END IF;
END $guard$;
-- auth.users on this restored schema is empty. Insert ONLY three fake
-- confirmed auth identities matching existing public.profiles UUIDs;
-- no email, password, session, token or credentials are copied.
INSERT INTO auth.users(id,aud,role,email_confirmed_at)
VALUES (__OWNER__,'authenticated','authenticated',statement_timestamp()),
       (__CANDIDATE__,'authenticated','authenticated',statement_timestamp()),
       (__OUTSIDER__,'authenticated','authenticated',statement_timestamp());
"""

REJECTION_AND_SELF_EXIT = r"""
SET LOCAL ROLE anon;
DO $anon$
DECLARE blocked boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
  PERFORM public.leave_my_club(__CLUB__,__CANDIDATE_MID__);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_ANON_EXIT_ALLOWED'; END IF;
END $anon$;
SET LOCAL ROLE authenticated;
DO $owner$
DECLARE blocked boolean:=false; n integer;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OWNER__::text,true);
 BEGIN
  PERFORM public.leave_my_club(__CLUB__,__OWNER_MID__);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_OWNER_EXIT_ALLOWED'; END IF;
 SELECT count(*) INTO n FROM public.get_club_owner_transfer_candidates(__CLUB__);
 IF n<>0 THEN RAISE EXCEPTION 'H46_SUB_WAS_OFFERED_AS_OWNER_CANDIDATE'; END IF;
 blocked:=false;
 BEGIN
  PERFORM public.request_club_owner_transfer(__CLUB__,__CANDIDATE_MID__);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_SUB_TRANSFER_REQUEST_ALLOWED'; END IF;
END $owner$;
DO $outsider$
DECLARE blocked boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OUTSIDER__::text,true);
 BEGIN
  PERFORM public.leave_my_club(__CLUB__,__CANDIDATE_MID__);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_THIRD_PARTY_EXIT_ALLOWED'; END IF;
END $outsider$;
DO $sub$
DECLARE blocked boolean:=false; got uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__CANDIDATE__::text,true);
 got:=public.leave_my_club(__CLUB__,__CANDIDATE_MID__);
 IF got IS DISTINCT FROM __CANDIDATE_MID__ THEN
  RAISE EXCEPTION 'H46_SUB_EXIT_RETURN_INVALID'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.club_members WHERE id=__CANDIDATE_MID__
   AND club_id=__CLUB__ AND role='sub_admin' AND NOT is_active
 ) OR NOT EXISTS (
  SELECT 1 FROM public.player_profiles pp JOIN public.club_members cm
    ON cm.player_profile_id=pp.id WHERE cm.id=__CANDIDATE_MID__ AND pp.is_active
 ) THEN RAISE EXCEPTION 'H46_SUB_EXIT_DID_NOT_PRESERVE_PROFILE_HISTORY'; END IF;
 BEGIN
  PERFORM public.leave_my_club(__CLUB__,__CANDIDATE_MID__);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_REPEAT_EXIT_ALLOWED'; END IF;
 IF (SELECT owner_id FROM public.clubs WHERE id=__CLUB__) IS DISTINCT FROM __OWNER__
 THEN RAISE EXCEPTION 'H46_OWNER_CHANGED_BY_SUB_EXIT'; END IF;
END $sub$;
SET LOCAL ROLE postgres;
SELECT json_build_object('scenario','real_roles_self_exit','pass',true);
ROLLBACK;
"""

TRANSFER_ACCEPT = r"""
DO $promote$
DECLARE n integer;
BEGIN
 UPDATE public.club_members SET role='main_admin'
 WHERE id=__CANDIDATE_MID__ AND role='sub_admin' AND is_active;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'H46_TEST_ONLY_PROMOTION_FAILED'; END IF;
END $promote$;
SET LOCAL ROLE authenticated;
DO $owner$
DECLARE n integer; target uuid; denied boolean:=false; request_id uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OWNER__::text,true);
 SELECT count(*),(array_agg(member_id))[1] INTO n,target
 FROM public.get_club_owner_transfer_candidates(__CLUB__);
 IF n<>1 OR target IS DISTINCT FROM __CANDIDATE_MID__
 THEN RAISE EXCEPTION 'H46_OWNER_CANDIDATE_LIST_INVALID'; END IF;
 request_id:=public.request_club_owner_transfer(__CLUB__,__CANDIDATE_MID__);
 PERFORM set_config('h46.request',request_id::text,true);
 BEGIN
  PERFORM public.request_club_owner_transfer(__CLUB__,__CANDIDATE_MID__);
 EXCEPTION WHEN SQLSTATE 'PT409' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'H46_DUPLICATE_REQUEST_ALLOWED'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.leave_my_club(__CLUB__,__OWNER_MID__);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'H46_OWNER_EXIT_WHILE_REQUEST_PENDING'; END IF;
END $owner$;
DO $outsider$
DECLARE blocked boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OUTSIDER__::text,true);
 BEGIN
  PERFORM public.respond_club_owner_transfer(current_setting('h46.request')::uuid,'accepted');
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_OUTSIDER_ACCEPTED_TRANSFER'; END IF;
END $outsider$;
DO $decline$
DECLARE got text;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__CANDIDATE__::text,true);
 got:=public.respond_club_owner_transfer(current_setting('h46.request')::uuid,'declined');
 IF got<>'declined' THEN RAISE EXCEPTION 'H46_DECLINE_FAILED'; END IF;
 IF (SELECT owner_id FROM public.clubs WHERE id=__CLUB__) IS DISTINCT FROM __OWNER__
 THEN RAISE EXCEPTION 'H46_DECLINE_TRANSFERRED_OWNER'; END IF;
END $decline$;
DO $second$
DECLARE request_id uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OWNER__::text,true);
 request_id:=public.request_club_owner_transfer(__CLUB__,__CANDIDATE_MID__);
 PERFORM set_config('h46.second_request',request_id::text,true);
END $second$;
DO $accept$
DECLARE got text; blocked boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__CANDIDATE__::text,true);
 got:=public.respond_club_owner_transfer(
   current_setting('h46.second_request')::uuid,'accepted');
 IF got<>'accepted' THEN RAISE EXCEPTION 'H46_ACCEPT_FAILED'; END IF;
 BEGIN
  PERFORM public.respond_club_owner_transfer(
   current_setting('h46.second_request')::uuid,'accepted');
 EXCEPTION WHEN SQLSTATE 'PT409' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_ACCEPT_REPLAY_ALLOWED'; END IF;
 IF (SELECT owner_id FROM public.clubs WHERE id=__CLUB__) IS DISTINCT FROM __CANDIDATE__
 THEN RAISE EXCEPTION 'H46_ACCEPT_NOT_ASSIGNED_NEW_OWNER'; END IF;
END $accept$;
SET LOCAL ROLE postgres;
DO $new_owner_guard$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  UPDATE public.club_members SET is_active=false WHERE id=__CANDIDATE_MID__;
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_NEW_OWNER_DIRECT_EXIT_ALLOWED'; END IF;
END $new_owner_guard$;
SET LOCAL ROLE authenticated;
DO $former_owner$
DECLARE got uuid; blocked boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OWNER__::text,true);
 got:=public.leave_my_club(__CLUB__,__OWNER_MID__);
 IF got IS DISTINCT FROM __OWNER_MID__ THEN
  RAISE EXCEPTION 'H46_FORMER_OWNER_EXIT_RETURN_INVALID'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.club_members
   WHERE id=__OWNER_MID__ AND role='main_admin' AND NOT is_active)
 OR NOT EXISTS (
   SELECT 1 FROM public.player_profiles pp JOIN public.club_members cm
    ON cm.player_profile_id=pp.id WHERE cm.id=__OWNER_MID__ AND pp.is_active
 )
 THEN RAISE EXCEPTION 'H46_FORMER_OWNER_HISTORY_LOST'; END IF;
 PERFORM set_config('request.jwt.claim.sub',__CANDIDATE__::text,true);
 BEGIN
  PERFORM public.leave_my_club(__CLUB__,__CANDIDATE_MID__);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_NEW_OWNER_EXIT_ALLOWED'; END IF;
END $former_owner$;
SET LOCAL ROLE postgres;
DO $assert$
BEGIN
 IF (SELECT count(*) FROM public.club_owner_transfer_requests
     WHERE club_id=__CLUB__ AND status='declined')<>1
 OR (SELECT count(*) FROM public.club_owner_transfer_requests
     WHERE club_id=__CLUB__ AND status='accepted')<>1
 OR (SELECT count(*) FROM public.notifications
     WHERE related_club_id=__CLUB__ AND related_owner_transfer_request_id IS NOT NULL)<>4
 OR (SELECT count(*) FROM public.club_members WHERE club_id=__CLUB__
     AND is_active AND role='main_admin')<>1
 THEN RAISE EXCEPTION 'H46_TRANSFER_STATE_OR_NOTIFICATION_COUNT_INVALID'; END IF;
END $assert$;
SELECT json_build_object('scenario','test_only_promoted_transfer_and_exit','pass',true);
ROLLBACK;
"""

TRANSFER_STALE_CANCEL = r"""
DO $promote$
BEGIN
 UPDATE public.club_members SET role='main_admin'
 WHERE id=__CANDIDATE_MID__ AND role='sub_admin' AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'H46_TEST_PROMOTE_FAILED'; END IF;
END $promote$;
SET LOCAL ROLE authenticated;
DO $request$
DECLARE request_id uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OWNER__::text,true);
 request_id:=public.request_club_owner_transfer(__CLUB__,__CANDIDATE_MID__);
 PERFORM set_config('h46.request',request_id::text,true);
END $request$;
SET LOCAL ROLE postgres;
UPDATE public.club_members SET role='sub_admin'
 WHERE id=__CANDIDATE_MID__ AND role='main_admin';
SET LOCAL ROLE authenticated;
DO $demote_decline$
DECLARE blocked boolean:=false; got text;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__CANDIDATE__::text,true);
 BEGIN
  PERFORM public.respond_club_owner_transfer(current_setting('h46.request')::uuid,'accepted');
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_DEMOTED_CANDIDATE_ACCEPTED'; END IF;
 got:=public.respond_club_owner_transfer(current_setting('h46.request')::uuid,'declined');
 IF got<>'declined' THEN RAISE EXCEPTION 'H46_DEMOTED_CANDIDATE_CANNOT_DECLINE'; END IF;
END $demote_decline$;
DO $no_new_request$
DECLARE blocked boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OWNER__::text,true);
 BEGIN PERFORM public.request_club_owner_transfer(__CLUB__,__CANDIDATE_MID__);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_DEMOTED_CANDIDATE_REPROPOSED'; END IF;
END $no_new_request$;
SET LOCAL ROLE postgres;
UPDATE public.club_members SET role='main_admin'
 WHERE id=__CANDIDATE_MID__ AND role='sub_admin';
SET LOCAL ROLE authenticated;
DO $new_request$
DECLARE r uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OWNER__::text,true);
 r:=public.request_club_owner_transfer(__CLUB__,__CANDIDATE_MID__);
 PERFORM set_config('h46.cancel_request',r::text,true);
END $new_request$;
DO $third_party_cancel$
DECLARE blocked boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OUTSIDER__::text,true);
 BEGIN
  PERFORM public.cancel_club_owner_transfer(current_setting('h46.cancel_request')::uuid);
 EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_OUTSIDER_CANCELLED_OWNER_REQUEST'; END IF;
END $third_party_cancel$;
DO $cancel$
DECLARE blocked boolean:=false; got text;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__OWNER__::text,true);
 got:=public.cancel_club_owner_transfer(current_setting('h46.cancel_request')::uuid);
 IF got<>'cancelled' THEN RAISE EXCEPTION 'H46_OWNER_CANCEL_FAILED'; END IF;
 BEGIN
  PERFORM public.cancel_club_owner_transfer(current_setting('h46.cancel_request')::uuid);
 EXCEPTION WHEN SQLSTATE 'PT409' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_CANCEL_REPLAY_ALLOWED'; END IF;
END $cancel$;
DO $after_cancel$
DECLARE blocked boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',__CANDIDATE__::text,true);
 BEGIN
  PERFORM public.respond_club_owner_transfer(current_setting('h46.cancel_request')::uuid,'accepted');
 EXCEPTION WHEN SQLSTATE 'PT409' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'H46_CANCELLED_TRANSFER_ACCEPTED'; END IF;
END $after_cancel$;
SET LOCAL ROLE postgres;
DO $assert$
BEGIN
 IF (SELECT owner_id FROM public.clubs WHERE id=__CLUB__) IS DISTINCT FROM __OWNER__
 OR (SELECT count(*) FROM public.club_owner_transfer_requests
     WHERE club_id=__CLUB__ AND status='declined')<>1
 OR (SELECT count(*) FROM public.club_owner_transfer_requests
     WHERE club_id=__CLUB__ AND status='cancelled')<>1
 OR (SELECT count(*) FROM public.notifications
     WHERE related_club_id=__CLUB__ AND related_owner_transfer_request_id IS NOT NULL)<>4
 THEN RAISE EXCEPTION 'H46_CANCEL_OR_DECLINE_STATE_INVALID'; END IF;
END $assert$;
SELECT json_build_object('scenario','demoted_decline_and_cancel','pass',true);
ROLLBACK;
"""

def run(target, source: dict, require, b, h44, h45) -> None:
    require(isinstance(target, b.LocalRestore), "H46_isolated_local_only")
    actors = actor_context(source, require)
    encoded = {
        "__CLUB__": b.literal(actors["club"]) + "::uuid",
        "__OWNER__": b.literal(actors["owner"]) + "::uuid",
        "__OWNER_MID__": b.literal(actors["owner_member"]) + "::uuid",
        "__CANDIDATE__": b.literal(actors["candidate"]) + "::uuid",
        "__CANDIDATE_MID__": b.literal(actors["candidate_member"]) + "::uuid",
        "__OUTSIDER__": b.literal(actors["outsider"]) + "::uuid",
    }
    baseline = h45.digest(source)
    # Three independent transaction/rollback scenarios; each starts with
    # original real owner/main + candidate/sub and no fake auth.users rows.
    scenarios = (
        ("real_roles_self_exit", REJECTION_AND_SELF_EXIT),
        ("test_only_promoted_transfer_and_exit", TRANSFER_ACCEPT),
        ("demoted_decline_and_cancel", TRANSFER_STALE_CANCEL),
    )
    for label, sql in scenarios:
        statement = PREFIX + sql
        for marker, value in encoded.items():
            statement = statement.replace(marker, value)
        require("__" not in statement, "H46_unexpanded_identifier_placeholder")
        try:
            output = h44.isolated(target, statement)
        except b.BackupError:
            if label == "test_only_promoted_transfer_and_exit":
                # Diagnose a failure with successively longer, independently
                # rolled-back statement prefixes. Only a fixed stage name
                # is logged; postgres stderr/SQL/identities remain masked.
                checkpoints = (
                    ("promote", "SET LOCAL ROLE authenticated;\nDO $owner$"),
                    ("owner_request", "DO $outsider$"),
                    ("outsider_reject", "DO $decline$"),
                    ("decline", "DO $second$"),
                    ("second_request", "DO $accept$"),
                    ("accept", "SET LOCAL ROLE postgres;\nDO $new_owner_guard$"),
                    ("new_owner_guard", "SET LOCAL ROLE authenticated;\nDO $former_owner$"),
                    ("former_owner_exit", "SET LOCAL ROLE postgres;\nDO $assert$"),
                    ("state_assertion", "SELECT json_build_object('scenario','test_only_promoted_transfer_and_exit'"),
                )
                for stage, next_marker in checkpoints:
                    require(next_marker in TRANSFER_ACCEPT,
                            "H46_diagnostic_marker_missing_" + stage)
                    preview = PREFIX + TRANSFER_ACCEPT.split(next_marker, 1)[0] + "\nROLLBACK;\n"
                    for marker, value in encoded.items():
                        preview = preview.replace(marker, value)
                    try:
                        h44.isolated(target, preview)
                    except b.BackupError:
                        print("H46 diagnostic stage failed: " + stage, flush=True)
                        raise b.BackupError("H46_transfer_check_failed_" + stage) from None
            raise
        try:
            lines = [json.loads(line) for line in output.splitlines()
                     if line.strip().startswith("{")]
        except ValueError:
            raise b.BackupError("H46_isolated_probe_json_invalid") from None
        require(len(lines) == 1 and lines[0] == {"scenario": label, "pass": True},
                "H46_missing_scenario_assertion_" + label)
        require(h45.digest(target.query(h45.rows_sql())) == baseline,
                "H46_source_rows_not_restored_after_rollback_" + label)
        remaining = target.query("""SELECT json_build_object(
            'notifications',(SELECT count(*) FROM public.notifications),
            'owner_requests',(SELECT count(*) FROM public.club_owner_transfer_requests),
            'auth_users',(SELECT count(*) FROM auth.users))""")
        require(remaining == {"notifications":0,"owner_requests":0,"auth_users":0},
                "H46_temporary_role_scenario_rows_remain_" + label)
        print("H46 PASS: " + label + " (rollback + original real records unchanged)",flush=True)
    print("H46 ALL PASS: real owner/sub membership roles, explicit-consent transfer,"
          " blocked misuse, former-owner self-exit, history retained; all local changes rolled back",
          flush=True)
