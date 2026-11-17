BEGIN;
ALTER TABLE public.player_profile_private
 ADD COLUMN avatar_focus_x double precision NOT NULL DEFAULT 0.5,
 ADD COLUMN avatar_focus_y double precision NOT NULL DEFAULT 0.5,
 ADD COLUMN avatar_zoom double precision NOT NULL DEFAULT 1,
 ADD COLUMN avatar_pose_version bigint NOT NULL DEFAULT 0,
 ADD CONSTRAINT profile_avatar_position_bounds CHECK (
  avatar_focus_x >= 0 AND avatar_focus_x <= 1 AND avatar_focus_y >= 0 AND avatar_focus_y <= 1
  AND avatar_zoom >= 1 AND avatar_zoom <= 4 AND avatar_pose_version >= 0
 );

-- 0048の画像確定/連携解除RPCを置換せず、画像や所有者が変わる全経路を保護する。
CREATE FUNCTION profile_media_private.reset_avatar_position() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.avatar_key IS DISTINCT FROM OLD.avatar_key OR NEW.avatar_version IS DISTINCT FROM OLD.avatar_version
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
  NEW.avatar_focus_x:=0.5; NEW.avatar_focus_y:=0.5; NEW.avatar_zoom:=1;
  NEW.avatar_pose_version:=OLD.avatar_pose_version+1;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION profile_media_private.reset_avatar_position() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER profile_avatar_position_reset BEFORE UPDATE OF avatar_key,avatar_version,owner_id
 ON public.player_profile_private FOR EACH ROW EXECUTE FUNCTION profile_media_private.reset_avatar_position();

CREATE FUNCTION public.save_my_avatar_position(p_profile uuid,p_expected_avatar bigint,p_expected_pose bigint,
 p_x double precision,p_y double precision,p_zoom double precision,p_ticket uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; m public.player_profile_private;
BEGIN
 uid:=profile_media_private.owner(p_profile);
 PERFORM profile_media_private.consume(p_ticket);
 IF p_expected_avatar IS NULL OR p_expected_pose IS NULL OR p_expected_avatar<0 OR p_expected_pose<0
  OR p_x IS NULL OR p_y IS NULL OR p_zoom IS NULL
  OR NOT(p_x>=0 AND p_x<=1 AND p_y>=0 AND p_y<=1 AND p_zoom>=1 AND p_zoom<=4) THEN
  RAISE EXCEPTION '写真の表示設定を確認してください' USING ERRCODE='22023';
 END IF;
 UPDATE public.player_profile_private
  SET avatar_focus_x=p_x,avatar_focus_y=p_y,avatar_zoom=p_zoom,avatar_pose_version=avatar_pose_version+1,updated_at=clock_timestamp()
  WHERE profile_id=p_profile AND owner_id=uid AND avatar_key IS NOT NULL
    AND avatar_version=p_expected_avatar AND avatar_pose_version=p_expected_pose
  RETURNING * INTO m;
 IF NOT FOUND THEN RAISE EXCEPTION '写真または表示位置が別の画面で変更されています。再読み込みしてください' USING ERRCODE='40001'; END IF;
 RETURN to_jsonb(m);
END; $$;
REVOKE ALL ON FUNCTION public.save_my_avatar_position(uuid,bigint,bigint,double precision,double precision,double precision,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_avatar_position(uuid,bigint,bigint,double precision,double precision,double precision,uuid) TO authenticated;

-- 本人の履歴だけを集計する。呼出者の既存RLS/SELECT権限をそのまま使い、所属候補はUI側で維持する。
CREATE FUNCTION public.get_my_profile_group_usage() RETURNS TABLE(club_id uuid,event_count bigint,last_used_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH owned AS MATERIALIZED (SELECT p.id FROM public.player_profiles p WHERE p.linked_auth_user_id=auth.uid()),
 recent AS MATERIALIZED (
  SELECT e.id,e.club_id,e.event_mode,e.created_at,e.created_by_auth_user_id FROM public.events e
  WHERE NOT e.is_deleted AND e.created_at>=statement_timestamp()-interval '90 days' AND e.created_at<=statement_timestamp()
 ), personal AS (
  SELECT e.* FROM recent e WHERE e.created_by_auth_user_id=auth.uid()
  OR EXISTS(SELECT 1 FROM public.event_participants p WHERE p.event_id=e.id AND p.participant_type='member'
   AND (p.player_profile_id IN(SELECT id FROM owned) OR p.profile_id=auth.uid())
   AND (p.status IS DISTINCT FROM 'absent' OR EXISTS(SELECT 1 FROM public.match_players mp WHERE mp.participant_id=p.id)))
  OR (e.event_mode='team' AND (
   EXISTS(SELECT 1 FROM public.event_team_matches m WHERE m.event_id=e.id AND
    (m.team_a_player1_profile_id IN(SELECT id FROM owned) OR m.team_a_player2_profile_id IN(SELECT id FROM owned)
     OR m.team_b_player1_profile_id IN(SELECT id FROM owned) OR m.team_b_player2_profile_id IN(SELECT id FROM owned)))
   OR EXISTS(SELECT 1 FROM public.event_team_rounds r CROSS JOIN LATERAL jsonb_array_elements(r.eligible) p
    WHERE r.event_id=e.id AND p->>'profile_id' IN(SELECT id::text FROM owned))
   OR EXISTS(SELECT 1 FROM public.event_team_attendance a JOIN public.club_members cm ON cm.id=a.member_id
    WHERE a.event_id=e.id AND a.status='active' AND (cm.player_profile_id IN(SELECT id FROM owned) OR cm.profile_id=auth.uid()))
  ))
 ), activity AS (
  SELECT 'friendly:'||e.id::text event_key,e.club_id,e.created_at FROM personal e WHERE e.club_id IS NOT NULL
  UNION
  SELECT 'friendly:'||e.id::text,s.club_id,e.created_at FROM personal e JOIN public.event_team_sides s ON s.event_id=e.id
   WHERE e.event_mode='team' AND s.club_id IS NOT NULL
  UNION
  SELECT 'official:'||e.id::text,e.club_id,e.created_at FROM public.official_events e
   WHERE NOT e.is_deleted AND e.club_id IS NOT NULL AND e.created_at>=statement_timestamp()-interval '90 days' AND e.created_at<=statement_timestamp()
   AND (e.created_by_auth_user_id=auth.uid() OR EXISTS(SELECT 1 FROM public.official_opponents o JOIN public.official_matches m ON m.official_opponent_id=o.id
    WHERE o.official_event_id=e.id AND (m.our_player1_profile_id IN(SELECT id FROM owned) OR m.our_player2_profile_id IN(SELECT id FROM owned))))
 )
 SELECT a.club_id,count(DISTINCT a.event_key),max(a.created_at) FROM activity a GROUP BY a.club_id;
$$;
REVOKE ALL ON FUNCTION public.get_my_profile_group_usage() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile_group_usage() TO authenticated;
COMMIT;
