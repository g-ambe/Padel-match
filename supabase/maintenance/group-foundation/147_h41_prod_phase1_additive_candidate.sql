-- TASK-08 / H41 production-compatible PHASE-1 additive SQL candidate.
-- NOT AUTHORIZED FOR PRODUCTION EXECUTION; NOT YET COMPILED ON PROD SCHEMA.
-- Generated from six source files pinned by GitHub object SHA below.
-- Phase1 leaves existing old application SELECT permissions unchanged.
-- One top-level transaction: if any SQL fails before COMMIT it all rolls back.
-- Phase2 is separately staged at 145_h40_prod_phase2_atomic_cutover_candidate.sql.
-- Never use uncontrolled 'supabase db push' or auto-register inconsistent history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';

-- H42 migration-history guard: refuse duplicate or out-of-order application.
DO $h42_phase1_history_gate$
BEGIN
 IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name IN ('task08_prod_phase1_additive','task08_prod_phase2_atomic'))
 OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE name ~ '^task08_(stage|staging)_005[4-9]' OR name ~ '^task08_(stage|staging)_006[0-5]')
 THEN RAISE EXCEPTION 'H42: Phase1 migration history indicates already applied or Stage baseline; abort';
 END IF;
END $h42_phase1_history_gate$;

DO $h41_preflight$
BEGIN
 IF current_user<>'postgres'
 OR to_regnamespace('security_private') IS NOT NULL
 OR to_regnamespace('group_read_private') IS NOT NULL
 OR to_regprocedure('public.get_shared_event(text,text)') IS NOT NULL
 OR to_regprocedure('public.record_event_video_click_by_token(uuid,text,text,text)') IS NOT NULL
 OR to_regprocedure('public.record_event_video_link_click_by_token(uuid,text,text,text)') IS NOT NULL
 OR to_regprocedure('public.record_official_video_click_by_token(uuid,text,text,text)') IS NOT NULL
 OR to_regprocedure('public.get_public_club_directory(uuid)') IS NOT NULL
 OR to_regprocedure('public.guard_group_last_main_admin()') IS NULL
 OR to_regprocedure('public.leave_my_club(uuid,uuid)') IS NOT NULL
 OR NOT has_any_column_privilege('anon','public.club_members','SELECT')
 OR to_regclass('public.event_fixed_pair_state') IS NULL
 OR to_regclass('public.profile_media_objects') IS NULL
 THEN RAISE EXCEPTION 'H41 Phase1: expected production baseline not present, abort'; END IF;
END $h41_preflight$;

-- [1/6] supabase/maintenance/group-foundation/54_h12_prod_compatible_rpc_candidate.sql SOURCE-SHA 5470ad36cac49247c87c06a51ccb36719470be52
-- TASK-08/H12: PRODUCTION-COMPATIBLE RPC PREPARATION CANDIDATE (NOT AUTHORIZED FOR PROD APPLY)
-- Source: verified stage 49 token DTO, compared to prod column metadata on 2026-11-19.
-- Prerequisite: 0044 / 0045 friendly team schema must exist; public shared pages are
-- NOT safe to deploy before get_shared_event is introduced and tested in prod.
-- This does not revoke old anon base table SELECT. That is a SEPARATE, later gated release step.

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
-- [1/6] END

-- [2/6] supabase/maintenance/group-foundation/133_h37_prod_video_click_additive_candidate.sql SOURCE-SHA 153be42193e8f3f489596d532fa6112994644a02
-- TASK-08 / H37: production-compatible ADDITIVE video click RPC candidate.
-- Stage H31/H33 source functions, without H33's Stage-specific no-events/no-fixed-pairs guard.
-- Not yet approved for Prod execution or migration-history registration.
-- Existing legacy RPCs/anonymous grants are NOT modified here; H35 is a later release step.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';

