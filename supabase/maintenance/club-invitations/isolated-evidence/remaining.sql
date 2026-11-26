\set ON_ERROR_STOP on
-- All users, keys, records and emails in this file are synthetic.
BEGIN;
DO $$ DECLARE mgr uuid:='10000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001';m uuid:='40000000-0000-4000-8000-000000000002';a jsonb; ticket text; BEGIN
 PERFORM set_config('request.jwt.claim.sub',mgr::text,true);
 a:=public.check_club_invite_account(c,m,'revocation@example.test'); IF a->>'status'<>'signup_required' THEN RAISE EXCEPTION 'check %',a; END IF;ticket:=a->>'ticket';
 UPDATE club_members SET role='member' WHERE profile_id=mgr AND club_id=c;
 a:=public.reserve_club_invite_send(mgr,c,m,gen_random_uuid(),ticket,'revocation@example.test');IF a->>'status'<>'not_found' THEN RAISE EXCEPTION 'revoked manager allowed %',a;END IF;
 RAISE NOTICE 'PASS role revoked after check: reserve denied';
END $$;
ROLLBACK;

BEGIN;
DO $$ DECLARE mgr uuid:='10000000-0000-4000-8000-000000000001'; user_id uuid:='10000000-0000-4000-8000-000000000099'; target uuid:='20000000-0000-4000-8000-000000000099';c uuid:='30000000-0000-4000-8000-000000000001';m uuid:='40000000-0000-4000-8000-000000000002';op uuid:=gen_random_uuid();inv uuid;gen int; a jsonb;pv jsonb; before_row jsonb; BEGIN
 PERFORM set_config('request.jwt.claim.sub',mgr::text,true); a:=public.check_club_invite_account(c,m,'scope@example.test');a:=public.reserve_club_invite_send(mgr,c,m,op,a->>'ticket','scope@example.test');IF a->>'status'<>'reserved' THEN RAISE EXCEPTION 'reserve %',a;END IF;inv:=(a->>'invite_id')::uuid;gen:=(a->>'generation')::int;
 a:=public.claim_club_invite_send(op);IF a->>'status'<>'claimed' THEN RAISE EXCEPTION 'claim %',a;END IF;PERFORM public.finalize_club_invite_send(op,gen,'sent',NULL);
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(user_id,'scope@example.test',now());INSERT INTO profiles(id,display_name,email) VALUES(user_id,'架空本人','scope@example.test');INSERT INTO player_profiles(id,linked_auth_user_id,display_name) VALUES(target,user_id,'架空本人');
 PERFORM set_config('request.jwt.claim.sub',user_id::text,true);pv:=public.preview_my_club_invite(inv,gen);IF pv->>'status'<>'ok' THEN RAISE EXCEPTION 'preview %',pv;END IF;
 INSERT INTO event_participants(id,event_id,player_profile_id,status,participant_type) VALUES(gen_random_uuid(),'50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','active','member');
 SELECT to_jsonb(t) INTO before_row FROM club_members t WHERE id=m;
 a:=public.accept_my_club_invite(inv,gen,gen_random_uuid(),pv->>'review_token',pv->>'group_display_name_current',pv->>'group_visibility','本人',true,true);
 IF a->>'status' NOT IN ('conflict','not_found') THEN RAISE EXCEPTION 'foreign scope allowed %',a;END IF;
 IF (SELECT to_jsonb(t) FROM club_members t WHERE id=m) IS DISTINCT FROM before_row OR EXISTS(SELECT 1 FROM player_profile_merges WHERE target_auth_user_id=user_id) THEN RAISE EXCEPTION 'scope denial changed data'; END IF;
 RAISE NOTICE 'PASS after-preview other-group history: accept denied and membership/audit intact';
END $$;
ROLLBACK;

