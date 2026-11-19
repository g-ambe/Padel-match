-- TASK-08/H12: PRODUCTION-COMPATIBLE RPC PREPARATION CANDIDATE (NOT AUTHORIZED FOR PROD APPLY)
-- Source: verified stage 49 token DTO, compared to prod column metadata on 2026-11-19.
-- Prerequisite: 0044 / 0045 friendly team schema must exist; public shared pages are
-- NOT safe to deploy before get_shared_event is introduced and tested in prod.
-- This does not revoke old anon base table SELECT. That is a SEPARATE, later gated release step.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $h12_preflight$
DECLARE t text; c text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H12 migration owner must be postgres'; END IF;
 FOREACH t IN ARRAY ARRAY['events','event_participants','matches','match_players','match_results','rounds','event_team_sides','event_team_matches','event_team_guests','event_video_links','official_events','official_opponents','official_matches','clubs','player_profiles','profiles'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'H12 missing required relation: %',t; END IF;
 END LOOP;
 FOREACH c IN ARRAY ARRAY['round_id','round_number','court_number','generation_mode','pair_1_score','pair_2_score','pair_result',
    'team_a_player1_guest_id','team_a_player2_guest_id','team_b_player1_guest_id','team_b_player2_guest_id',
    'team_a_player1_source_side','team_a_player2_source_side','team_b_player1_source_side','team_b_player2_source_side'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.event_team_matches'::regclass AND attname=c AND attnum>0 AND NOT attisdropped)
  THEN RAISE EXCEPTION 'H12 0045 prerequisite column missing: %',c; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.get_shared_event(text,text)')
    AND pg_get_userbyid(proowner)<>'postgres')
 THEN RAISE EXCEPTION 'H12 existing RPC owner drift'; END IF;
END $h12_preflight$;
CREATE SCHEMA IF NOT EXISTS security_private;
-- Intentionally do not revoke USAGE of the EXISTING security_private schema:
-- unrelated existing RLS helpers can depend on it. Restrict this helper itself.
CREATE OR REPLACE FUNCTION security_private.shared_event(p_token text, p_kind text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE STRICT SECURITY DEFINER
 SET search_path TO ''
AS $function$
select case when p_kind='event' then (
select pg_catalog.jsonb_build_object(
    'event', pg_catalog.jsonb_build_object('name', e.name, 'created_at', e.created_at, 'event_mode', e.event_mode),
    'participants', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', ep.id,
        'participant_type', ep.participant_type,
        'display_name', coalesce(pp.display_name, p.display_name, ep.guest_name, 'ゲスト')
      ) order by ep.created_at, ep.id)
      from public.event_participants ep
      left join public.player_profiles pp on pp.id = ep.player_profile_id
      left join public.profiles p on p.id = ep.profile_id
      where ep.event_id = e.id
    ), '[]'::jsonb),
    'matches', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', m.id, 'court_number', m.court_number, 'completed', m.completed,
        'youtube_url', m.youtube_url, 'round_number', coalesce(r.round_number, 0),
        'match_players', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('participant_id', mp.participant_id, 'team', mp.team) order by mp.id)
          from public.match_players mp
          join public.event_participants ep on ep.id = mp.participant_id and ep.event_id = e.id
          where mp.match_id = m.id
        ), '[]'::jsonb),
        'result', (
          select pg_catalog.jsonb_build_object('score_a', mr.score_a, 'score_b', mr.score_b, 'winner_team', mr.winner_team)
          from public.match_results mr where mr.match_id = m.id order by mr.created_at, mr.id limit 1
        )
      ) order by m.created_at desc, m.id)
      from public.matches m
      left join public.rounds r on r.id = m.round_id and r.event_id = e.id
      where m.event_id = e.id
        and (m.round_id is null or r.id is not null)
    ), '[]'::jsonb),
    'team_sides', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('side', ets.side, 'team_name', ets.team_name) order by ets.side)
      from public.event_team_sides ets where ets.event_id = e.id and e.event_mode = 'team'
    ), '[]'::jsonb),
    'team_matches', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', etm.id,
        'match_order', etm.match_order,
        'round_id', etm.round_id,
        'round_number', etm.round_number,
        'court_number', etm.court_number,
        'generation_mode', coalesce(etm.generation_mode,'confrontation'),
        'pair_1_score', etm.pair_1_score,
        'pair_2_score', etm.pair_2_score,
        'pair_result', etm.pair_result,
        'team_a_player1_profile_id',case when pa1.id is not null then md5(e.id::text||pa1.id::text) end,
        'team_a_player1_guest_name', coalesce(pa1.display_name, etm.team_a_player1_guest_name, '選手'),
        'team_a_player1_guest_id', case when etm.team_a_player1_guest_id is not null then md5(e.id::text||etm.team_a_player1_guest_id::text) end,
        'team_a_player1_source_side', coalesce(etm.team_a_player1_source_side,'team_a'),
        'team_a_player2_profile_id',case when pa2.id is not null then md5(e.id::text||pa2.id::text) end,
        'team_a_player2_guest_name', coalesce(pa2.display_name, etm.team_a_player2_guest_name, '選手'),
        'team_a_player2_guest_id', case when etm.team_a_player2_guest_id is not null then md5(e.id::text||etm.team_a_player2_guest_id::text) end,
        'team_a_player2_source_side', coalesce(etm.team_a_player2_source_side,'team_a'),
        'team_b_player1_profile_id',case when pb1.id is not null then md5(e.id::text||pb1.id::text) end,
        'team_b_player1_guest_name', coalesce(pb1.display_name, etm.team_b_player1_guest_name, '選手'),
        'team_b_player1_guest_id', case when etm.team_b_player1_guest_id is not null then md5(e.id::text||etm.team_b_player1_guest_id::text) end,
        'team_b_player1_source_side', coalesce(etm.team_b_player1_source_side,'team_b'),
        'team_b_player2_profile_id',case when pb2.id is not null then md5(e.id::text||pb2.id::text) end,
        'team_b_player2_guest_name', coalesce(pb2.display_name, etm.team_b_player2_guest_name, '選手'),
        'team_b_player2_guest_id', case when etm.team_b_player2_guest_id is not null then md5(e.id::text||etm.team_b_player2_guest_id::text) end,
        'team_b_player2_source_side', coalesce(etm.team_b_player2_source_side,'team_b'),
        'team_a_score', etm.team_a_score, 'team_b_score', etm.team_b_score,
        'result', etm.result, 'score_detail', etm.score_detail, 'youtube_url', etm.youtube_url
      ) order by etm.match_order, etm.created_at, etm.id)
      from public.event_team_matches etm
      left join public.player_profiles pa1 on pa1.id = etm.team_a_player1_profile_id
      left join public.player_profiles pa2 on pa2.id = etm.team_a_player2_profile_id
      left join public.player_profiles pb1 on pb1.id = etm.team_b_player1_profile_id
      left join public.player_profiles pb2 on pb2.id = etm.team_b_player2_profile_id
      where etm.event_id = e.id and e.event_mode = 'team'
    ), '[]'::jsonb),
    'team_guests', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', md5(e.id::text||g.id::text), 'side', g.side, 'guest_name', g.guest_name
      ) order by g.created_at,g.id)
      from public.event_team_guests g where g.event_id=e.id and e.event_mode='team'
    ), '[]'::jsonb),
    'videos', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', evl.id, 'title', evl.title, 'video_url', pg_catalog.btrim(evl.video_url),
        'memo', evl.memo, 'display_order', evl.display_order
      ) order by evl.display_order, evl.created_at, evl.id)
      from public.event_video_links evl
      where evl.event_id = e.id and evl.video_url is not null and pg_catalog.btrim(evl.video_url) <> ''
    ), '[]'::jsonb)
  )
  from public.events e
  where pg_catalog.length(p_token) between 1 and 512
    and e.share_token = p_token
    and e.share_enabled = true
    and e.status = 'closed'
    and coalesce(e.is_deleted, false) = false
    and (e.club_id is null or exists (
      select 1 from public.clubs c
      where c.id = e.club_id and c.is_active = true and coalesce(c.is_deleted, false) = false
    ))
) when p_kind='official' then (
select jsonb_build_object(
  'event',jsonb_build_object('title',e.title,'event_date',e.event_date,'description',e.description,'memo',e.memo,'status',e.status,'clubs',jsonb_build_object('name',coalesce(c.name,'グループなし'))),
  'opponents',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'opponent_team_name',o.opponent_team_name,'memo',o.memo) order by o.created_at,o.id) from public.official_opponents o where o.official_event_id=e.id),'[]'::jsonb),
  'matches',coalesce((select jsonb_agg(jsonb_build_object(
    'id',m.id,'official_opponent_id',m.official_opponent_id,'match_order',m.match_order,'created_at',m.created_at,
    'our_player1_profile_id',case when p1.id is not null then md5(e.id::text||p1.id::text) end,
    'our_player2_profile_id',case when p2.id is not null then md5(e.id::text||p2.id::text) end,
    'our_player1_guest_name',coalesce(p1.display_name,m.our_player1_guest_name),
    'our_player2_guest_name',coalesce(p2.display_name,m.our_player2_guest_name),
    'opponent_player1_name',m.opponent_player1_name,'opponent_player2_name',m.opponent_player2_name,
    'our_score',m.our_score,'opponent_score',m.opponent_score,'result',m.result,'score_detail',m.score_detail,'memo',m.memo,'youtube_url',m.youtube_url
  ) order by m.match_order,m.created_at,m.id) from public.official_matches m
    left join public.player_profiles p1 on p1.id=m.our_player1_profile_id left join public.player_profiles p2 on p2.id=m.our_player2_profile_id
    where m.official_event_id=e.id),'[]'::jsonb)
) from public.official_events e left join public.clubs c on c.id=e.club_id
where length(p_token) between 1 and 512 and e.share_token=p_token and e.share_enabled and e.status='closed' and not coalesce(e.is_deleted,false) and (e.club_id is null or (c.is_active and not coalesce(c.is_deleted,false)))

) end;
$function$
;
REVOKE ALL ON FUNCTION security_private.shared_event(text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_shared_event(p_token text,p_kind text DEFAULT 'event')
RETURNS jsonb LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path=''
AS $h12_wrapper$
 SELECT security_private.shared_event(p_token,p_kind)
$h12_wrapper$;
REVOKE ALL ON FUNCTION public.get_shared_event(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_event(text,text) TO anon,authenticated;
DO $h12_postflight$
BEGIN
 IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.get_shared_event(text,text)'::regprocedure)
 OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.get_shared_event(text,text)'::regprocedure)<>'postgres'
 OR has_function_privilege('anon','security_private.shared_event(text,text)','EXECUTE')
 OR has_function_privilege('authenticated','security_private.shared_event(text,text)','EXECUTE')
 OR NOT has_function_privilege('anon','public.get_shared_event(text,text)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.get_shared_event(text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'H12 RPC privilege boundary invalid'; END IF;
END $h12_postflight$;
COMMIT;
