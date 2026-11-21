-- TASK-08 / H38 Prod compatibility candidate for scoped profile-link detail.
-- Add only the private scoped_preview helper and narrowly replace the existing link-detail RPC.
-- Source helper: Stage definition; source public function: original 16_link_detail_staging_apply.sql.
-- This changes public RPC DTO; coordinate with app cutover and the later 0061 migration.
-- NOT authorized for production apply or automatic migrations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $h38_preflight$
DECLARE current_body text;
BEGIN
  IF current_user<>'postgres'
    OR to_regprocedure('profile_link_private.preview(uuid,uuid)') IS NULL
    OR to_regprocedure('profile_link_private.scoped_preview(uuid,uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.get_player_profile_link_request(uuid)') IS NULL
    OR (SELECT pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef
       FROM pg_proc WHERE oid=to_regprocedure('public.get_player_profile_link_request(uuid)'))
    OR has_function_privilege('anon','public.get_player_profile_link_request(uuid)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.get_player_profile_link_request(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'H38: profile link baseline has drifted'; END IF;
  current_body:=pg_get_functiondef('public.get_player_profile_link_request(uuid)'::regprocedure);
  IF position('to_jsonb(request)' IN current_body)=0
    OR position('profile_link_private.preview(' IN current_body)=0
  THEN RAISE EXCEPTION 'H38: legacy detail RPC unexpectedly changed'; END IF;
END $h38_preflight$;

CREATE FUNCTION profile_link_private.scoped_preview(p_source uuid, p_user uuid, p_club uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select profile_link_private.preview(p_source,p_user) || jsonb_build_object(
    'source',jsonb_build_object('id',p_source,'display_name',(select display_name from public.player_profiles where id=p_source)),
    'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',cm.id,'club_name',c.name,'role',cm.role,'status',case when cm.is_active then 'active' else 'inactive' end,'is_active',cm.is_active,'created_at',cm.created_at))
      from public.club_members cm join public.clubs c on c.id=cm.club_id where cm.player_profile_id=p_source and cm.club_id=p_club),'[]'::jsonb),
    'participant_count',(select count(*) from public.event_participants ep join public.events e on e.id=ep.event_id where ep.player_profile_id=p_source and e.club_id=p_club),
    'match_count',(select count(distinct m.id) from public.match_players mp join public.matches m on m.id=mp.match_id join public.event_participants ep on ep.id=mp.participant_id join public.events e on e.id=m.event_id where ep.player_profile_id=p_source and e.club_id=p_club),
    'result_count',(select count(distinct r.id) from public.match_results r join public.match_players mp on mp.match_id=r.match_id join public.event_participants ep on ep.id=mp.participant_id join public.events e on e.id=ep.event_id where ep.player_profile_id=p_source and e.club_id=p_club),
    'team_match_count',(select count(*) from public.event_team_matches m where p_source in(m.team_a_player1_profile_id,m.team_a_player2_profile_id,m.team_b_player1_profile_id,m.team_b_player2_profile_id) and exists(select 1 from public.event_team_sides s where s.event_id=m.event_id and s.club_id=p_club)),
    'official_match_count',(select count(*) from public.official_matches m join public.official_events e on e.id=m.official_event_id where p_source in(m.our_player1_profile_id,m.our_player2_profile_id) and e.club_id=p_club));
$function$


REVOKE ALL ON FUNCTION profile_link_private.scoped_preview(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated;

create or replace function public.get_player_profile_link_request(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare request public.player_profile_link_requests; result jsonb; recipient boolean;
begin
  select * into request from public.player_profile_link_requests where id = p_request_id;
  if not found or auth.uid() is null then
    raise exception 'この連携申請を確認する権限がありません';
  end if;
  recipient := request.target_auth_user_id = auth.uid();
  if not recipient and not public.can_manage_player_profile_club(request.club_id) then
    raise exception 'この連携申請を確認する権限がありません';
  end if;
  -- 全申請行をJSON化せず、画面で必要な共通列を列挙する。
  result := jsonb_build_object(
    'id', request.id, 'club_id', request.club_id,
    'club_name', (select name from public.clubs where id = request.club_id),
    'status', case when request.status = 'pending' and request.expires_at <= now() then 'expired' else request.status end,
    'created_at', request.created_at, 'expires_at', request.expires_at,
    'is_recipient', recipient, 'detail_scope', case when recipient then 'recipient' else 'manager' end
  );
  if recipient then
    -- ステージング固有のscoped_previewを維持し、元の同意preview/tokenの契約を変えない。
    -- 管理者を兼ねる場合も本人同意の枝を優先する。
    if request.status = 'pending' and request.expires_at > now() then
      result := result || profile_link_private.scoped_preview(request.source_player_profile_id, request.target_auth_user_id, request.club_id);
    end if;
  else
    -- 他グループを含むpreview/canonical/source_snapshotを管理者のために実行しない。
    result := result || jsonb_build_object(
      'source_display_name', (select pp.display_name from public.player_profiles pp
        join public.club_members cm on cm.id = request.source_club_member_id and cm.club_id = request.club_id
          and cm.player_profile_id = pp.id),
      'group_membership', (select jsonb_build_object(
        'role', cm.role, 'is_active', cm.is_active, 'created_at', cm.created_at
      ) from public.club_members cm
        where cm.id = request.source_club_member_id and cm.club_id = request.club_id)
    );
  end if;
  return result;
end $$;

DO $h38_postflight$
BEGIN
 IF to_regprocedure('profile_link_private.scoped_preview(uuid,uuid,uuid)') IS NULL
   OR has_function_privilege('anon','profile_link_private.scoped_preview(uuid,uuid,uuid)','EXECUTE')
   OR has_function_privilege('authenticated','profile_link_private.scoped_preview(uuid,uuid,uuid)','EXECUTE')
   OR has_function_privilege('anon','public.get_player_profile_link_request(uuid)','EXECUTE')
   OR NOT has_function_privilege('authenticated','public.get_player_profile_link_request(uuid)','EXECUTE')
   OR (SELECT pg_get_userbyid(proowner)<>'postgres' OR NOT prosecdef
       FROM pg_proc WHERE oid=to_regprocedure('public.get_player_profile_link_request(uuid)'))
   OR position('profile_link_private.scoped_preview(' IN
       pg_get_functiondef('public.get_player_profile_link_request(uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'H38: scoped link detail cutover did not retain privileges or DTO'; END IF;
END $h38_postflight$;
COMMIT;
