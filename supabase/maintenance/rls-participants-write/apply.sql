-- Candidate only: production requires explicit approval. No row writes.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.event_participants IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.event_participants'::regclass)
 OR (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY policyname),'[]'::jsonb) FROM pg_policies p WHERE schemaname='public' AND tablename='event_participants') IS DISTINCT FROM $snapshot$[{"cmd":"ALL","qual":"true","roles":["anon","authenticated"],"tablename":"event_participants","permissive":"PERMISSIVE","policyname":"dev_all_event_participants","schemaname":"public","with_check":"true"},{"cmd":"SELECT","qual":"is_super_user()","roles":["authenticated"],"tablename":"event_participants","permissive":"PERMISSIVE","policyname":"event_participants_super_user_select","schemaname":"public","with_check":null}]$snapshot$::jsonb
 THEN RAISE EXCEPTION 'Participant policy drift; stop'; END IF;
 IF NOT has_table_privilege('anon','public.event_participants','TRUNCATE')
 OR NOT has_table_privilege('authenticated','public.event_participants','TRUNCATE')
 THEN RAISE EXCEPTION 'Participant truncate privilege drift; stop'; END IF;
END $guard$;
CREATE SCHEMA participants_identity_private;
REVOKE ALL ON SCHEMA participants_identity_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION participants_identity_private.guard_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $body$
BEGIN
 IF current_user IN ('anon','authenticated')
 AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.event_id IS DISTINCT FROM OLD.event_id
  OR NEW.profile_id IS DISTINCT FROM OLD.profile_id OR NEW.player_profile_id IS DISTINCT FROM OLD.player_profile_id
  OR NEW.participant_type IS DISTINCT FROM OLD.participant_type)
 THEN RAISE EXCEPTION '参加者のID・開催・選手参照・種別は変更できません' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $body$;
REVOKE ALL ON FUNCTION participants_identity_private.guard_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_participant_identity BEFORE UPDATE ON public.event_participants
 FOR EACH ROW EXECUTE FUNCTION participants_identity_private.guard_identity();
CREATE POLICY rls07_participants_select_compat ON public.event_participants FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY rls07_participants_delete_compat ON public.event_participants FOR DELETE TO anon,authenticated USING(true);
CREATE POLICY rls07_participants_insert ON public.event_participants FOR INSERT TO authenticated
 WITH CHECK ((auth.uid() IS NOT NULL AND EXISTS (
 SELECT 1 FROM public.events e WHERE e.id=event_participants.event_id
 AND NOT coalesce(e.is_deleted,false)
 AND (
  public.is_super_user()
  OR (e.club_id IS NULL AND e.created_by_auth_user_id=auth.uid())
  OR EXISTS (
   SELECT 1 FROM public.club_members cm
   LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
   WHERE cm.club_id=e.club_id AND cm.is_active
   AND (cm.profile_id=auth.uid() OR pp.linked_auth_user_id=auth.uid())
  )
  OR (e.event_mode='team' AND public.can_manage_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id))
 )
)) AND (
 (participant_type='guest' AND profile_id IS NULL AND player_profile_id IS NULL)
 OR (participant_type='member' AND (
  public.is_super_user()
  OR EXISTS (
   SELECT 1 FROM public.events e WHERE e.id=event_participants.event_id AND (
    (e.club_id IS NULL AND (
      (event_participants.player_profile_id IS NULL AND event_participants.profile_id=auth.uid())
      OR EXISTS(SELECT 1 FROM public.player_profiles self
        WHERE self.id=event_participants.player_profile_id AND self.is_active AND self.linked_auth_user_id=auth.uid())
    ))
    OR EXISTS (
     SELECT 1 FROM public.club_members target
     WHERE target.club_id=e.club_id AND target.is_active AND (
      (event_participants.player_profile_id IS NOT NULL AND target.player_profile_id=event_participants.player_profile_id)
      OR (target.player_profile_id IS NULL AND target.profile_id=event_participants.player_profile_id)
      OR (event_participants.player_profile_id IS NULL AND target.profile_id=event_participants.profile_id)
     )
    )
   )
  )
 ))
));
CREATE POLICY rls07_participants_update ON public.event_participants FOR UPDATE TO authenticated
 USING ((auth.uid() IS NOT NULL AND EXISTS (
 SELECT 1 FROM public.events e WHERE e.id=event_participants.event_id
 AND NOT coalesce(e.is_deleted,false)
 AND (
  public.is_super_user()
  OR (e.club_id IS NULL AND e.created_by_auth_user_id=auth.uid())
  OR EXISTS (
   SELECT 1 FROM public.club_members cm
   LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
   WHERE cm.club_id=e.club_id AND cm.is_active
   AND (cm.profile_id=auth.uid() OR pp.linked_auth_user_id=auth.uid())
  )
  OR (e.event_mode='team' AND public.can_manage_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id))
 )
))) WITH CHECK ((auth.uid() IS NOT NULL AND EXISTS (
 SELECT 1 FROM public.events e WHERE e.id=event_participants.event_id
 AND NOT coalesce(e.is_deleted,false)
 AND (
  public.is_super_user()
  OR (e.club_id IS NULL AND e.created_by_auth_user_id=auth.uid())
  OR EXISTS (
   SELECT 1 FROM public.club_members cm
   LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
   WHERE cm.club_id=e.club_id AND cm.is_active
   AND (cm.profile_id=auth.uid() OR pp.linked_auth_user_id=auth.uid())
  )
  OR (e.event_mode='team' AND public.can_manage_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id))
 )
)));
DROP POLICY dev_all_event_participants ON public.event_participants;
REVOKE TRUNCATE ON public.event_participants FROM anon,authenticated;
DO $guard$ BEGIN
 IF has_table_privilege('anon','public.event_participants','TRUNCATE')
 OR has_table_privilege('authenticated','public.event_participants','TRUNCATE')
 THEN RAISE EXCEPTION 'Inherited truncate privilege remains; stop'; END IF;
END $guard$;
COMMIT;
