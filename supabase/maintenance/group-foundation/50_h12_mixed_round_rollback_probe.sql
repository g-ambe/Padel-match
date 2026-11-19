-- H12 mixed team round positive probe; Stage only. Atomic ROLLBACK; no fixtures persist.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='55s';
DO $stage_setup$
DECLARE c1 uuid; c2 uuid; actor uuid; e uuid; r uuid; a1 uuid; a2 uuid; b1 uuid; b2 uuid;
BEGIN
 IF current_user <> 'postgres'
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.event_team_rounds)<>0
 OR (SELECT count(*) FROM public.event_team_matches)<>0
 OR (SELECT count(*) FROM public.event_team_guests)<>0
 OR (SELECT count(*) FROM public.event_team_sides)<>0
 THEN RAISE EXCEPTION 'H12 mixed isolation no longer holds'; END IF;
 SELECT id INTO STRICT c1 FROM public.clubs WHERE name='TASK08-P0-20261119-A' AND is_active AND NOT coalesce(is_deleted,false);
 SELECT id INTO STRICT c2 FROM public.clubs WHERE name='TASK08-P0-20261119-B' AND is_active AND NOT coalesce(is_deleted,false);
 SELECT id INTO STRICT actor FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 INSERT INTO public.events(club_id,name,category,court_count,status,closed_at,share_enabled,share_token,event_mode,created_by_auth_user_id)
 VALUES(c1,'TASK08-H12-MIXED-ROLLBACK','club',1,'closed',now(),true,'TASK08-H12-MIXED-ROLLBACK-TOKEN','team',actor) RETURNING id INTO e;
 INSERT INTO public.event_team_sides(event_id,side,team_name,club_id)
 VALUES(e,'team_a','緑チーム',c1),(e,'team_b','青チーム',c2);
 INSERT INTO public.event_team_guests(event_id,side,guest_name)
 VALUES(e,'team_a','A1') RETURNING id INTO a1;
 INSERT INTO public.event_team_guests(event_id,side,guest_name)
 VALUES(e,'team_a','A2') RETURNING id INTO a2;
 INSERT INTO public.event_team_guests(event_id,side,guest_name)
 VALUES(e,'team_b','B1') RETURNING id INTO b1;
 INSERT INTO public.event_team_guests(event_id,side,guest_name)
 VALUES(e,'team_b','B2') RETURNING id INTO b2;
 INSERT INTO public.event_team_rounds(event_id,round_number,mode,court_count,eligible,request_id,request_fingerprint,created_by)
 VALUES(e,1,'mixed',1,'[]'::jsonb,gen_random_uuid(),'TASK08-H12-MIXED-ROLLBACK',actor) RETURNING id INTO r;
 INSERT INTO public.event_team_matches(
 event_id,match_order,round_id,round_number,court_number,generation_mode,
 team_a_player1_guest_id,team_a_player1_guest_name,team_a_player1_source_side,
 team_a_player2_guest_id,team_a_player2_guest_name,team_a_player2_source_side,
 team_b_player1_guest_id,team_b_player1_guest_name,team_b_player1_source_side,
 team_b_player2_guest_id,team_b_player2_guest_name,team_b_player2_source_side,
 team_a_score,team_b_score,result,pair_1_score,pair_2_score,pair_result
 ) VALUES (
 e,1,r,1,1,'mixed',
 a1,'A1','team_a',b1,'B1','team_b',
 a2,'A2','team_a',b2,'B2','team_b',
 NULL,NULL,'undecided',4,2,'win'
 );
 PERFORM team_rounds_private.check_round(r);
END $stage_setup$;
SET LOCAL ROLE anon;
WITH response AS (
 SELECT public.get_shared_event('TASK08-H12-MIXED-ROLLBACK-TOKEN','event') AS d
), item AS (
 SELECT d,d->'team_matches'->0 AS m FROM response
)
SELECT jsonb_build_object(
 'rollback_only',true,
 'team_mode',d->'event'->>'event_mode'='team',
 'teams',jsonb_array_length(d->'team_sides')=2,
 'guests',jsonb_array_length(d->'team_guests')=4,
 'match',jsonb_array_length(d->'team_matches')=1,
 'round',(m->>'round_number')::int=1,
 'court',(m->>'court_number')::int=1,
 'generation_mode',m->>'generation_mode'='mixed',
 'mixed_pair_scores',(m->>'pair_1_score')::int=4 AND (m->>'pair_2_score')::int=2,
 'mixed_result',m->>'pair_result'='win' AND m->>'result'='undecided',
 'source_labels',m->>'team_a_player1_source_side'='team_a' AND m->>'team_a_player2_source_side'='team_b' AND m->>'team_b_player1_source_side'='team_a' AND m->>'team_b_player2_source_side'='team_b',
 'anon_guest_ids_masked',length(m->>'team_a_player1_guest_id')=32 AND length(d->'team_guests'->0->>'id')=32,
 'invalid_token_null',public.get_shared_event('TASK08-H12-NOT-VALID','event') IS NULL
) AS report FROM item;
RESET ROLE;
ROLLBACK;