BEGIN;
DO $$ DECLARE mgr uuid:='10000000-0000-4000-8000-000000000001';c uuid:='30000000-0000-4000-8000-000000000001';m uuid:='40000000-0000-4000-8000-000000000002';op uuid:=gen_random_uuid();op2 uuid:=gen_random_uuid();inv uuid;gen int;a jsonb; oldsecret text;expiry timestamptz; BEGIN
 PERFORM set_config('request.jwt.claim.sub',mgr::text,true);a:=public.check_club_invite_account(c,m,'expiry@example.test');a:=public.reserve_club_invite_send(mgr,c,m,op,a->>'ticket','expiry@example.test');IF a->>'status'<>'reserved' THEN RAISE EXCEPTION 'reserve %',a;END IF;inv:=(a->>'invite_id')::uuid;gen:=(a->>'generation')::int;
 SELECT expires_at INTO expiry FROM club_invite_private.invitations WHERE id=inv;IF (SELECT expires_at-created_at FROM club_invite_private.invitations WHERE id=inv)<>interval '168 hours' THEN RAISE EXCEPTION 'seven days';END IF;
 a:=public.claim_club_invite_send(op);oldsecret:=a->>'secret';PERFORM public.finalize_club_invite_send(op,gen,'sent',NULL);
 UPDATE club_invite_private.send_attempts SET reserved_at=reserved_at-interval '2 minutes',day_jst=((reserved_at-interval '2 minutes') AT TIME ZONE 'Asia/Tokyo')::date WHERE operation_id=op;
 a:=public.reserve_club_invite_resend(mgr,'manager',inv,gen,op2,'group_invite',NULL,NULL);IF a->>'status'<>'reserved' THEN RAISE EXCEPTION 'resend %',a;END IF;
 IF (SELECT expires_at FROM club_invite_private.invitations WHERE id=inv)<>expiry OR (SELECT recovery_digest FROM club_invite_private.invitations WHERE id=inv) IS NOT NULL THEN RAISE EXCEPTION 'expiry or token';END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
 a:=public.preview_club_invite_rebind(inv,gen,oldsecret);IF a->>'status'<>'not_found' THEN RAISE EXCEPTION 'old token accepted %',a;END IF;
 RAISE NOTICE 'PASS initial 168h, resend expiry unchanged, old token rejected';
END $$;
ROLLBACK;

BEGIN;
DO $$ DECLARE c uuid:='30000000-0000-4000-8000-000000000001';m uuid:='40000000-0000-4000-8000-000000000002';mgr uuid:='10000000-0000-4000-8000-000000000001';i uuid:=gen_random_uuid();d bytea:=decode(repeat('aa',32),'hex');q text;t timestamptz:='2026-11-25 15:00:00+00'; BEGIN
 INSERT INTO club_invite_private.invitations(id,club_id,member_id,source_profile_id,inviter_auth_id,email_digest,generation,created_at,expires_at) VALUES(i,c,m,gen_random_uuid(),mgr,d,1,t-interval '1 hour',t+interval '1 day');
 INSERT INTO club_invite_private.send_attempts(operation_id,invite_id,club_id,member_id,quota_manager_id,email_digest,generation,actor_kind,reserved_at,day_jst,status,finished_at,kind,request_digest,actor_binding_digest,request_kind,reservation_auth_kind,reservation_actor_auth_id)
 SELECT gen_random_uuid(),i,c,m,mgr,d,1,'manager',t-interval '61 seconds',(t-interval '61 seconds') AT TIME ZONE 'Asia/Tokyo','failed',t,'auth_confirmation',d,d,'auth_resend','manager',mgr FROM generate_series(1,3);
 q:=club_invite_private.quota_check(m,d,mgr,c,t);IF q<>'ok' THEN RAISE EXCEPTION 'JST rollover %',q;END IF;
 UPDATE club_invite_private.send_attempts SET reserved_at=t-interval '59 seconds',day_jst=(t-interval '59 seconds') AT TIME ZONE 'Asia/Tokyo' WHERE invite_id=i;
 q:=club_invite_private.quota_check(m,d,mgr,c,t);IF q<>'cooldown' THEN RAISE EXCEPTION '60-sec %',q;END IF;
 RAISE NOTICE 'PASS JST date rollover and 60s cross-day cooldown';
