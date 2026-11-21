-- TASK-08 P0: STAGING ONLY remove unnecessary target Auth UUID from manager/recipient list.
-- Preserve source player ID used for in-club pending badges. No table RLS/ACL changes.
-- Tested using 20_link_list_target_id_rollback_probe.sql. DO NOT APPLY TO PRODUCTION.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF current_user<>'postgres'
 OR NOT EXISTS(SELECT 1 FROM public.clubs WHERE name='TASK08-P0-20261119-A')
 OR NOT EXISTS(SELECT 1 FROM pg_proc p
   WHERE p.oid=to_regprocedure('public.list_player_profile_link_requests(uuid)')
     AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
     AND md5(pg_get_functiondef(p.oid))='016e64a62761d14e32142048f41da7cc'
     AND has_function_privilege('authenticated',p.oid,'EXECUTE'))
 THEN RAISE EXCEPTION 'TASK08 staged list hash/owner/ACL drift'; END IF;
END $guard$;
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
COMMIT;
