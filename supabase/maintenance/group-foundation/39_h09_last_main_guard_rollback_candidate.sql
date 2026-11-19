-- TASK-08 H09: STAGING ONLY, ROLLBACK-only last-main DB safety trigger.
-- CURRENT vulnerability: the sole active main can set own is_active=false
-- via Data API, bypassing the UI. Also prevent last-main role/status/club changes.
-- This guard never adds SELECT/UPDATE grants or alters other RLS policies.
-- The parent-club row lock serializes different main members leaving concurrently.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $preflight$
BEGIN
 IF current_user <> 'postgres'
 OR (SELECT count(*) FROM public.clubs WHERE name IN ('TASK08-P0-20261119-A','TASK08-P0-20261119-B'))<>2
 OR to_regprocedure('security_private.task08_guard_last_main_member()') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.club_members'::regclass AND tgname='task08_block_last_main_departure')
 THEN RAISE EXCEPTION 'H09 last-main stage setup has drifted'; END IF;
END $preflight$;
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
CREATE TRIGGER task08_block_last_main_departure
BEFORE UPDATE OF role,is_active,status,club_id ON public.club_members
FOR EACH ROW EXECUTE FUNCTION security_private.task08_guard_last_main_member();
ROLLBACK;
