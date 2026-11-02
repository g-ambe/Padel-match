BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.events IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
 IF replace(pg_get_functiondef('events_operation_private.guard_member_fields()'::regprocedure),chr(13),'') IS DISTINCT FROM $expected$CREATE OR REPLACE FUNCTION events_operation_private.guard_member_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF current_user NOT IN ('anon','authenticated') THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','closed_at','stats_mode','court_count','updated_at'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','closed_at','stats_mode','court_count','updated_at'])
 AND NOT coalesce((auth.uid() IS NOT NULL AND (public.is_super_user()
 OR (OLD.club_id IS NULL AND OLD.created_by_auth_user_id=auth.uid())
 OR EXISTS(SELECT 1 FROM public.club_members cm LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=OLD.club_id AND cm.is_active AND cm.role IN ('main_admin','sub_admin')
 AND (cm.profile_id=auth.uid() OR pp.linked_auth_user_id=auth.uid()))
 OR (OLD.event_mode='team' AND public.can_manage_friendly_team_event_by_sides(OLD.id,OLD.created_by_auth_user_id)))),false)
 THEN RAISE EXCEPTION '開催の管理項目を変更する権限がありません' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $function$
$expected$
 THEN RAISE EXCEPTION 'Event member-field guard changed; stop'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.events'::regclass AND tgname='guard_event_member_fields' AND tgenabled='O' AND tgfoid='events_operation_private.guard_member_fields()'::regprocedure)
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.events'::regclass)
 THEN RAISE EXCEPTION 'Event trigger/RLS preconditions changed; stop'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION events_operation_private.guard_member_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF current_user NOT IN ('anon','authenticated') THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['name','status','closed_at','stats_mode','court_count','updated_at'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','status','closed_at','stats_mode','court_count','updated_at'])
 AND NOT coalesce((auth.uid() IS NOT NULL AND (public.is_super_user()
 OR (OLD.club_id IS NULL AND OLD.created_by_auth_user_id=auth.uid())
 OR EXISTS(SELECT 1 FROM public.club_members cm LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=OLD.club_id AND cm.is_active AND cm.role IN ('main_admin','sub_admin')
 AND (cm.profile_id=auth.uid() OR pp.linked_auth_user_id=auth.uid()))
 OR (OLD.event_mode='team' AND public.can_manage_friendly_team_event_by_sides(OLD.id,OLD.created_by_auth_user_id)))),false)
 THEN RAISE EXCEPTION '開催の管理項目を変更する権限がありません' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $function$
;
COMMIT;
