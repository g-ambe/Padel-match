-- Candidate: event identity guard only. Production approval required.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.events IN SHARE ROW EXCLUSIVE MODE;
CREATE SCHEMA events_identity_private;
REVOKE ALL ON SCHEMA events_identity_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION events_identity_private.guard_event_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $body$
BEGIN
 IF current_user IN ('anon','authenticated')
 AND (NEW.id IS DISTINCT FROM OLD.id
   OR NEW.club_id IS DISTINCT FROM OLD.club_id
   OR NEW.created_by_auth_user_id IS DISTINCT FROM OLD.created_by_auth_user_id)
 THEN
   RAISE EXCEPTION '開催のID・所属グループ・作成者は変更できません' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END
$body$;
REVOKE ALL ON FUNCTION events_identity_private.guard_event_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_event_identity
 BEFORE UPDATE ON public.events
 FOR EACH ROW EXECUTE FUNCTION events_identity_private.guard_event_identity();
COMMIT;
