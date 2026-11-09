-- 手動適用前に docs/friendly-team-roster.md の確認・バックアップを実施する。
BEGIN;
CREATE TABLE public.event_team_attendance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 side text NOT NULL CHECK(side IN ('team_a','team_b')),
 member_id uuid REFERENCES public.club_members(id),
 guest_id uuid REFERENCES public.event_team_guests(id),
 status text NOT NULL CHECK(status IN ('active','absent')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid NOT NULL,
 CHECK(num_nonnulls(member_id,guest_id)=1),
 UNIQUE(event_id,side,member_id), UNIQUE(event_id,side,guest_id)
);
ALTER TABLE public.event_team_attendance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_team_attendance FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.event_team_attendance TO authenticated;
CREATE POLICY team_attendance_read ON public.event_team_attendance FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND e.event_mode='team' AND NOT e.is_deleted
 AND public.can_view_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id))
);
CREATE FUNCTION public.set_friendly_team_attendance(p_event uuid,p_side text,p_member uuid,p_guest uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.events; g public.event_team_guests; row_id uuid; player_id uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTEDで実行してください'; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインが必要です' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.events WHERE id=p_event FOR UPDATE;
 IF NOT FOUND OR e.event_mode<>'team' OR e.is_deleted OR e.status<>'active'
 OR NOT coalesce(public.can_manage_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id),false)
 THEN RAISE EXCEPTION '開催の出欠を変更する権限がありません' USING ERRCODE='42501'; END IF;
 IF p_side NOT IN ('team_a','team_b') OR p_side IS NULL OR p_status NOT IN ('active','absent') OR p_status IS NULL
 OR num_nonnulls(p_member,p_guest)<>1 THEN RAISE EXCEPTION '出欠の指定が不正です'; END IF;
 IF p_member IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM public.event_team_sides s JOIN public.club_members cm ON cm.club_id=s.club_id
 JOIN public.player_profiles pp ON pp.id=COALESCE(cm.player_profile_id,cm.profile_id)
 WHERE s.event_id=p_event AND s.side=p_side AND cm.is_active AND pp.is_active AND cm.id=p_member
 ) THEN RAISE EXCEPTION '現在のチームメンバーを確認してください'; END IF;
 IF p_guest IS NOT NULL THEN
 SELECT * INTO g FROM public.event_team_guests WHERE id=p_guest AND event_id=p_event AND side=p_side;
 IF NOT FOUND THEN RAISE EXCEPTION '現在のゲストを確認してください'; END IF;
 END IF;
 IF p_member IS NOT NULL THEN SELECT COALESCE(player_profile_id,profile_id) INTO player_id FROM public.club_members WHERE id=p_member; END IF;
 IF p_status='absent' AND EXISTS(SELECT 1 FROM public.event_team_matches m WHERE m.event_id=p_event
 AND (m.result='undecided' OR m.team_a_score IS NULL OR m.team_b_score IS NULL)
 AND CASE WHEN p_side='team_a' THEN (player_id IN(m.team_a_player1_profile_id,m.team_a_player2_profile_id)
 OR (p_guest IS NOT NULL AND g.guest_name IN(m.team_a_player1_guest_name,m.team_a_player2_guest_name)))
 ELSE (player_id IN(m.team_b_player1_profile_id,m.team_b_player2_profile_id)
 OR (p_guest IS NOT NULL AND g.guest_name IN(m.team_b_player1_guest_name,m.team_b_player2_guest_name))) END)
 THEN RAISE EXCEPTION '未完了カードに登録されています。カードを確認してから欠席に変更してください'; END IF;
 SELECT id INTO row_id FROM public.event_team_attendance WHERE event_id=p_event AND side=p_side
 AND (member_id=p_member OR guest_id=p_guest);
 IF row_id IS NULL THEN
 INSERT INTO public.event_team_attendance(event_id,side,member_id,guest_id,status,updated_by)
 VALUES(p_event,p_side,p_member,p_guest,p_status,auth.uid());
 ELSE UPDATE public.event_team_attendance SET status=p_status,updated_at=now(),updated_by=auth.uid() WHERE id=row_id; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_friendly_team_attendance(uuid,text,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_friendly_team_attendance(uuid,text,uuid,uuid,text) TO authenticated;
CREATE SCHEMA team_attendance_private;
REVOKE ALL ON SCHEMA team_attendance_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION team_attendance_private.guard_lineup() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE side_key text; n integer; pid uuid; v_guest_name text;
BEGIN
 IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
 -- 保存済みの編成が変わらないスコア・動画・メモ更新には影響させない。
 IF TG_OP='UPDATE' AND NEW.event_id=OLD.event_id AND
 (to_jsonb(NEW)-ARRAY['team_a_score','team_b_score','result','score_detail','memo','youtube_url','updated_at'])
 IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['team_a_score','team_b_score','result','score_detail','memo','youtube_url','updated_at']) THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTEDで実行してください'; END IF;
 PERFORM 1 FROM public.events e WHERE e.id=NEW.event_id AND e.event_mode='team' AND NOT e.is_deleted AND e.status='active' AND coalesce(public.can_manage_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id),false) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '編成を変更する権限がありません' USING ERRCODE='42501'; END IF;
 FOREACH side_key IN ARRAY ARRAY['team_a','team_b'] LOOP
 FOR n IN 1..2 LOOP
 pid:=(to_jsonb(NEW)->>(side_key||'_player'||n||'_profile_id'))::uuid;
 v_guest_name:=to_jsonb(NEW)->>(side_key||'_player'||n||'_guest_name');
 IF EXISTS(SELECT 1 FROM public.event_team_attendance a LEFT JOIN public.club_members cm ON cm.id=a.member_id LEFT JOIN public.event_team_guests g ON g.id=a.guest_id
 WHERE a.event_id=NEW.event_id AND a.side=side_key AND a.status='absent'
 AND (COALESCE(cm.player_profile_id,cm.profile_id)=pid OR (pid IS NULL AND g.guest_name=v_guest_name)))
 THEN RAISE EXCEPTION '欠席者は新しい編成に登録できません。参加状態を確認してください'; END IF;
 END LOOP;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION team_attendance_private.guard_lineup() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_team_lineup_attendance BEFORE INSERT OR UPDATE ON public.event_team_matches
FOR EACH ROW EXECUTE FUNCTION team_attendance_private.guard_lineup();
CREATE FUNCTION team_attendance_private.guard_side_group() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND (NEW.club_id IS DISTINCT FROM OLD.club_id OR NEW.side IS DISTINCT FROM OLD.side OR NEW.event_id IS DISTINCT FROM OLD.event_id)
 THEN RAISE EXCEPTION '作成後の所属グループは変更できません' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION team_attendance_private.guard_side_group() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_team_side_group BEFORE UPDATE ON public.event_team_sides FOR EACH ROW EXECUTE FUNCTION team_attendance_private.guard_side_group();
NOTIFY pgrst, 'reload schema';
COMMIT;
