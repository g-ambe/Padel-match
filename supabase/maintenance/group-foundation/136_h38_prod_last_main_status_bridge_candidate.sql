-- TASK-08 / H38 - production COMPATIBILITY CANDIDATE, not approved for Prod apply.
-- Reuse Prod's existing last-main guard for DELETE/role/is_active/club_id.
-- Add Stage H09 equivalent only for the missing status column, to meet H15/H19 dependency.
-- Must be ordered after H12 creation of security_private schema.
BEGIN;
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
COMMIT;
