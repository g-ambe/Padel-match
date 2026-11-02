BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';
LOCK TABLE public.event_participants IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY policyname),'[]'::jsonb) FROM pg_policies p WHERE schemaname='public' AND tablename='event_participants') IS DISTINCT FROM $snapshot$[{"schemaname":"public","tablename":"event_participants","policyname":"event_participants_super_user_select","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"SELECT","qual":"is_super_user()","with_check":null},{"schemaname":"public","tablename":"event_participants","policyname":"rls07_participants_delete_compat","permissive":"PERMISSIVE","roles":["anon","authenticated"],"cmd":"DELETE","qual":"true","with_check":null},{"schemaname":"public","tablename":"event_participants","policyname":"rls07_participants_insert","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"INSERT","qual":null,"with_check":"((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1\n   FROM events e\n  WHERE ((e.id = event_participants.event_id) AND (NOT COALESCE(e.is_deleted, false)) AND (is_super_user() OR ((e.club_id IS NULL) AND (e.created_by_auth_user_id = auth.uid())) OR (EXISTS ( SELECT 1\n           FROM (club_members cm\n             LEFT JOIN player_profiles pp ON ((pp.id = cm.player_profile_id)))\n          WHERE ((cm.club_id = e.club_id) AND cm.is_active AND ((cm.profile_id = auth.uid()) OR (pp.linked_auth_user_id = auth.uid()))))) OR ((e.event_mode = 'team'::text) AND can_manage_friendly_team_event_by_sides(e.id, e.created_by_auth_user_id)))))) AND (((participant_type = 'guest'::text) AND (profile_id IS NULL) AND (player_profile_id IS NULL)) OR ((participant_type = 'member'::text) AND (is_super_user() OR (EXISTS ( SELECT 1\n   FROM events e\n  WHERE ((e.id = event_participants.event_id) AND (((e.club_id IS NULL) AND (((event_participants.player_profile_id IS NULL) AND (event_participants.profile_id = auth.uid())) OR (EXISTS ( SELECT 1\n           FROM player_profiles self\n          WHERE ((self.id = event_participants.player_profile_id) AND self.is_active AND (self.linked_auth_user_id = auth.uid())))))) OR (EXISTS ( SELECT 1\n           FROM club_members target\n          WHERE ((target.club_id = e.club_id) AND target.is_active AND (((event_participants.player_profile_id IS NOT NULL) AND (target.player_profile_id = event_participants.player_profile_id)) OR ((target.player_profile_id IS NULL) AND (target.profile_id = event_participants.player_profile_id)) OR ((event_participants.player_profile_id IS NULL) AND (target.profile_id = event_participants.profile_id))))))))))))))"},{"schemaname":"public","tablename":"event_participants","policyname":"rls07_participants_select_compat","permissive":"PERMISSIVE","roles":["anon","authenticated"],"cmd":"SELECT","qual":"true","with_check":null},{"schemaname":"public","tablename":"event_participants","policyname":"rls07_participants_update","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"UPDATE","qual":"((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1\n   FROM events e\n  WHERE ((e.id = event_participants.event_id) AND (NOT COALESCE(e.is_deleted, false)) AND (is_super_user() OR ((e.club_id IS NULL) AND (e.created_by_auth_user_id = auth.uid())) OR (EXISTS ( SELECT 1\n           FROM (club_members cm\n             LEFT JOIN player_profiles pp ON ((pp.id = cm.player_profile_id)))\n          WHERE ((cm.club_id = e.club_id) AND cm.is_active AND ((cm.profile_id = auth.uid()) OR (pp.linked_auth_user_id = auth.uid()))))) OR ((e.event_mode = 'team'::text) AND can_manage_friendly_team_event_by_sides(e.id, e.created_by_auth_user_id)))))))","with_check":"((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1\n   FROM events e\n  WHERE ((e.id = event_participants.event_id) AND (NOT COALESCE(e.is_deleted, false)) AND (is_super_user() OR ((e.club_id IS NULL) AND (e.created_by_auth_user_id = auth.uid())) OR (EXISTS ( SELECT 1\n           FROM (club_members cm\n             LEFT JOIN player_profiles pp ON ((pp.id = cm.player_profile_id)))\n          WHERE ((cm.club_id = e.club_id) AND cm.is_active AND ((cm.profile_id = auth.uid()) OR (pp.linked_auth_user_id = auth.uid()))))) OR ((e.event_mode = 'team'::text) AND can_manage_friendly_team_event_by_sides(e.id, e.created_by_auth_user_id)))))))"}]$snapshot$::jsonb
 OR NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.event_participants'::regclass AND t.tgname='guard_participant_identity' AND pg_get_triggerdef(t.oid)=$trigger$CREATE TRIGGER guard_participant_identity BEFORE UPDATE ON public.event_participants FOR EACH ROW EXECUTE FUNCTION participants_identity_private.guard_identity()$trigger$ AND replace(pg_get_functiondef(p.oid),chr(13),'')=replace($expected_function$CREATE OR REPLACE FUNCTION participants_identity_private.guard_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF current_user IN ('anon','authenticated')
 AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.event_id IS DISTINCT FROM OLD.event_id
  OR NEW.profile_id IS DISTINCT FROM OLD.profile_id OR NEW.player_profile_id IS DISTINCT FROM OLD.player_profile_id
  OR NEW.participant_type IS DISTINCT FROM OLD.participant_type)
 THEN RAISE EXCEPTION '参加者のID・開催・選手参照・種別は変更できません' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $function$
$expected_function$,chr(13),''))
 OR has_table_privilege('anon','public.event_participants','TRUNCATE') OR has_table_privilege('authenticated','public.event_participants','TRUNCATE')
 THEN RAISE EXCEPTION 'Participant post-apply definitions drifted; stop'; END IF;
END $guard$;
DROP POLICY rls07_participants_insert ON public.event_participants;
DROP POLICY rls07_participants_update ON public.event_participants;
DROP POLICY rls07_participants_select_compat ON public.event_participants;
DROP POLICY rls07_participants_delete_compat ON public.event_participants;
CREATE POLICY dev_all_event_participants ON public.event_participants FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
DROP TRIGGER guard_participant_identity ON public.event_participants;
DROP FUNCTION participants_identity_private.guard_identity();
DROP SCHEMA participants_identity_private;
GRANT TRUNCATE ON public.event_participants TO anon,authenticated;
COMMIT;
