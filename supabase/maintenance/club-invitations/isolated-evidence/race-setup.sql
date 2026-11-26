\set ON_ERROR_STOP on
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
SELECT public.check_club_invite_account('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','race-cancel@example.test')->>'ticket' AS t \gset
SELECT public.reserve_club_invite_send('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000088',:'t','race-cancel@example.test')->>'invite_id' AS inv \gset
SELECT public.claim_club_invite_send('60000000-0000-4000-8000-000000000088')->>'status';
SELECT public.finalize_club_invite_send('60000000-0000-4000-8000-000000000088',1,'sent',NULL)->>'status';
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('10000000-0000-4000-8000-000000000088','race-cancel@example.test',now());
INSERT INTO profiles(id,display_name,email) VALUES('10000000-0000-4000-8000-000000000088','同時本人','race-cancel@example.test');
INSERT INTO player_profiles(id,linked_auth_user_id,display_name) VALUES('20000000-0000-4000-8000-000000000088','10000000-0000-4000-8000-000000000088','同時本人');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000088',false);
SELECT :'inv' || '|' || (public.preview_my_club_invite(:'inv'::uuid,1)->>'review_token');
