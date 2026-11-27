\set ON_ERROR_STOP on
DO $$ DECLARE mgr uuid:='10000000-0000-4000-8000-000000000001'; c uuid:='30000000-0000-4000-8000-000000000001'; m uuid:='40000000-0000-4000-8000-000000000002'; recipient uuid:='10000000-0000-4000-8000-000000000099'; target uuid:='20000000-0000-4000-8000-000000000099'; a jsonb; pv jsonb; inv uuid; gen integer; op uuid:=gen_random_uuid(); acceptop uuid:=gen_random_uuid(); BEGIN
 PERFORM set_config('request.jwt.claim.sub',mgr::text,true);
 a:=public.check_club_invite_account(c,m,'new-accept@example.test'); IF a->>'status'<>'signup_required' THEN RAISE EXCEPTION 'check %',a; END IF;
 a:=public.reserve_club_invite_send(mgr,c,m,op,a->>'ticket','new-accept@example.test'); IF a->>'status'<>'reserved' THEN RAISE EXCEPTION 'reserve %',a; END IF;inv:=(a->>'invite_id')::uuid;gen:=(a->>'generation')::int;
 a:=public.claim_club_invite_send(op); IF a->>'status'<>'claimed' THEN RAISE EXCEPTION 'claim %',a; END IF;
 a:=public.finalize_club_invite_send(op,gen,'sent',NULL); IF a->>'status'<>'sent' THEN RAISE EXCEPTION 'finish %',a; END IF;
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(recipient,'new-accept@example.test',clock_timestamp());
 INSERT INTO profiles(id,display_name,email) VALUES(recipient,'架空本人','new-accept@example.test');
 INSERT INTO player_profiles(id,linked_auth_user_id,display_name) VALUES(target,recipient,'本人プロフィール');
 PERFORM set_config('request.jwt.claim.sub',recipient::text,true);
 pv:=public.preview_my_club_invite(inv,gen); IF pv->>'status'<>'ok' THEN RAISE EXCEPTION 'preview %',pv; END IF;
 a:=public.accept_my_club_invite(inv,gen,acceptop,pv->>'review_token',pv->>'group_display_name_current',pv->>'group_visibility','招待表示名',true,true);
 IF a->>'status'<>'approved' THEN RAISE EXCEPTION 'accept failed: %',a; END IF;
 IF (SELECT player_profile_id FROM club_members WHERE id=m)<>target OR (SELECT player_profile_id FROM event_participants WHERE id='51000000-0000-4000-8000-000000000001')<>target OR (SELECT score_a FROM match_results WHERE id='54000000-0000-4000-8000-000000000001')<>6 THEN RAISE EXCEPTION 'history change'; END IF;
 IF NOT EXISTS(SELECT 1 FROM player_profile_merges WHERE target_auth_user_id=recipient AND restored_at IS NULL) THEN RAISE EXCEPTION 'audit missing'; END IF;
 IF (SELECT count(*) FROM notifications WHERE related_profile_link_request_id=(SELECT link_request_id FROM club_invite_private.invitations WHERE id=inv))=0 THEN RAISE EXCEPTION 'notification missing'; END IF;
 a:=public.accept_my_club_invite(inv,gen,acceptop,pv->>'review_token',pv->>'group_display_name_current',pv->>'group_visibility','招待表示名',true,true);IF a->>'status'<>'approved' THEN RAISE EXCEPTION 'idempotent replay %',a; END IF;
 RAISE NOTICE 'PASS new invitation accept / membership / scores / merge audit / notification / replay';
END $$;
