\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE mgr uuid:='10000000-0000-4000-8000-000000000001'; actor uuid:='10000000-0000-4000-8000-000000000003';c uuid:='30000000-0000-4000-8000-000000000003';m uuid:=gen_random_uuid();src uuid:=gen_random_uuid(); inv uuid;gen int;op uuid:=gen_random_uuid(); s text; a jsonb;pv jsonb; BEGIN
 INSERT INTO player_profiles(id,display_name) VALUES(src,'架空未連携');INSERT INTO club_members(id,club_id,player_profile_id,role) VALUES(m,c,src,'member');
 PERFORM set_config('request.jwt.claim.sub',mgr::text,true);a:=public.check_club_invite_account(c,m,'rebind-new@example.test');IF a->>'status'<>'signup_required' THEN RAISE EXCEPTION 'check %',a;END IF;
 a:=public.reserve_club_invite_send(mgr,c,m,op,a->>'ticket','rebind-new@example.test'); IF a->>'status'<>'reserved' THEN RAISE EXCEPTION 'reserve %',a;END IF;inv:=(a->>'invite_id')::uuid;gen:=(a->>'generation')::int;
 a:=public.claim_club_invite_send(op);s:=a->>'secret';IF a->>'status'<>'claimed' THEN RAISE EXCEPTION 'claim %',a;END IF;PERFORM public.finalize_club_invite_send(op,gen,'sent',NULL);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);pv:=public.preview_club_invite_rebind(inv,gen,s);IF pv->>'status'<>'ok' THEN RAISE EXCEPTION 'preview %',pv;END IF;
 a:=public.rebind_club_invite(gen_random_uuid(),inv,gen,s,false,pv->>'account_review_token');IF a->>'status'<>'not_found' THEN RAISE EXCEPTION 'consent %',a;END IF;
 a:=public.rebind_club_invite(gen_random_uuid(),inv,gen,s,true,pv->>'account_review_token');IF a->>'status'<>'rebound' THEN RAISE EXCEPTION 'rebind %',a;END IF;
 a:=public.preview_club_invite_rebind(inv,gen,s);IF a->>'status'<>'not_found' THEN RAISE EXCEPTION 'old link %',a;END IF;
 UPDATE auth.users SET email='changed@example.test' WHERE id=actor;
 a:=public.preview_my_club_invite(inv,gen);IF a->>'status'<>'not_found' THEN RAISE EXCEPTION 'email changed %',a;END IF;
 RAISE NOTICE 'PASS rebind consent, old link invalid, changed email deny';
END $$;
ROLLBACK;