DO $preflight$
DECLARE name text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H37 privileged migration owner required'; END IF;
 FOREACH name IN ARRAY ARRAY[
  'public.record_event_video_click_by_token(uuid,text,text,text)',
  'public.record_event_video_link_click_by_token(uuid,text,text,text)',
  'public.record_official_video_click_by_token(uuid,text,text,text)'
 ] LOOP
   IF to_regprocedure(name) IS NOT NULL THEN
     RAISE EXCEPTION 'H37 token-bound RPC already present: % (no replacement)',name;
   END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY[
  'public.record_event_video_click(uuid,text,text)',
  'public.record_event_video_link_click(uuid,text,text)',
  'public.record_official_video_click(uuid,text,text)'
 ] LOOP
   IF to_regprocedure(name) IS NULL THEN RAISE EXCEPTION 'H37 missing legacy video RPC: %',name; END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY[
  'public.events','public.matches','public.event_video_clicks','public.event_video_links',
  'public.event_video_link_clicks','public.official_events','public.official_matches',
  'public.official_video_clicks'
 ] LOOP
   IF to_regclass(name) IS NULL THEN RAISE EXCEPTION 'H37 missing source table: %',name; END IF;
 END LOOP;
 IF EXISTS (
   SELECT 1 FROM pg_class
   WHERE oid IN ('public.event_video_clicks'::regclass,
    'public.event_video_link_clicks'::regclass,'public.official_video_clicks'::regclass)
   AND NOT relrowsecurity
 ) THEN RAISE EXCEPTION 'H37 click-table RLS disabled'; END IF;
END $preflight$;

