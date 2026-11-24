-- Consumer support only; does not change old SELECT/UPDATE policies or grants.
BEGIN;
DO $$ BEGIN IF current_user<>'postgres' THEN RAISE EXCEPTION 'Migration owner must be postgres'; END IF; END $$;
CREATE FUNCTION public.get_club_stats_members(p_club_id uuid) RETURNS TABLE(player_profile_id uuid,is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM group_read_private.require_member(p_club_id);
 RETURN QUERY SELECT cm.player_profile_id,cm.is_active FROM public.club_members cm WHERE cm.club_id=p_club_id ORDER BY cm.id;
END $$;
CREATE FUNCTION public.get_club_selection_candidates(p_club_id uuid) RETURNS TABLE(member_id uuid,player_profile_id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM group_read_private.require_member(p_club_id);
 RETURN QUERY SELECT cm.id,pp.id,pp.display_name FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=coalesce(cm.player_profile_id,cm.profile_id)
 WHERE cm.club_id=p_club_id AND cm.is_active AND pp.is_active ORDER BY cm.id;
END $$;
CREATE FUNCTION public.get_official_player_names(p_event_id uuid) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.official_events e WHERE e.id=p_event_id AND NOT coalesce(e.is_deleted,false)
 AND (public.is_super_user() OR group_read_private.member(e.club_id) OR (e.club_id IS NULL AND e.created_by_auth_user_id=auth.uid()))) THEN
 RAISE EXCEPTION 'イベントの閲覧権限がありません' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT pp.id,pp.display_name FROM public.player_profiles pp WHERE EXISTS(SELECT 1 FROM public.official_matches m WHERE m.official_event_id=p_event_id AND pp.id IN(m.our_player1_profile_id,m.our_player2_profile_id)) ORDER BY pp.id;
END $$;
REVOKE ALL ON FUNCTION public.get_club_stats_members(uuid),public.get_club_selection_candidates(uuid),public.get_official_player_names(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_stats_members(uuid),public.get_club_selection_candidates(uuid),public.get_official_player_names(uuid) TO authenticated;
CREATE FUNCTION group_read_private.claim_member(p_club uuid,p_reference uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE mid uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501'; END IF;
 SELECT cm.id INTO mid FROM group_read_private.directory_refs r JOIN public.club_members cm ON cm.id=r.member_id JOIN public.player_profiles pp ON pp.id=cm.player_profile_id JOIN public.clubs c ON c.id=cm.club_id
 WHERE r.public_ref=p_reference AND c.id=p_club AND c.visibility='public' AND c.is_active AND NOT coalesce(c.is_deleted,false) AND cm.is_active AND pp.is_active AND pp.linked_auth_user_id IS NULL;
 IF mid IS NULL THEN RAISE EXCEPTION '本人の仮登録選手を再確認してください' USING ERRCODE='42501'; END IF;
 RETURN mid;
END $$;
CREATE FUNCTION public.preview_public_club_claim(p_club_id uuid,p_reference uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb;mid uuid;
BEGIN
 mid:=group_read_private.claim_member(p_club_id,p_reference);
 v:=public.preview_profile_join(p_club_id,mid);
 RETURN jsonb_build_object('display_name',v->'source'->>'display_name','target_display_name',v->>'target_display_name','has_target',v->>'target_profile_id' IS NOT NULL,'review_token',v->>'review_token',
 'membership_count',jsonb_array_length(v->'memberships'),'participant_count',v->'participant_count','match_count',v->'match_count','result_count',v->'result_count','team_match_count',v->'team_match_count','official_match_count',v->'official_match_count');
END $$;
CREATE FUNCTION public.submit_public_club_claim(p_club_id uuid,p_reference uuid DEFAULT NULL,p_message text DEFAULT NULL,p_review_token text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM profile_link_private.serialize_operations();
 RETURN public.submit_profile_join_request(p_club_id,CASE WHEN p_reference IS NOT NULL THEN group_read_private.claim_member(p_club_id,p_reference) END,p_message,p_review_token);
END $$;
REVOKE ALL ON FUNCTION group_read_private.claim_member(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.preview_public_club_claim(uuid,uuid),public.submit_public_club_claim(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_public_club_claim(uuid,uuid),public.submit_public_club_claim(uuid,uuid,text,text) TO authenticated;
CREATE FUNCTION public.get_club_join_request_names(p_club_id uuid) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT p.id,p.display_name FROM public.profiles p WHERE EXISTS(SELECT 1 FROM public.join_requests r WHERE r.club_id=p_club_id AND r.requester_auth_user_id=p.id AND (r.requester_auth_user_id=auth.uid() OR public.can_manage_player_profile_club(p_club_id))) ORDER BY p.id;
END $$;
CREATE FUNCTION public.get_admin_group_member_counts() RETURNS TABLE(club_id uuid,member_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_user() THEN RAISE EXCEPTION '管理権限がありません' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT cm.club_id,count(*) FROM public.club_members cm WHERE cm.is_active GROUP BY cm.club_id ORDER BY cm.club_id;
END $$;
CREATE FUNCTION public.get_admin_account_names(p_ids uuid[]) RETURNS TABLE(id uuid,display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_user() THEN RAISE EXCEPTION '管理権限がありません' USING ERRCODE='42501'; END IF;
 IF coalesce(cardinality(p_ids),0)>100 THEN RAISE EXCEPTION '取得件数が多すぎます' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT p.id,p.display_name FROM public.profiles p WHERE p.id=ANY(p_ids) ORDER BY p.id;
END $$;
REVOKE ALL ON FUNCTION public.get_club_join_request_names(uuid),public.get_admin_group_member_counts(),public.get_admin_account_names(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_join_request_names(uuid),public.get_admin_group_member_counts(),public.get_admin_account_names(uuid[]) TO authenticated;
CREATE FUNCTION public.get_club_join_requests(p_club_id uuid) RETURNS TABLE(id uuid,club_id uuid,target_club_member_id uuid,requester_auth_user_id uuid,requester_player_profile_id uuid,message text,status text,created_at timestamptz,expires_at timestamptz,consent_at timestamptz,requester_display_name_snapshot text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT r.id,r.club_id,CASE WHEN public.can_manage_player_profile_club(p_club_id) THEN r.target_club_member_id ELSE d.public_ref END,r.requester_auth_user_id,
 CASE WHEN public.can_manage_player_profile_club(p_club_id) THEN r.requester_player_profile_id ELSE NULL::uuid END,r.message,r.status,r.created_at,r.expires_at,r.consent_at,r.requester_display_name_snapshot
 FROM public.join_requests r LEFT JOIN group_read_private.directory_refs d ON d.member_id=r.target_club_member_id
 WHERE r.club_id=p_club_id AND (r.requester_auth_user_id=auth.uid() OR public.can_manage_player_profile_club(p_club_id)) ORDER BY r.created_at DESC,r.id;
END $$;
REVOKE ALL ON FUNCTION public.get_club_join_requests(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_club_join_requests(uuid) TO authenticated;
COMMIT;
