-- TASK-08 P0: STAGING ONLY, rollback-test removing target Auth UUID from the link request list.
-- Preserve source_player_profile_id: the current group member row uses it for pending state.
-- No app feature changes, no RLS/ACL/GRANT changes, no actual request persistence.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF current_user<>'postgres'
 OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.list_player_profile_link_requests(uuid)')
 AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
 AND md5(pg_get_functiondef(p.oid))='016e64a62761d14e32142048f41da7cc'
 AND has_function_privilege('authenticated',p.oid,'EXECUTE'))
 OR (SELECT count(*) FROM public.player_profile_link_requests)<>0
 OR (SELECT count(*) FROM public.clubs WHERE name IN('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>2
 THEN RAISE EXCEPTION 'TASK08 stage request list definition/fixture drift'; END IF;
END $preflight$;
DO $setup$
DECLARE c uuid;m uuid; uid_a uuid;uid_rec uuid;uid_out uuid;
BEGIN
 SELECT clubs.id,cm.id INTO STRICT c,m FROM public.clubs clubs
 JOIN public.club_members cm ON cm.club_id=clubs.id
 JOIN public.player_profiles p ON p.id=cm.player_profile_id
 WHERE clubs.name='TASK08-P0-20261119-A' AND p.display_name='TASK08-P0 provisional U';
 SELECT id INTO STRICT uid_a FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT uid_rec FROM auth.users WHERE lower(email)='recipient@example.com';
 SELECT id INTO STRICT uid_out FROM auth.users WHERE lower(email)='outsider@example.com';
 PERFORM set_config('task08.club',c::text,true);
 PERFORM set_config('task08.member',m::text,true);
 PERFORM set_config('task08.main',uid_a::text,true);
 PERFORM set_config('task08.rec',uid_rec::text,true);
 PERFORM set_config('task08.out',uid_out::text,true);
 PERFORM set_config('request.jwt.claim.sub',uid_a::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $setup$;
SET LOCAL ROLE authenticated;
DO $before$
DECLARE rid uuid; old_list jsonb;
BEGIN
 rid:=public.request_player_profile_link(current_setting('task08.club')::uuid,
   current_setting('task08.member')::uuid,current_setting('task08.rec')::uuid);
 PERFORM set_config('task08.rid',rid::text,true);
 old_list:=public.list_player_profile_link_requests(current_setting('task08.club')::uuid);
 IF jsonb_array_length(old_list)<>1 THEN RAISE EXCEPTION 'expected one own-club link request'; END IF;
 PERFORM set_config('task08.before_target_id',(old_list->0 ? 'target_auth_user_id')::text,true);
 PERFORM set_config('task08.before_source_id',(old_list->0 ? 'source_player_profile_id')::text,true);
END $before$;
RESET ROLE;
CREATE OR REPLACE FUNCTION public.list_player_profile_link_requests(p_club_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $link_list$
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC),'[]'::jsonb)
  FROM (
   SELECT lr.id,lr.club_id,lr.source_player_profile_id,lr.created_at,lr.expires_at,
     CASE WHEN lr.status='pending' AND lr.expires_at<=now() THEN 'expired' ELSE lr.status END AS status,
     c.name AS club_name,pp.display_name AS source_display_name
   FROM public.player_profile_link_requests lr
   JOIN public.clubs c ON c.id=lr.club_id
   JOIN public.player_profiles pp ON pp.id=lr.source_player_profile_id
   WHERE auth.uid() IS NOT NULL
    AND ((p_club_id IS NULL AND lr.target_auth_user_id=auth.uid())
     OR (p_club_id=lr.club_id AND public.can_manage_player_profile_club(lr.club_id)))
   ORDER BY lr.created_at DESC LIMIT 100
  ) r;
$link_list$;
SET LOCAL ROLE authenticated;
DO $after$
DECLARE mgr jsonb;rec jsonb;outsider jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.main'),true);
 mgr:=public.list_player_profile_link_requests(current_setting('task08.club')::uuid);
 PERFORM set_config('task08.manager_safe',(jsonb_array_length(mgr)=1
    AND NOT (mgr->0 ? 'target_auth_user_id')
    AND mgr->0 ? 'source_player_profile_id'
    AND mgr->0->>'source_display_name'='TASK08-P0 provisional U'
    AND mgr->0->>'id'=current_setting('task08.rid'))::text,true);
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.rec'),true);
 rec:=public.list_player_profile_link_requests(NULL);
 PERFORM set_config('task08.recipient_safe',(jsonb_array_length(rec)=1
    AND NOT (rec->0 ? 'target_auth_user_id')
    AND rec->0->>'id'=current_setting('task08.rid'))::text,true);
 PERFORM set_config('request.jwt.claim.sub',current_setting('task08.out'),true);
 outsider:=public.list_player_profile_link_requests(current_setting('task08.club')::uuid);
 PERFORM set_config('task08.outsider_no_rows',(jsonb_array_length(outsider)=0)::text,true);
END $after$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'baseline_target_auth_id_visible',current_setting('task08.before_target_id')::boolean,
 'baseline_source_player_id_visible',current_setting('task08.before_source_id')::boolean,
 'manager_no_target_auth_and_ui_source_preserved',current_setting('task08.manager_safe')::boolean,
 'recipient_no_target_auth_id',current_setting('task08.recipient_safe')::boolean,
 'outsider_no_rows',current_setting('task08.outsider_no_rows')::boolean,
 'pending_fixture_in_transaction',(SELECT count(*) FROM public.player_profile_link_requests WHERE id=current_setting('task08.rid')::uuid)
) AS report;
ROLLBACK;