END $$;
ROLLBACK;

BEGIN;
DO $$ DECLARE u uuid:='10000000-0000-4000-8000-000000000001';c uuid:='30000000-0000-4000-8000-000000000001';m uuid:='40000000-0000-4000-8000-000000000002';d bytea:=decode(repeat('bb',32),'hex');a uuid:=gen_random_uuid();b uuid:=gen_random_uuid(); t timestamptz:=clock_timestamp();BEGIN
 INSERT INTO club_invite_private.invitations(id,club_id,member_id,source_profile_id,inviter_auth_id,email_digest,status,created_at,expires_at,decided_at) VALUES(a,c,m,gen_random_uuid(),u,d,'cancelled',t-interval '38 days',t-interval '32 days',t-interval '30 days 1 second'),(b,c,m,gen_random_uuid(),u,d,'cancelled',t-interval '36 days',t-interval '30 days',t-interval '29 days 23 hours 59 minutes 59 seconds');
 PERFORM club_invite_private.cleanup_retention();
 IF EXISTS(SELECT 1 FROM club_invite_private.invitations WHERE id=a) OR NOT EXISTS(SELECT 1 FROM club_invite_private.invitations WHERE id=b) THEN RAISE EXCEPTION 'retention boundary';END IF;
 RAISE NOTICE 'PASS 30-day retention boundary ±1 second';
END $$;
ROLLBACK;

BEGIN;
DO $$ DECLARE mgr uuid:='10000000-0000-4000-8000-000000000001'; uid uuid:='10000000-0000-4000-8000-000000000098';c uuid:='30000000-0000-4000-8000-000000000001';m uuid:='40000000-0000-4000-8000-000000000002';op uuid:=gen_random_uuid();inv uuid;gen int;a jsonb; oldticket text; BEGIN
 PERFORM set_config('request.jwt.claim.sub',mgr::text,true);a:=public.check_club_invite_account(c,m,'reject-new@example.test');oldticket:=a->>'ticket';a:=public.reserve_club_invite_send(mgr,c,m,op,oldticket,'reject-new@example.test');IF a->>'status'<>'reserved' THEN RAISE EXCEPTION 'initial %',a;END IF;inv:=(a->>'invite_id')::uuid;gen:=(a->>'generation')::int;
 a:=public.claim_club_invite_send(op);IF a->>'status'<>'claimed' THEN RAISE EXCEPTION 'claim';END IF;PERFORM public.finalize_club_invite_send(op,gen,'sent',NULL);
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(uid,'reject-new@example.test',now()); INSERT INTO profiles(id,display_name,email) VALUES(uid,'架空本人','reject-new@example.test');INSERT INTO player_profiles(id,linked_auth_user_id,display_name) VALUES(gen_random_uuid(),uid,'架空本人');
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);a:=public.reject_my_club_invite(inv,gen,gen_random_uuid());IF a->>'status'<>'rejected' THEN RAISE EXCEPTION 'reject %',a;END IF;
 PERFORM set_config('request.jwt.claim.sub',mgr::text,true);a:=public.reserve_club_invite_send(mgr,c,m,gen_random_uuid(),oldticket,'reject-new@example.test');IF a->>'status' IN ('reserved','sent') THEN RAISE EXCEPTION 'old ticket accepted %',a;END IF;
 a:=public.check_club_invite_account(c,m,'fresh-different@example.test');IF a->>'status'<>'signup_required' OR a->>'ticket'=oldticket THEN RAISE EXCEPTION 'fresh check %',a;END IF;
 RAISE NOTICE 'PASS reject invalidates old ticket; fresh explicit check succeeds';
END $$;
ROLLBACK;
