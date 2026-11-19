-- Phase 1 only: additive read interfaces. No existing SELECT policy/GRANT is removed.
-- Do not apply to production before consumer migration and cutover negative tests.
BEGIN;
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
 UNION ALL SELECT p.id,p.display_name,'account'::text FROM public.profiles p WHERE EXISTS(SELECT 1 FROM public.event_participants ep WHERE ep.event_id=p_event AND ep.profile_id=p.id)
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
 RETURN QUERY SELECT pp.id,pp.display_name FROM public.player_profiles pp WHERE EXISTS(SELECT 1 FROM public.official_matches m WHERE m.official_event_id=eid AND pp.id IN(m.our_player1_profile_id,m.our_player2_profile_id));
END $$;
CREATE FUNCTION public.get_club_stats_player_names(p_club_id uuid) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM group_read_private.require_member(p_club_id);
 RETURN QUERY SELECT pp.id,pp.display_name FROM public.player_profiles pp WHERE EXISTS(SELECT 1 FROM public.club_members cm WHERE cm.club_id=p_club_id AND cm.player_profile_id=pp.id)
 OR EXISTS(SELECT 1 FROM public.event_participants ep JOIN public.events e ON e.id=ep.event_id WHERE e.club_id=p_club_id AND ep.player_profile_id=pp.id);
END $$;
-- Internal helpers cannot be called through the public API. Explicit ACLs on every new function.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA group_read_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_public_club_directory(uuid),public.get_club_roster(uuid),public.get_my_club_memberships(),public.get_event_club_candidates(uuid,uuid),public.get_event_player_names(uuid),public.get_club_stats_player_names(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_directory(uuid),public.get_club_roster(uuid),public.get_my_club_memberships(),public.get_event_club_candidates(uuid,uuid),public.get_event_player_names(uuid),public.get_club_stats_player_names(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_shared_event_player_names(text),public.get_shared_official_player_names(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_event_player_names(text),public.get_shared_official_player_names(text) TO anon,authenticated;
COMMIT;
