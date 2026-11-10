-- 生成ラウンドが1件もない場合専用。データがある場合は必ず停止する。
-- 既定はROLLBACK。隔離試験ではCOMMITに置換して検証する。本番での実行には別途承認が必要。
BEGIN;
LOCK TABLE public.events,public.event_team_matches,public.event_team_rounds IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.event_team_rounds) OR EXISTS(SELECT 1 FROM public.event_team_matches WHERE round_id IS NOT NULL)
 THEN RAISE EXCEPTION '生成データがあるためDB切戻しは禁止です。生成停止と前進修正を使用してください'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.set_friendly_team_attendance(p_event uuid,p_side text,p_member uuid,p_guest uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.events; g public.event_team_guests; row_id uuid; player_id uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTEDで実行してください'; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインが必要です' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.events WHERE id=p_event FOR UPDATE;
 IF NOT FOUND OR e.event_mode<>'team' OR e.is_deleted OR e.status<>'active'
 OR NOT coalesce(public.can_manage_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id),false)
 OR NOT coalesce(public.can_view_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id),false)
 THEN RAISE EXCEPTION '開催の出欠を変更する権限がありません' USING ERRCODE='42501'; END IF;
 IF p_side NOT IN ('team_a','team_b') OR p_side IS NULL OR p_status NOT IN ('active','absent') OR p_status IS NULL
 OR num_nonnulls(p_member,p_guest)<>1 THEN RAISE EXCEPTION '出欠の指定が不正です'; END IF;
 IF p_member IS NOT NULL THEN
 SELECT COALESCE(cm.player_profile_id,cm.profile_id) INTO player_id FROM
 public.event_team_sides s JOIN public.club_members cm ON cm.club_id=s.club_id
 JOIN public.player_profiles pp ON pp.id=COALESCE(cm.player_profile_id,cm.profile_id)
 WHERE s.event_id=p_event AND s.side=p_side AND cm.is_active AND pp.is_active AND cm.id=p_member
 FOR SHARE OF cm;
 IF NOT FOUND THEN RAISE EXCEPTION '現在のチームメンバーを確認してください'; END IF;
 END IF;
 IF p_guest IS NOT NULL THEN
 SELECT * INTO g FROM public.event_team_guests WHERE id=p_guest AND event_id=p_event AND side=p_side FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '現在のゲストを確認してください'; END IF;
 END IF;
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
DROP FUNCTION public.get_friendly_team_round_context(uuid);
DROP FUNCTION public.create_friendly_team_round(uuid,uuid,text,text,integer,jsonb);
DROP FUNCTION public.update_friendly_team_round_card(uuid,uuid,jsonb,jsonb);
DROP FUNCTION public.delete_friendly_team_round_card(uuid,uuid,jsonb);
DROP SCHEMA team_rounds_private CASCADE;
ALTER TABLE public.event_team_matches DROP COLUMN round_id CASCADE,
DROP COLUMN round_number CASCADE,
DROP COLUMN court_number CASCADE,
DROP COLUMN generation_mode CASCADE,
DROP COLUMN team_a_player1_source_side CASCADE,
DROP COLUMN team_a_player1_guest_id CASCADE,
DROP COLUMN team_a_player2_source_side CASCADE,
DROP COLUMN team_a_player2_guest_id CASCADE,
DROP COLUMN team_b_player1_source_side CASCADE,
DROP COLUMN team_b_player1_guest_id CASCADE,
DROP COLUMN team_b_player2_source_side CASCADE,
DROP COLUMN team_b_player2_guest_id CASCADE;
DROP TABLE public.event_team_rounds;
ROLLBACK;