CREATE FUNCTION public.record_event_video_click_by_token(
  p_match_id uuid, p_share_token text, p_user_agent text DEFAULT NULL,
  p_referrer text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r record;
BEGIN
  IF p_share_token IS NULL OR length(p_share_token)=0 OR length(p_share_token)>256 THEN RETURN; END IF;
  SELECT m.id AS match_id,m.event_id,m.round_id INTO r
    FROM public.matches m JOIN public.events e ON e.id=m.event_id
   WHERE m.id=p_match_id AND e.share_token=p_share_token AND e.share_token <> ''
     AND e.status='closed' AND e.share_enabled AND NOT coalesce(e.is_deleted,false)
     AND m.youtube_url IS NOT NULL AND btrim(m.youtube_url)<>''
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.event_video_clicks(event_id,round_id,match_id,source,user_agent,referrer)
    VALUES(r.event_id,r.round_id,r.match_id,'share',
      nullif(left(p_user_agent,500),''),NULL /* H33: never persist untrusted referrer URL */);
END $fn$;


CREATE FUNCTION public.record_event_video_link_click_by_token(
  p_video_link_id uuid, p_share_token text, p_user_agent text DEFAULT NULL,
  p_referrer text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r record;
BEGIN
  IF p_share_token IS NULL OR length(p_share_token)=0 OR length(p_share_token)>256 THEN RETURN; END IF;
  SELECT v.id AS link_id,v.event_id INTO r
    FROM public.event_video_links v JOIN public.events e ON e.id=v.event_id
   WHERE v.id=p_video_link_id AND e.share_token=p_share_token AND e.share_token <> ''
     AND e.status='closed' AND e.share_enabled AND NOT coalesce(e.is_deleted,false)
     AND v.video_url IS NOT NULL AND btrim(v.video_url)<>''
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.event_video_link_clicks(event_video_link_id,event_id,source,user_agent,referrer)
    VALUES(r.link_id,r.event_id,'share',
      nullif(left(p_user_agent,500),''),NULL /* H33: never persist untrusted referrer URL */);
END $fn$;


CREATE FUNCTION public.record_official_video_click_by_token(
  p_match_id uuid, p_share_token text, p_user_agent text DEFAULT NULL,
  p_referrer text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r record;
BEGIN
  IF p_share_token IS NULL OR length(p_share_token)=0 OR length(p_share_token)>256 THEN RETURN; END IF;
  SELECT m.id AS match_id,m.official_event_id,m.official_opponent_id INTO r
    FROM public.official_matches m JOIN public.official_events e ON e.id=m.official_event_id
   WHERE m.id=p_match_id AND e.share_token=p_share_token AND e.share_token <> ''
     AND e.status='closed' AND e.share_enabled AND NOT coalesce(e.is_deleted,false)
     AND m.youtube_url IS NOT NULL AND btrim(m.youtube_url)<>''
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.official_video_clicks(official_event_id,official_opponent_id,official_match_id,source,user_agent,referrer)
    VALUES(r.official_event_id,r.official_opponent_id,r.match_id,'share',
      nullif(left(p_user_agent,500),''),NULL /* H33: never persist untrusted referrer URL */);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.record_event_video_click_by_token(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.record_event_video_link_click_by_token(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.record_official_video_click_by_token(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_video_click_by_token(uuid,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_video_link_click_by_token(uuid,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_official_video_click_by_token(uuid,text,text,text) TO anon,authenticated;

DO $postflight$
DECLARE name text; f oid;
BEGIN
 FOREACH name IN ARRAY ARRAY[
  'public.record_event_video_click_by_token(uuid,text,text,text)',
  'public.record_event_video_link_click_by_token(uuid,text,text,text)',
  'public.record_official_video_click_by_token(uuid,text,text,text)'
 ] LOOP
  f:=to_regprocedure(name);
  IF f IS NULL
    OR NOT has_function_privilege('anon',f,'EXECUTE')
    OR NOT has_function_privilege('authenticated',f,'EXECUTE')
    OR (SELECT pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef
         OR NOT (proconfig @> ARRAY['search_path=""']::text[]) FROM pg_proc WHERE oid=f)
    OR position('NULL /* H33:' in (SELECT pg_get_functiondef(f)))=0
  THEN RAISE EXCEPTION 'H37 video click RPC verification failed: %',name; END IF;
 END LOOP;
END $postflight$;
-- [2/6] END

-- [3/6] supabase/migrations/0054_group_read_interfaces.sql SOURCE-SHA 9ae2c28e998ebfd4a8c289c2a02c5bd03f215511
-- Phase 1 only: additive read interfaces. No existing SELECT policy/GRANT is removed.
-- Do not apply to production before consumer migration and cutover negative tests.

DO $$ BEGIN IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Migration owner must be postgres'; END IF; END $$;
CREATE SCHEMA group_read_private;
REVOKE ALL ON SCHEMA group_read_private FROM PUBLIC,anon,authenticated;
-- No membership column/name is changed: existing consent snapshots stay identical.
-- Linked members without a group alias use a neutral public label until the name task.
CREATE TABLE group_read_private.directory_refs (
 member_id uuid PRIMARY KEY REFERENCES public.club_members(id) ON DELETE CASCADE,
 public_ref uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()
);
REVOKE ALL ON group_read_private.directory_refs FROM PUBLIC,anon,authenticated;
INSERT INTO group_read_private.directory_refs(member_id) SELECT id FROM public.club_members;
CREATE FUNCTION group_read_private.new_directory_ref() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO group_read_private.directory_refs(member_id) VALUES(NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER group_directory_reference AFTER INSERT ON public.club_members FOR EACH ROW EXECUTE FUNCTION group_read_private.new_directory_ref();
CREATE FUNCTION group_read_private.member(p_club uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.clubs c JOIN public.club_members cm ON cm.club_id=c.id LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE c.id=p_club AND c.is_active AND NOT coalesce(c.is_deleted,false) AND cm.is_active
 AND ((pp.is_active AND pp.linked_auth_user_id=auth.uid()) OR (cm.profile_id=auth.uid() AND (cm.player_profile_id IS NULL OR (pp.is_active AND pp.linked_auth_user_id=auth.uid())))))
$$;
CREATE FUNCTION group_read_private.require_member(p_club uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT group_read_private.member(p_club) AND NOT (auth.uid() IS NOT NULL AND public.is_super_user()) THEN
  RAISE EXCEPTION 'グループの閲覧権限がありません' USING ERRCODE='42501';
 END IF;
END $$;
CREATE FUNCTION public.get_public_club_directory(p_club_id uuid) RETURNS TABLE(reference uuid,display_name text,is_unlinked boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE id=p_club_id AND is_active AND NOT coalesce(is_deleted,false) AND visibility='public') THEN
  RAISE EXCEPTION '公開グループを確認できません' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT r.public_ref,CASE WHEN pp.linked_auth_user_id IS NULL THEN pp.display_name ELSE 'メンバー' END,pp.linked_auth_user_id IS NULL
 FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=cm.player_profile_id JOIN group_read_private.directory_refs r ON r.member_id=cm.id
 WHERE cm.club_id=p_club_id AND cm.is_active AND pp.is_active
 ORDER BY 2,1;
END $$;
CREATE FUNCTION public.get_club_roster(p_club_id uuid) RETURNS TABLE(id uuid,club_id uuid,profile_id uuid,player_profile_id uuid,role text,is_active boolean,status text,created_at timestamptz,player_profiles jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM group_read_private.require_member(p_club_id);
 RETURN QUERY SELECT cm.id,cm.club_id,cm.profile_id,cm.player_profile_id,cm.role,cm.is_active,cm.status,cm.created_at,
 jsonb_build_object('id',pp.id,'display_name',pp.display_name,'linked_auth_user_id',pp.linked_auth_user_id,'is_active',pp.is_active)
 FROM public.club_members cm LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=p_club_id AND ((cm.is_active) OR public.can_manage_player_profile_club(p_club_id))
 ORDER BY cm.created_at,cm.id;
END $$;
CREATE FUNCTION public.get_my_club_memberships() RETURNS TABLE(id uuid,club_id uuid,role text,is_active boolean,status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT cm.id,cm.club_id,cm.role,cm.is_active,cm.status FROM public.club_members cm
 LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE (pp.is_active AND pp.linked_auth_user_id=auth.uid()) OR (cm.profile_id=auth.uid() AND (cm.player_profile_id IS NULL OR (pp.is_active AND pp.linked_auth_user_id=auth.uid()))) ORDER BY cm.id;
END $$;
CREATE FUNCTION group_read_private.event_allowed(p_event uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=p_event AND NOT coalesce(e.is_deleted,false)
 AND (public.is_super_user() OR (e.club_id IS NULL AND e.created_by_auth_user_id=auth.uid()) OR group_read_private.member(e.club_id)
 OR (e.event_mode='team' AND public.can_view_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id))))
$$;
CREATE FUNCTION public.get_event_club_candidates(p_event_id uuid,p_club_id uuid) RETURNS TABLE(member_id uuid,player_profile_id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT group_read_private.event_allowed(p_event_id) OR NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=p_event_id AND (e.club_id=p_club_id OR EXISTS(SELECT 1 FROM public.event_team_sides s WHERE s.event_id=e.id AND s.club_id=p_club_id))) THEN
 RAISE EXCEPTION 'イベントの選手を取得する権限がありません' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT cm.id,pp.id,pp.display_name FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=coalesce(cm.player_profile_id,cm.profile_id)
 WHERE cm.club_id=p_club_id AND cm.is_active AND pp.is_active ORDER BY cm.id;
END $$;
CREATE FUNCTION group_read_private.event_names(p_event uuid) RETURNS TABLE(id uuid,display_name text,kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH wanted AS (
 SELECT ep.player_profile_id pid FROM public.event_participants ep WHERE ep.event_id=p_event
 UNION SELECT v.pid FROM public.event_team_matches m CROSS JOIN LATERAL (VALUES(m.team_a_player1_profile_id),(m.team_a_player2_profile_id),(m.team_b_player1_profile_id),(m.team_b_player2_profile_id)) v(pid) WHERE m.event_id=p_event)
 SELECT pp.id,pp.display_name,'player'::text FROM public.player_profiles pp JOIN wanted w ON w.pid=pp.id
 UNION ALL SELECT p.id,p.display_name,'account'::text FROM public.profiles p WHERE EXISTS(SELECT 1 FROM public.event_participants ep WHERE ep.event_id=p_event AND ep.profile_id=p.id) ORDER BY 3,1
$$;
CREATE FUNCTION public.get_event_player_names(p_event_id uuid) RETURNS TABLE(id uuid,display_name text,kind text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT group_read_private.event_allowed(p_event_id) THEN RAISE EXCEPTION 'イベントの閲覧権限がありません' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM group_read_private.event_names(p_event_id);
END $$;
CREATE FUNCTION public.get_shared_event_player_names(p_token text) RETURNS TABLE(id uuid,display_name text,kind text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE eid uuid;
BEGIN
 IF nullif(p_token,'') IS NULL THEN RAISE EXCEPTION '共有リンクは無効です' USING ERRCODE='42501'; END IF;
 SELECT e.id INTO eid FROM public.events e WHERE e.share_token=p_token AND e.share_enabled AND e.status='closed' AND NOT coalesce(e.is_deleted,false);
 IF eid IS NULL THEN RAISE EXCEPTION '共有リンクは無効です' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM group_read_private.event_names(eid);
END $$;
CREATE FUNCTION public.get_shared_official_player_names(p_token text) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE eid uuid;
BEGIN
 IF nullif(p_token,'') IS NULL THEN RAISE EXCEPTION '共有リンクは無効です' USING ERRCODE='42501'; END IF;
 SELECT e.id INTO eid FROM public.official_events e WHERE e.share_token=p_token AND e.share_enabled AND e.status='closed' AND NOT coalesce(e.is_deleted,false);
 IF eid IS NULL THEN RAISE EXCEPTION '共有リンクは無効です' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT pp.id,pp.display_name FROM public.player_profiles pp WHERE EXISTS(SELECT 1 FROM public.official_matches m WHERE m.official_event_id=eid AND pp.id IN(m.our_player1_profile_id,m.our_player2_profile_id)) ORDER BY pp.id;
END $$;
CREATE FUNCTION public.get_club_stats_player_names(p_club_id uuid) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM group_read_private.require_member(p_club_id);
 RETURN QUERY SELECT pp.id,pp.display_name FROM public.player_profiles pp WHERE EXISTS(SELECT 1 FROM public.club_members cm WHERE cm.club_id=p_club_id AND cm.player_profile_id=pp.id)
 OR EXISTS(SELECT 1 FROM public.event_participants ep JOIN public.events e ON e.id=ep.event_id WHERE e.club_id=p_club_id AND ep.player_profile_id=pp.id) ORDER BY pp.id;
END $$;
-- Internal helpers cannot be called through the public API. Explicit ACLs on every new function.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA group_read_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_public_club_directory(uuid),public.get_club_roster(uuid),public.get_my_club_memberships(),public.get_event_club_candidates(uuid,uuid),public.get_event_player_names(uuid),public.get_club_stats_player_names(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_directory(uuid),public.get_club_roster(uuid),public.get_my_club_memberships(),public.get_event_club_candidates(uuid,uuid),public.get_event_player_names(uuid),public.get_club_stats_player_names(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_shared_event_player_names(text),public.get_shared_official_player_names(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_event_player_names(text),public.get_shared_official_player_names(text) TO anon,authenticated;
-- [3/6] END

-- [4/6] supabase/migrations/0055_group_read_consumer_support.sql SOURCE-SHA 3219443b5d1b64def0fb1c59849fa3240b41d3df
-- Consumer support only; does not change old SELECT/UPDATE policies or grants.

DO $$ BEGIN IF current_user<>'postgres' THEN RAISE EXCEPTION 'Migration owner must be postgres'; END IF; END $$;
CREATE FUNCTION public.get_club_stats_members(p_club_id uuid) RETURNS TABLE(player_profile_id uuid,is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM group_read_private.require_member(p_club_id);
 RETURN QUERY SELECT cm.player_profile_id,cm.is_active FROM public.club_members cm WHERE cm.club_id=p_club_id ORDER BY cm.id;
END $$;
CREATE FUNCTION public.get_club_selection_candidates(p_club_id uuid) RETURNS TABLE(member_id uuid,player_profile_id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM group_read_private.require_member(p_club_id);
 RETURN QUERY SELECT cm.id,pp.id,pp.display_name FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=coalesce(cm.player_profile_id,cm.profile_id)
 WHERE cm.club_id=p_club_id AND cm.is_active AND pp.is_active ORDER BY cm.id;
END $$;
CREATE FUNCTION public.get_official_player_names(p_event_id uuid) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.official_events e WHERE e.id=p_event_id AND NOT coalesce(e.is_deleted,false)
 AND (public.is_super_user() OR group_read_private.member(e.club_id) OR (e.club_id IS NULL AND e.created_by_auth_user_id=auth.uid()))) THEN
 RAISE EXCEPTION 'イベントの閲覧権限がありません' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT pp.id,pp.display_name FROM public.player_profiles pp WHERE EXISTS(SELECT 1 FROM public.official_matches m WHERE m.official_event_id=p_event_id AND pp.id IN(m.our_player1_profile_id,m.our_player2_profile_id)) ORDER BY pp.id;
END $$;
REVOKE ALL ON FUNCTION public.get_club_stats_members(uuid),public.get_club_selection_candidates(uuid),public.get_official_player_names(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_stats_members(uuid),public.get_club_selection_candidates(uuid),public.get_official_player_names(uuid) TO authenticated;
CREATE FUNCTION group_read_private.claim_member(p_club uuid,p_reference uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE mid uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501'; END IF;
 SELECT cm.id INTO mid FROM group_read_private.directory_refs r JOIN public.club_members cm ON cm.id=r.member_id JOIN public.player_profiles pp ON pp.id=cm.player_profile_id JOIN public.clubs c ON c.id=cm.club_id
 WHERE r.public_ref=p_reference AND c.id=p_club AND c.visibility='public' AND c.is_active AND NOT coalesce(c.is_deleted,false) AND cm.is_active AND pp.is_active AND pp.linked_auth_user_id IS NULL;
 IF mid IS NULL THEN RAISE EXCEPTION '本人の仮登録選手を再確認してください' USING ERRCODE='42501'; END IF;
 RETURN mid;
END $$;
CREATE FUNCTION public.preview_public_club_claim(p_club_id uuid,p_reference uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb;mid uuid;
BEGIN
 mid:=group_read_private.claim_member(p_club_id,p_reference);
 v:=public.preview_profile_join(p_club_id,mid);
 RETURN jsonb_build_object('display_name',v->'source'->>'display_name','target_display_name',v->>'target_display_name','has_target',v->>'target_profile_id' IS NOT NULL,'review_token',v->>'review_token',
 'membership_count',jsonb_array_length(v->'memberships'),'participant_count',v->'participant_count','match_count',v->'match_count','result_count',v->'result_count','team_match_count',v->'team_match_count','official_match_count',v->'official_match_count');
END $$;
CREATE FUNCTION public.submit_public_club_claim(p_club_id uuid,p_reference uuid DEFAULT NULL,p_message text DEFAULT NULL,p_review_token text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM profile_link_private.serialize_operations();
 RETURN public.submit_profile_join_request(p_club_id,CASE WHEN p_reference IS NOT NULL THEN group_read_private.claim_member(p_club_id,p_reference) END,p_message,p_review_token);
END $$;
REVOKE ALL ON FUNCTION group_read_private.claim_member(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.preview_public_club_claim(uuid,uuid),public.submit_public_club_claim(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_public_club_claim(uuid,uuid),public.submit_public_club_claim(uuid,uuid,text,text) TO authenticated;
CREATE FUNCTION public.get_club_join_request_names(p_club_id uuid) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT p.id,p.display_name FROM public.profiles p WHERE EXISTS(SELECT 1 FROM public.join_requests r WHERE r.club_id=p_club_id AND r.requester_auth_user_id=p.id AND (r.requester_auth_user_id=auth.uid() OR public.can_manage_player_profile_club(p_club_id))) ORDER BY p.id;
END $$;
CREATE FUNCTION public.get_admin_group_member_counts() RETURNS TABLE(club_id uuid,member_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_user() THEN RAISE EXCEPTION '管理権限がありません' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT cm.club_id,count(*) FROM public.club_members cm WHERE cm.is_active GROUP BY cm.club_id ORDER BY cm.club_id;
END $$;
CREATE FUNCTION public.get_admin_account_names(p_ids uuid[]) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_user() THEN RAISE EXCEPTION '管理権限がありません' USING ERRCODE='42501'; END IF;
 IF coalesce(cardinality(p_ids),0)>100 THEN RAISE EXCEPTION '取得件数が多すぎます' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT p.id,p.display_name FROM public.profiles p WHERE p.id=ANY(p_ids) ORDER BY p.id;
END $$;
REVOKE ALL ON FUNCTION public.get_club_join_request_names(uuid),public.get_admin_group_member_counts(),public.get_admin_account_names(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_join_request_names(uuid),public.get_admin_group_member_counts(),public.get_admin_account_names(uuid[]) TO authenticated;
CREATE FUNCTION public.get_club_join_requests(p_club_id uuid) RETURNS TABLE(id uuid,club_id uuid,target_club_member_id uuid,requester_auth_user_id uuid,requester_player_profile_id uuid,message text,status text,created_at timestamptz,expires_at timestamptz,consent_at timestamptz,requester_display_name_snapshot text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT r.id,r.club_id,CASE WHEN public.can_manage_player_profile_club(p_club_id) THEN r.target_club_member_id ELSE d.public_ref END,r.requester_auth_user_id,
 CASE WHEN public.can_manage_player_profile_club(p_club_id) THEN r.requester_player_profile_id ELSE NULL::uuid END,r.message,r.status,r.created_at,r.expires_at,r.consent_at,r.requester_display_name_snapshot
 FROM public.join_requests r LEFT JOIN group_read_private.directory_refs d ON d.member_id=r.target_club_member_id
 WHERE r.club_id=p_club_id AND (r.requester_auth_user_id=auth.uid() OR public.can_manage_player_profile_club(p_club_id)) ORDER BY r.created_at DESC,r.id;
END $$;
REVOKE ALL ON FUNCTION public.get_club_join_requests(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_join_requests(uuid) TO authenticated;
-- [4/6] END

-- [5/6] supabase/maintenance/group-foundation/136_h38_prod_last_main_status_bridge_candidate.sql SOURCE-SHA f1ae3620176e62b6ba62f72161c5a095677c442b
-- TASK-08 / H38 - production COMPATIBILITY CANDIDATE, not approved for Prod apply.
-- Reuse Prod's existing last-main guard for DELETE/role/is_active/club_id.
-- Add Stage H09 equivalent only for the missing status column, to meet H15/H19 dependency.
-- Must be ordered after H12 creation of security_private schema.

SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='40s';
DO $h38_preflight$
DECLARE existing_fn text;
BEGIN
  IF current_user<>'postgres'
     OR to_regnamespace('security_private') IS NULL
     OR to_regprocedure('public.guard_group_last_main_admin()') IS NULL
     OR to_regprocedure('security_private.task08_guard_last_main_member()') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.club_members'::regclass
               AND tgname IN ('task08_block_last_main_departure','task08_block_last_main_status'))
  THEN RAISE EXCEPTION 'H38: baseline must be Prod legacy owner guard, not Stage'; END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.club_members'::regclass
              AND tgname='guard_group_last_main_admin' AND tgenabled IN ('O','A')
              AND (tgtype & 1)=1)<>1
  THEN RAISE EXCEPTION 'H38: legacy last-main trigger missing or disabled'; END IF;
  SELECT pg_get_functiondef('public.guard_group_last_main_admin()'::regprocedure) INTO existing_fn;
  IF position('old.is_active' IN existing_fn)=0
     OR position('old.role=' IN existing_fn)=0
     OR position('TG_OP=''DELETE''' IN existing_fn)=0
     OR position('for update' IN existing_fn)=0
  THEN RAISE EXCEPTION 'H38: legacy guard semantics drifted'; END IF;
END $h38_preflight$;

CREATE FUNCTION security_private.task08_guard_last_main_member()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $task08_guard$
DECLARE other_exists boolean;
BEGIN
 IF OLD.role IS DISTINCT FROM 'main_admin' OR OLD.is_active IS DISTINCT FROM true
 THEN RETURN NEW; END IF;
 IF NEW.role IS NOT DISTINCT FROM 'main_admin'
    AND NEW.is_active IS NOT DISTINCT FROM true
    AND NEW.status IS NOT DISTINCT FROM 'active'
    AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id
 THEN RETURN NEW; END IF;
 -- Serialize concurrent owner modifications at the club-row boundary.
 -- Run after acquiring the same club lock used for the initial owner insert.
 PERFORM 1 FROM public.clubs c WHERE c.id=OLD.club_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '所属グループを確認できません'
  USING ERRCODE='42501'; END IF;
 SELECT EXISTS(
   SELECT 1 FROM public.club_members cm
   WHERE cm.club_id=OLD.club_id AND cm.id<>OLD.id
     AND cm.role='main_admin' AND cm.is_active AND cm.status='active'
 ) INTO other_exists;
 IF NOT other_exists THEN
   RAISE EXCEPTION 'メイン管理者は最低1人必要です。管理権限を引き継いでから変更してください'
    USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $task08_guard$;
REVOKE ALL ON FUNCTION security_private.task08_guard_last_main_member() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER task08_block_last_main_status
 BEFORE UPDATE OF status ON public.club_members
 FOR EACH ROW EXECUTE FUNCTION security_private.task08_guard_last_main_member();
DO $h38_postflight$
BEGIN
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.club_members'::regclass
      AND tgname IN ('guard_group_last_main_admin','task08_block_last_main_status')
      AND tgenabled IN ('O','A'))<>2
    OR to_regprocedure('security_private.task08_guard_last_main_member()') IS NULL
    OR has_function_privilege('anon','security_private.task08_guard_last_main_member()','EXECUTE')
 THEN RAISE EXCEPTION 'H38: last-main guard compatibility did not install correctly'; END IF;
END $h38_postflight$;
-- [5/6] END

-- [6/6] supabase/maintenance/group-foundation/137_h38_prod_self_withdraw_candidate.sql SOURCE-SHA 702b29475ef0ca78f44bf7cd65bcc13c52b66a2c
-- TASK-08 / H38: Prod H15 self-withdrawal compatibility candidate; not authorized for Prod apply.
-- Never changes player profiles, auth users, other memberships or historical matches.
-- Owner handoff requires a separate, explicit-consent flow; owner exit fails closed.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Migration owner must be postgres'; END IF;
 IF to_regclass('public.clubs') IS NULL
 OR to_regclass('public.club_members') IS NULL
 OR to_regclass('public.player_profiles') IS NULL
 OR to_regprocedure('security_private.task08_guard_last_main_member()') IS NULL
 THEN RAISE EXCEPTION 'H15 prerequisites missing: do not bypass last-main guard'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid='public.club_members'::regclass
   AND tgname='guard_group_last_main_admin' AND tgenabled IN ('O','A')
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid='public.club_members'::regclass
   AND tgname='task08_block_last_main_status' AND tgenabled IN ('O','A')
 ) THEN RAISE EXCEPTION 'H38 last-main Prod guard/bridge not ready'; END IF;
 IF to_regprocedure('public.leave_my_club(uuid,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION 'H15 existing RPC must be reviewed before replacement'; END IF;
END $preflight$;

CREATE FUNCTION public.leave_my_club(p_club_id uuid,p_member_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $self_exit$
DECLARE v_auth uuid; v_owner uuid; v_target public.club_members%ROWTYPE; v_updated uuid;
BEGIN
 v_auth := auth.uid();
 IF v_auth IS NULL OR p_club_id IS NULL OR p_member_id IS NULL THEN
  RAISE EXCEPTION 'ログインと所属情報を確認してください' USING ERRCODE='42501';
 END IF;

 -- Serialize with promotion/demotion, owner transfer and competing exits.
 SELECT c.owner_id INTO v_owner FROM public.clubs c
 WHERE c.id=p_club_id AND c.is_active AND NOT coalesce(c.is_deleted,false)
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'グループの所属を確認できません' USING ERRCODE='42501'; END IF;

 SELECT cm.* INTO v_target FROM public.club_members cm
 LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=p_club_id AND cm.id=p_member_id
   AND cm.is_active AND cm.status='active'
   AND (
      (cm.player_profile_id IS NOT NULL AND pp.is_active AND pp.linked_auth_user_id=v_auth)
      OR (cm.player_profile_id IS NULL AND cm.profile_id=v_auth)
   )
 FOR UPDATE OF cm;
 IF NOT FOUND THEN
  RAISE EXCEPTION '本人の有効な所属を確認できません' USING ERRCODE='42501';
 END IF;

 -- Even if several main admins exist, the owner must hand over ownership
 -- with the recipient's consent before exiting. Never silently transfer.
 IF v_owner=v_auth THEN
  RAISE EXCEPTION 'オーナーを引き継いでから退会してください' USING ERRCODE='42501';
 END IF;
 IF v_target.role='main_admin' AND NOT EXISTS (
  SELECT 1 FROM public.club_members other
  WHERE other.club_id=p_club_id AND other.id<>v_target.id
    AND other.role='main_admin' AND other.is_active AND other.status='active'
 ) THEN
  RAISE EXCEPTION 'メイン管理者は最低1人必要です' USING ERRCODE='42501';
 END IF;

 UPDATE public.club_members SET is_active=false
 WHERE id=v_target.id AND club_id=p_club_id AND is_active
 RETURNING id INTO v_updated;
 IF v_updated IS DISTINCT FROM v_target.id THEN
  RAISE EXCEPTION '退会状態を保存できませんでした' USING ERRCODE='42501';
 END IF;
 RETURN v_updated;
END $self_exit$;
REVOKE ALL ON FUNCTION public.leave_my_club(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.leave_my_club(uuid,uuid) TO authenticated;

DO $verify$
BEGIN
 IF has_function_privilege('anon','public.leave_my_club(uuid,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.leave_my_club(uuid,uuid)','EXECUTE')
 OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.leave_my_club(uuid,uuid)'::regprocedure)
 THEN RAISE EXCEPTION 'H15 self-exit authorization boundary mismatch'; END IF;
END $verify$;
-- [6/6] END

DO $h41_verify$
BEGIN
 IF to_regprocedure('public.get_shared_event(text,text)') IS NULL
 OR to_regprocedure('public.record_event_video_click_by_token(uuid,text,text,text)') IS NULL
 OR to_regprocedure('public.record_event_video_link_click_by_token(uuid,text,text,text)') IS NULL
 OR to_regprocedure('public.record_official_video_click_by_token(uuid,text,text,text)') IS NULL
 OR to_regprocedure('public.get_public_club_directory(uuid)') IS NULL
 OR to_regprocedure('public.get_club_roster(uuid)') IS NULL
 OR to_regprocedure('public.get_club_join_requests(uuid)') IS NULL
 OR to_regprocedure('security_private.task08_guard_last_main_member()') IS NULL
 OR to_regprocedure('public.leave_my_club(uuid,uuid)') IS NULL
 OR NOT has_any_column_privilege('anon','public.club_members','SELECT')
 OR NOT has_function_privilege('anon','public.get_shared_event(text,text)','EXECUTE')
 OR NOT has_function_privilege('anon','public.record_event_video_click_by_token(uuid,text,text,text)','EXECUTE')
 OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.club_members'::regclass
    AND tgname IN ('guard_group_last_main_admin','task08_block_last_main_status') AND tgenabled IN ('O','A'))<>2
 OR to_regclass('public.event_fixed_pair_state') IS NULL
 OR to_regclass('public.profile_media_objects') IS NULL
 THEN RAISE EXCEPTION 'H41 Phase1: required RPC/ACL/integrity postflight failed'; END IF;
END $h41_verify$;

COMMIT;
