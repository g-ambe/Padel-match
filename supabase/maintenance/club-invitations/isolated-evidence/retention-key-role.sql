\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();d bytea:=decode(repeat('aa',32),'hex'); c uuid:='30000000-0000-4000-8000-000000000001';m uuid:='40000000-0000-4000-8000-000000000002';u uuid:='10000000-0000-4000-8000-000000000001'; BEGIN
 INSERT INTO club_invite_private.invitations(id,club_id,member_id,source_profile_id,inviter_auth_id,email_digest,status,created_at,expires_at,decided_at) VALUES (a,c,m,gen_random_uuid(),u,d,'cancelled',clock_timestamp()-interval '38 days',clock_timestamp()-interval '32 days',clock_timestamp()-interval '31 days'),(b,c,m,gen_random_uuid(),u,d,'cancelled',clock_timestamp()-interval '36 days',clock_timestamp()-interval '30 days',clock_timestamp()-interval '29 days');
 PERFORM club_invite_private.cleanup_retention();
 IF EXISTS(SELECT 1 FROM club_invite_private.invitations WHERE id=a) OR NOT EXISTS(SELECT 1 FROM club_invite_private.invitations WHERE id=b) THEN RAISE EXCEPTION 'retention boundary'; END IF;
 UPDATE vault.decrypted_secrets SET decrypted_secret='invalid' WHERE name='padel_club_invite_hmac_v1';
 BEGIN PERFORM club_invite_private.key_bytes('hmac');RAISE EXCEPTION 'bad key accepted';EXCEPTION WHEN SQLSTATE 'PT503' THEN NULL;END;
 RAISE NOTICE 'PASS cleanup 31d deleted 29d retained; bad key fail-closed';
END $$;
ROLLBACK;
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.list_my_club_invites();RAISE EXCEPTION 'anon allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM count(*) FROM club_invite_private.invitations;RAISE EXCEPTION 'anon read';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE 'PASS anon denied RPC and private data';
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.claim_club_invite_send(gen_random_uuid());RAISE EXCEPTION 'auth claim allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM count(*) FROM club_invite_private.invitations;RAISE EXCEPTION 'auth private read';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE 'PASS authenticated service-only and private access denied';
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM count(*) FROM club_invite_private.invitations;RAISE EXCEPTION 'service table read';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF public.claim_club_invite_send(gen_random_uuid())->>'status'<>'not_claimable' THEN RAISE EXCEPTION 'service claim';END IF;
 RAISE NOTICE 'PASS service RPC callable and private table denied';
END $$;
RESET ROLE;
