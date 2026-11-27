SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
SELECT public.check_club_invite_account('30000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004','newrecipient@example.test')->>'ticket' AS t \gset
SELECT (public.consume_club_invite_lookup('30000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000004','newrecipient@example.test',:'t','60000000-0000-4000-8000-000000000001',true)->>'link_id') AS link \gset
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
SELECT :'link' || '|' || (public.get_player_profile_link_request(:'link'::uuid)->>'review_token');
