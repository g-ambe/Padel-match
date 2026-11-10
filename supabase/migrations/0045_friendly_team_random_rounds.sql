-- 対決・混合の自動編成。既存0044は変更しない。本番適用は別途承認後。
BEGIN;
CREATE SCHEMA team_rounds_private;
REVOKE ALL ON SCHEMA team_rounds_private FROM PUBLIC,anon,authenticated;
CREATE TABLE public.event_team_rounds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 round_number integer NOT NULL CHECK(round_number>0), mode text NOT NULL CHECK(mode IN ('confrontation','mixed')),
 court_count integer NOT NULL CHECK(court_count BETWEEN 1 AND 5), eligible jsonb NOT NULL CHECK(jsonb_typeof(eligible)='array'),
 request_id uuid NOT NULL, request_fingerprint text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,round_number), UNIQUE(event_id,request_id)
);
ALTER TABLE public.event_team_rounds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_team_rounds FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.event_team_rounds TO authenticated;
CREATE POLICY team_rounds_read ON public.event_team_rounds FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND e.event_mode='team' AND NOT e.is_deleted
 AND public.can_view_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id))
);
ALTER TABLE public.event_team_matches
 ADD COLUMN round_id uuid REFERENCES public.event_team_rounds(id) DEFERRABLE INITIALLY DEFERRED,
 ADD COLUMN round_number integer,
 ADD COLUMN court_number integer,
 ADD COLUMN pair_1_score integer CHECK(pair_1_score>=0),
 ADD COLUMN pair_2_score integer CHECK(pair_2_score>=0),
 ADD COLUMN pair_result text CHECK(pair_result IN ('win','lose','draw','undecided')),
 ADD COLUMN generation_mode text CHECK(generation_mode IN ('confrontation','mixed')),
 ADD COLUMN team_a_player1_source_side text CHECK(team_a_player1_source_side IN ('team_a','team_b')),
 ADD COLUMN team_a_player1_guest_id uuid REFERENCES public.event_team_guests(id) DEFERRABLE INITIALLY DEFERRED,
 ADD COLUMN team_a_player2_source_side text CHECK(team_a_player2_source_side IN ('team_a','team_b')),
 ADD COLUMN team_a_player2_guest_id uuid REFERENCES public.event_team_guests(id) DEFERRABLE INITIALLY DEFERRED,
 ADD COLUMN team_b_player1_source_side text CHECK(team_b_player1_source_side IN ('team_a','team_b')),
 ADD COLUMN team_b_player1_guest_id uuid REFERENCES public.event_team_guests(id) DEFERRABLE INITIALLY DEFERRED,
 ADD COLUMN team_b_player2_source_side text CHECK(team_b_player2_source_side IN ('team_a','team_b')),
 ADD COLUMN team_b_player2_guest_id uuid REFERENCES public.event_team_guests(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.event_team_matches ADD CONSTRAINT team_round_metadata CHECK (
 (round_id IS NULL AND round_number IS NULL AND court_number IS NULL AND generation_mode IS NULL)
 OR (round_id IS NOT NULL AND round_number IS NOT NULL AND court_number IS NOT NULL AND round_number>0 AND court_number BETWEEN 1 AND 5 AND generation_mode IS NOT NULL));
ALTER TABLE public.event_team_matches ADD CONSTRAINT team_round_sources CHECK ((round_id IS NULL AND team_a_player1_source_side IS NULL AND team_a_player1_guest_id IS NULL AND team_a_player2_source_side IS NULL AND team_a_player2_guest_id IS NULL AND team_b_player1_source_side IS NULL AND team_b_player1_guest_id IS NULL AND team_b_player2_source_side IS NULL AND team_b_player2_guest_id IS NULL) OR (round_id IS NOT NULL AND team_a_player1_source_side IS NOT NULL AND team_a_player2_source_side IS NOT NULL AND team_b_player1_source_side IS NOT NULL AND team_b_player2_source_side IS NOT NULL));
ALTER TABLE public.event_team_matches ADD CONSTRAINT team_round_scores CHECK ((generation_mode='mixed' AND team_a_score IS NULL AND team_b_score IS NULL AND result='undecided' AND pair_result IS NOT NULL) OR (coalesce(generation_mode,'confrontation')='confrontation' AND pair_1_score IS NULL AND pair_2_score IS NULL AND pair_result IS NULL));
CREATE UNIQUE INDEX team_round_court_unique ON public.event_team_matches(round_id,court_number) WHERE round_id IS NOT NULL;
CREATE FUNCTION team_rounds_private.players(m public.event_team_matches)
RETURNS TABLE(pair integer,slot_index integer,source text,profile_id uuid,guest_id uuid,guest_name text)
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ VALUES
 (0,0,coalesce(m.team_a_player1_source_side,'team_a'),m.team_a_player1_profile_id,m.team_a_player1_guest_id,m.team_a_player1_guest_name),
 (0,1,coalesce(m.team_a_player2_source_side,'team_a'),m.team_a_player2_profile_id,m.team_a_player2_guest_id,m.team_a_player2_guest_name),
 (1,2,coalesce(m.team_b_player1_source_side,'team_b'),m.team_b_player1_profile_id,m.team_b_player1_guest_id,m.team_b_player1_guest_name),
 (1,3,coalesce(m.team_b_player2_source_side,'team_b'),m.team_b_player2_profile_id,m.team_b_player2_guest_id,m.team_b_player2_guest_name) $$;
CREATE FUNCTION team_rounds_private.snapshot(p_event uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
WITH roster AS (
 SELECT 'profile:'||pp.id AS key,s.side AS source,pp.id AS profile_id,NULL::uuid AS guest_id,cm.id AS member_id,coalesce(pp.display_name,'名称未設定') AS name
 FROM public.event_team_sides s JOIN public.club_members cm ON cm.club_id=s.club_id AND cm.is_active
 JOIN public.player_profiles pp ON pp.id=coalesce(cm.player_profile_id,cm.profile_id) AND pp.is_active
 WHERE s.event_id=p_event AND NOT EXISTS(SELECT 1 FROM public.event_team_attendance a WHERE a.event_id=p_event AND a.side=s.side AND a.member_id=cm.id AND a.status='absent')
 UNION ALL SELECT 'guest:'||g.id,g.side,NULL::uuid,g.id,NULL::uuid,g.guest_name FROM public.event_team_guests g
 WHERE g.event_id=p_event AND NOT EXISTS(SELECT 1 FROM public.event_team_attendance a WHERE a.event_id=p_event AND a.side=g.side AND a.guest_id=g.id AND a.status='absent')
) SELECT jsonb_build_object(
 'court_count',(SELECT court_count FROM public.events WHERE id=p_event),
 'roster',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY source,key) FROM roster r),'[]'::jsonb),
 'matches',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY match_order,created_at,id) FROM public.event_team_matches m WHERE event_id=p_event),'[]'::jsonb),
 'rounds',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'round_number',r.round_number,'mode',r.mode,'court_count',r.court_count,'eligible',r.eligible) ORDER BY r.round_number) FROM public.event_team_rounds r WHERE event_id=p_event),'[]'::jsonb),
 'sides',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY side) FROM public.event_team_sides s WHERE event_id=p_event),'[]'::jsonb)
 ); $$;
CREATE FUNCTION team_rounds_private.lock_event(p_event uuid) RETURNS public.events
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.events;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'READ COMMITTEDで実行してください'; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインが必要です' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.events WHERE id=p_event FOR UPDATE;
 IF NOT FOUND OR e.event_mode<>'team' OR e.is_deleted OR e.status<>'active'
 OR NOT coalesce(public.can_manage_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id),false)
 OR NOT coalesce(public.can_view_friendly_team_event_by_sides(e.id,e.created_by_auth_user_id),false)
 THEN RAISE EXCEPTION '開催を操作する権限がありません' USING ERRCODE='42501'; END IF;
 RETURN e;
END $$;
CREATE FUNCTION public.get_friendly_team_round_context(p_event uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s jsonb;
BEGIN
 PERFORM team_rounds_private.lock_event(p_event);
 s:=team_rounds_private.snapshot(p_event);
 RETURN s||jsonb_build_object('revision',md5(s::text));
END $$;
-- 全接続の手動カード操作も開催ロックに参加させる。生成済みカードは期待値を検証するRPCのみ。
CREATE FUNCTION team_rounds_private.guard_card_write() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE slot text; pid uuid; guest_label text; v_source text;
BEGIN
 IF current_user IN ('anon','authenticated') THEN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS(SELECT 1 FROM public.events WHERE id=OLD.event_id) THEN RETURN OLD; END IF;
  IF (TG_OP<>'INSERT' AND OLD.round_id IS NOT NULL) OR (TG_OP<>'DELETE' AND NEW.round_id IS NOT NULL)
  THEN RAISE EXCEPTION '自動編成カードは画面を更新して操作してください' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND (NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.id IS DISTINCT FROM OLD.id) THEN RAISE EXCEPTION 'カードのID・開催は変更できません'; END IF;
  PERFORM 1 FROM public.events WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END FOR UPDATE;
  IF TG_OP<>'DELETE' AND (TG_OP='INSERT' OR (NEW.team_a_player1_profile_id,NEW.team_a_player1_guest_name,NEW.team_a_player2_profile_id,NEW.team_a_player2_guest_name,NEW.team_b_player1_profile_id,NEW.team_b_player1_guest_name,NEW.team_b_player2_profile_id,NEW.team_b_player2_guest_name) IS DISTINCT FROM (OLD.team_a_player1_profile_id,OLD.team_a_player1_guest_name,OLD.team_a_player2_profile_id,OLD.team_a_player2_guest_name,OLD.team_b_player1_profile_id,OLD.team_b_player1_guest_name,OLD.team_b_player2_profile_id,OLD.team_b_player2_guest_name)) THEN
   FOREACH slot IN ARRAY ARRAY['team_a_player1','team_a_player2','team_b_player1','team_b_player2'] LOOP
    pid:=(to_jsonb(NEW)->>(slot||'_profile_id'))::uuid; guest_label:=to_jsonb(NEW)->>(slot||'_guest_name'); v_source:=CASE WHEN slot LIKE 'team_a%' THEN 'team_a' ELSE 'team_b' END;
    IF EXISTS(SELECT 1 FROM public.event_team_matches m CROSS JOIN LATERAL (VALUES
     (m.team_a_player1_profile_id,m.team_a_player1_guest_name,coalesce(m.team_a_player1_source_side,'team_a')),
     (m.team_a_player2_profile_id,m.team_a_player2_guest_name,coalesce(m.team_a_player2_source_side,'team_a')),
     (m.team_b_player1_profile_id,m.team_b_player1_guest_name,coalesce(m.team_b_player1_source_side,'team_b')),
     (m.team_b_player2_profile_id,m.team_b_player2_guest_name,coalesce(m.team_b_player2_source_side,'team_b'))
    ) p(profile_id,guest_name,source) WHERE m.event_id=NEW.event_id AND m.round_id IS NOT NULL AND m.id<>NEW.id
    AND (CASE WHEN m.generation_mode='mixed' THEN m.pair_result='undecided' OR m.pair_1_score IS NULL OR m.pair_2_score IS NULL ELSE m.result='undecided' OR m.team_a_score IS NULL OR m.team_b_score IS NULL END)
    AND ((pid IS NOT NULL AND p.profile_id=pid) OR (pid IS NULL AND nullif(btrim(guest_label),'') IS NOT NULL AND p.source=v_source AND p.guest_name=guest_label)))
    THEN RAISE EXCEPTION '未完了ラウンドに出場中の選手は重複登録できません'; END IF;
   END LOOP;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_team_round_write BEFORE INSERT OR UPDATE OR DELETE ON public.event_team_matches FOR EACH ROW EXECUTE FUNCTION team_rounds_private.guard_card_write();
CREATE FUNCTION team_rounds_private.check_round(p_round uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.event_team_rounds;
BEGIN
 SELECT * INTO r FROM public.event_team_rounds WHERE id=p_round;
 IF NOT FOUND THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.event_team_matches m WHERE m.round_id=p_round AND (m.event_id<>r.event_id OR m.round_number<>r.round_number OR m.generation_mode<>r.mode OR m.court_number>r.court_count))
 OR (SELECT count(*) FROM public.event_team_matches WHERE round_id=p_round)>r.court_count THEN RAISE EXCEPTION 'ラウンドの所属・面数が不整合です'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_team_matches m CROSS JOIN LATERAL team_rounds_private.players(m) p
 WHERE m.round_id=p_round AND (p.source IS NULL OR num_nonnulls(p.profile_id,p.guest_id)<>1 OR (p.profile_id IS NOT NULL AND p.guest_name IS NOT NULL) OR (p.guest_id IS NOT NULL AND nullif(btrim(p.guest_name),'') IS NULL)
 OR (p.guest_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.event_team_guests g WHERE g.id=p.guest_id AND g.event_id=m.event_id AND g.side=p.source))))
 THEN RAISE EXCEPTION '選手・ゲストの識別情報が不整合です'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_team_matches m CROSS JOIN LATERAL team_rounds_private.players(m) p WHERE m.round_id=p_round
 GROUP BY coalesce('profile:'||p.profile_id,'guest:'||p.guest_id) HAVING count(*)>1) THEN RAISE EXCEPTION '同じラウンドに同一選手は重複出場できません'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_team_matches m CROSS JOIN LATERAL team_rounds_private.players(m) p WHERE m.round_id=p_round GROUP BY m.id
 HAVING count(*) FILTER(WHERE p.source='team_a')<>2 OR count(*) FILTER(WHERE p.source='team_b')<>2)
 OR (r.mode='confrontation' AND EXISTS(SELECT 1 FROM public.event_team_matches m CROSS JOIN LATERAL team_rounds_private.players(m) p WHERE m.round_id=p_round AND p.source<>CASE WHEN p.pair=0 THEN 'team_a' ELSE 'team_b' END))
 OR (r.mode='mixed' AND EXISTS(SELECT 1 FROM public.event_team_matches m CROSS JOIN LATERAL team_rounds_private.players(m) p WHERE m.round_id=p_round GROUP BY m.id,p.pair HAVING count(*) FILTER(WHERE p.source='team_a')<>1))
 THEN RAISE EXCEPTION '編成モードと元所属の組み合わせが不正です'; END IF;
END $$;
CREATE FUNCTION team_rounds_private.round_constraint() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM team_rounds_private.check_round(OLD.round_id); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM team_rounds_private.check_round(NEW.round_id); END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER team_round_identity AFTER INSERT OR UPDATE OR DELETE ON public.event_team_matches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION team_rounds_private.round_constraint();
CREATE FUNCTION public.create_friendly_team_round(p_event uuid,p_request uuid,p_revision text,p_mode text,p_courts integer,p_cards jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.events; r public.event_team_rounds; s jsonb; fingerprint text; c jsonb; x jsonb; person jsonb; j jsonb; i integer; n integer:=0; rid uuid; rn integer; order_start integer; keys text[]:=ARRAY[]::text[]; slot text; key text;
BEGIN
 -- プロフィール統合の参照テーブルロックと同じ順序。通常の別開催同士は直列化しない。
 LOCK TABLE public.club_members IN ROW EXCLUSIVE MODE;
 LOCK TABLE public.event_team_matches IN ROW EXCLUSIVE MODE;
 e:=team_rounds_private.lock_event(p_event);
 IF p_request IS NULL OR p_revision IS NULL OR p_mode IS NULL OR p_mode NOT IN ('confrontation','mixed') OR p_courts IS NULL OR p_courts NOT BETWEEN 1 AND 5 OR jsonb_typeof(p_cards) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cards) NOT BETWEEN 1 AND p_courts THEN RAISE EXCEPTION 'ラウンドの指定が不正です'; END IF;
 fingerprint:=md5(jsonb_build_array(p_revision,p_mode,p_courts,p_cards)::text);
 SELECT * INTO r FROM public.event_team_rounds WHERE event_id=p_event AND request_id=p_request;
 IF FOUND THEN
  IF r.request_fingerprint<>fingerprint OR r.created_by<>auth.uid() THEN RAISE EXCEPTION '同じ操作IDに異なる編成は保存できません'; END IF;
  RETURN jsonb_build_object('round_id',r.id,'round_number',r.round_number);
 END IF;
 -- 出欠RPCとの直列化に加え、参加資格の検証中は所属・プロフィール・ゲストをロックする。
 PERFORM 1 FROM public.event_team_sides WHERE event_id=p_event ORDER BY id FOR SHARE;
 PERFORM 1 FROM public.event_team_sides s JOIN public.club_members cm ON cm.club_id=s.club_id JOIN public.player_profiles pp ON pp.id=coalesce(cm.player_profile_id,cm.profile_id) WHERE s.event_id=p_event ORDER BY cm.id FOR SHARE OF cm,pp;
 PERFORM 1 FROM public.event_team_guests WHERE event_id=p_event ORDER BY id FOR SHARE;
 s:=team_rounds_private.snapshot(p_event);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'roster') GROUP BY value->>'source',value->>'key' HAVING count(*)>1) THEN RAISE EXCEPTION '所属データが重複しています。グループ管理者へ確認してください'; END IF;
 IF md5(s::text)<>p_revision THEN RAISE EXCEPTION '出欠・試合履歴が更新されています。再度生成してください' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_team_matches WHERE event_id=p_event AND (CASE WHEN generation_mode='mixed' THEN pair_result='undecided' OR pair_1_score IS NULL OR pair_2_score IS NULL ELSE result='undecided' OR team_a_score IS NULL OR team_b_score IS NULL END)) THEN RAISE EXCEPTION '未完了の試合カードを確認してください'; END IF;
 SELECT coalesce(max(round_number),0)+1 INTO rn FROM public.event_team_rounds WHERE event_id=p_event;
 SELECT coalesce(max(match_order),0) INTO order_start FROM public.event_team_matches WHERE event_id=p_event;
 INSERT INTO public.event_team_rounds(event_id,round_number,mode,court_count,eligible,request_id,request_fingerprint,created_by)
 VALUES(p_event,rn,p_mode,jsonb_array_length(p_cards),s->'roster',p_request,fingerprint,auth.uid()) RETURNING id INTO rid;
 FOR c IN SELECT value FROM jsonb_array_elements(p_cards) LOOP
  n:=n+1;
  IF (c->>'court')::integer IS DISTINCT FROM n OR jsonb_typeof(c->'pairs') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'pairs')<>2
  OR jsonb_array_length(c->'pairs'->0)<>2 OR jsonb_array_length(c->'pairs'->1)<>2 THEN RAISE EXCEPTION 'コート・ペアの指定が不正です'; END IF;
  j:=jsonb_build_object('id',gen_random_uuid(),'event_id',p_event,'match_order',order_start+n,'round_id',rid,'round_number',rn,'court_number',n,'generation_mode',p_mode,'pair_result',CASE WHEN p_mode='mixed' THEN 'undecided' END,'result','undecided','created_at',now(),'updated_at',now());
  FOR i IN 0..3 LOOP
   x:=c->'pairs'->(i/2)->(i%2);
   SELECT value INTO person FROM jsonb_array_elements(s->'roster') WHERE value->>'key'=x->>'key' AND value->>'source'=x->>'source';
   IF person IS NULL THEN RAISE EXCEPTION '現在参加できない選手が含まれています'; END IF;
   key:=person->>'key'; IF key=ANY(keys) THEN RAISE EXCEPTION '同じラウンドに同一選手は重複出場できません'; END IF; keys:=array_append(keys,key);
   slot:=(ARRAY['team_a_player1','team_a_player2','team_b_player1','team_b_player2'])[i+1];
   j:=j||jsonb_build_object(slot||'_profile_id',person->'profile_id',slot||'_guest_id',person->'guest_id',slot||'_source_side',person->>'source',slot||'_guest_name',CASE WHEN person->>'guest_id' IS NOT NULL THEN person->>'name' END);
  END LOOP;
  INSERT INTO public.event_team_matches SELECT (jsonb_populate_record(NULL::public.event_team_matches,j)).*;
 END LOOP;
 PERFORM team_rounds_private.check_round(rid);
 UPDATE public.events SET court_count=p_courts WHERE id=p_event;
 RETURN jsonb_build_object('round_id',rid,'round_number',rn);
END $$;
CREATE FUNCTION public.update_friendly_team_round_card(p_event uuid,p_match uuid,p_expected jsonb,p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.event_team_matches; expected public.event_team_matches; proposed public.event_team_matches; patch jsonb; j jsonb; old_j jsonb; person jsonb; slot text; pid uuid; gid uuid; source text; guest_label text; s jsonb;
BEGIN
 -- プロフィール統合の参照テーブルロックと同じ順序。通常の別開催同士は直列化しない。
 LOCK TABLE public.club_members IN ROW EXCLUSIVE MODE;
 LOCK TABLE public.event_team_matches IN ROW EXCLUSIVE MODE;
 PERFORM team_rounds_private.lock_event(p_event);
 SELECT * INTO m FROM public.event_team_matches WHERE id=p_match AND event_id=p_event;
 IF NOT FOUND OR m.round_id IS NULL THEN RAISE EXCEPTION '自動編成カードが見つかりません'; END IF;
 IF p_expected IS NULL OR p_patch IS NULL OR jsonb_typeof(p_patch)<>'object'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k<>ALL(ARRAY['team_a_player1_profile_id','team_a_player1_guest_name','team_a_player1_guest_id','team_a_player1_source_side','team_a_player2_profile_id','team_a_player2_guest_name','team_a_player2_guest_id','team_a_player2_source_side','team_b_player1_profile_id','team_b_player1_guest_name','team_b_player1_guest_id','team_b_player1_source_side','team_b_player2_profile_id','team_b_player2_guest_name','team_b_player2_guest_id','team_b_player2_source_side','team_a_score','team_b_score','result','score_detail','memo','youtube_url','updated_at'])) THEN RAISE EXCEPTION '変更項目が不正です'; END IF;
 expected:=jsonb_populate_record(NULL::public.event_team_matches,p_expected);
 patch:=p_patch-'updated_at';
 IF expected.generation_mode='mixed' THEN
  patch:=(patch-ARRAY['team_a_score','team_b_score','result'])||jsonb_build_object('pair_1_score',CASE WHEN patch?'team_a_score' THEN patch->'team_a_score' ELSE to_jsonb(expected.pair_1_score) END,'pair_2_score',CASE WHEN patch?'team_b_score' THEN patch->'team_b_score' ELSE to_jsonb(expected.pair_2_score) END,'pair_result',CASE WHEN patch?'result' THEN patch->'result' ELSE to_jsonb(expected.pair_result) END);
 END IF;
 proposed:=jsonb_populate_record(expected,patch);
 j:=to_jsonb(proposed); old_j:=to_jsonb(expected);
 -- スコア・動画だけの更新は、過去の在籍・出欠を再解釈しない。
 IF (j-ARRAY['team_a_score','team_b_score','result','score_detail','memo','youtube_url','updated_at','pair_1_score','pair_2_score','pair_result']) IS DISTINCT FROM (old_j-ARRAY['team_a_score','team_b_score','result','score_detail','memo','youtube_url','updated_at','pair_1_score','pair_2_score','pair_result']) THEN
  PERFORM 1 FROM public.event_team_sides s JOIN public.club_members cm ON cm.club_id=s.club_id JOIN public.player_profiles pp ON pp.id=coalesce(cm.player_profile_id,cm.profile_id) WHERE s.event_id=p_event ORDER BY cm.id FOR SHARE OF cm,pp;
  PERFORM 1 FROM public.event_team_guests WHERE event_id=p_event ORDER BY id FOR SHARE;
  FOREACH slot IN ARRAY ARRAY['team_a_player1','team_a_player2','team_b_player1','team_b_player2'] LOOP
   source:=j->>(slot||'_source_side'); pid:=(j->>(slot||'_profile_id'))::uuid; gid:=(j->>(slot||'_guest_id'))::uuid; guest_label:=j->>(slot||'_guest_name');
   IF source IS DISTINCT FROM old_j->>(slot||'_source_side') THEN RAISE EXCEPTION '選手枠の元所属は変更できません'; END IF;
   IF pid IS NOT NULL AND (gid IS NOT NULL OR nullif(btrim(guest_label),'') IS NOT NULL) THEN RAISE EXCEPTION '選手の指定が重複しています'; END IF;
   IF pid IS NULL AND gid IS NULL AND nullif(btrim(guest_label),'') IS NOT NULL THEN
    SELECT id INTO gid FROM public.event_team_guests WHERE event_id=p_event AND side=source AND public.event_team_guests.guest_name=btrim(guest_label);
    IF gid IS NULL THEN
     IF to_jsonb(m) IS DISTINCT FROM old_j THEN RAISE EXCEPTION '他の端末で変更されています。入力を控えて再読み込みしてください' USING ERRCODE='40001'; END IF;
     INSERT INTO public.event_team_guests(event_id,side,guest_name) VALUES(p_event,source,btrim(guest_label)) RETURNING id INTO gid;
    END IF;
    j:=j||jsonb_build_object(slot||'_guest_id',gid);
   END IF;
  END LOOP;
  s:=team_rounds_private.snapshot(p_event);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'roster') GROUP BY value->>'source',value->>'key' HAVING count(*)>1) THEN RAISE EXCEPTION '所属データが重複しています。グループ管理者へ確認してください'; END IF;
  proposed:=jsonb_populate_record(NULL::public.event_team_matches,j);
  FOR slot,source,pid,gid,guest_label IN SELECT (ARRAY['team_a_player1','team_a_player2','team_b_player1','team_b_player2'])[slot_index+1],p.source,p.profile_id,p.guest_id,p.guest_name FROM team_rounds_private.players(proposed) p LOOP
   SELECT value INTO person FROM jsonb_array_elements(s->'roster') WHERE value->>'source'=source AND
   ((pid IS NOT NULL AND value->>'profile_id'=pid::text) OR (gid IS NOT NULL AND value->>'guest_id'=gid::text));
   IF person IS NULL THEN RAISE EXCEPTION '現在参加できない選手が含まれています'; END IF;
   j:=j||jsonb_build_object(slot||'_guest_name',CASE WHEN gid IS NOT NULL THEN person->>'name' END);
  END LOOP;
 END IF;
 IF to_jsonb(m) IS DISTINCT FROM old_j THEN
  IF (to_jsonb(m)-'updated_at') IS NOT DISTINCT FROM (j-'updated_at') THEN RETURN to_jsonb(m); END IF;
  RAISE EXCEPTION '他の端末で変更されています。入力を控えて再読み込みしてください' USING ERRCODE='40001';
 END IF;
 proposed:=jsonb_populate_record(NULL::public.event_team_matches,j);
 UPDATE public.event_team_matches SET
 team_a_player1_profile_id=proposed.team_a_player1_profile_id,
 team_a_player1_guest_name=proposed.team_a_player1_guest_name,
 team_a_player1_guest_id=proposed.team_a_player1_guest_id,
 team_a_player1_source_side=proposed.team_a_player1_source_side,
 team_a_player2_profile_id=proposed.team_a_player2_profile_id,
 team_a_player2_guest_name=proposed.team_a_player2_guest_name,
 team_a_player2_guest_id=proposed.team_a_player2_guest_id,
 team_a_player2_source_side=proposed.team_a_player2_source_side,
 team_b_player1_profile_id=proposed.team_b_player1_profile_id,
 team_b_player1_guest_name=proposed.team_b_player1_guest_name,
 team_b_player1_guest_id=proposed.team_b_player1_guest_id,
 team_b_player1_source_side=proposed.team_b_player1_source_side,
 team_b_player2_profile_id=proposed.team_b_player2_profile_id,
 team_b_player2_guest_name=proposed.team_b_player2_guest_name,
 team_b_player2_guest_id=proposed.team_b_player2_guest_id,
 team_b_player2_source_side=proposed.team_b_player2_source_side,
 pair_1_score=proposed.pair_1_score,
 pair_2_score=proposed.pair_2_score,
 pair_result=proposed.pair_result,
 team_a_score=proposed.team_a_score,
 team_b_score=proposed.team_b_score,
 result=proposed.result,
 score_detail=proposed.score_detail,
 memo=proposed.memo,
 youtube_url=proposed.youtube_url,updated_at=clock_timestamp() WHERE id=p_match RETURNING * INTO m;
 PERFORM team_rounds_private.check_round(m.round_id);
 RETURN to_jsonb(m);
END $$;
CREATE FUNCTION public.delete_friendly_team_round_card(p_event uuid,p_match uuid,p_expected jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.event_team_matches; expected public.event_team_matches;
BEGIN
 -- プロフィール統合の参照テーブルロックと同じ順序。通常の別開催同士は直列化しない。
 LOCK TABLE public.club_members IN ROW EXCLUSIVE MODE;
 LOCK TABLE public.event_team_matches IN ROW EXCLUSIVE MODE;
 PERFORM team_rounds_private.lock_event(p_event);
 SELECT * INTO m FROM public.event_team_matches WHERE id=p_match AND event_id=p_event;
 IF NOT FOUND THEN RETURN; END IF;
 expected:=jsonb_populate_record(NULL::public.event_team_matches,p_expected);
 IF m.round_id IS NULL OR to_jsonb(m) IS DISTINCT FROM to_jsonb(expected) THEN RAISE EXCEPTION '他の端末で変更されています。再読み込みしてください' USING ERRCODE='40001'; END IF;
 DELETE FROM public.event_team_matches WHERE id=p_match;
END $$;
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
 IF p_status='absent' AND EXISTS(SELECT 1 FROM public.event_team_matches m CROSS JOIN LATERAL team_rounds_private.players(m) p
 WHERE m.event_id=p_event AND (CASE WHEN m.generation_mode='mixed' THEN m.pair_result='undecided' OR m.pair_1_score IS NULL OR m.pair_2_score IS NULL ELSE m.result='undecided' OR m.team_a_score IS NULL OR m.team_b_score IS NULL END)
 AND p.source=p_side AND ((player_id IS NOT NULL AND p.profile_id=player_id) OR (p_guest IS NOT NULL AND (p.guest_id=p_guest OR (p.guest_id IS NULL AND p.guest_name=g.guest_name)))))
 THEN RAISE EXCEPTION '未完了カードに登録されています。カードを確認してから欠席に変更してください'; END IF;
 SELECT id INTO row_id FROM public.event_team_attendance WHERE event_id=p_event AND side=p_side
 AND (member_id=p_member OR guest_id=p_guest);
 IF row_id IS NULL THEN
 INSERT INTO public.event_team_attendance(event_id,side,member_id,guest_id,status,updated_by)
 VALUES(p_event,p_side,p_member,p_guest,p_status,auth.uid());
 ELSE UPDATE public.event_team_attendance SET status=p_status,updated_at=now(),updated_by=auth.uid() WHERE id=row_id; END IF;
END $$;

-- 新RPC以外には新規の書込み権限を付与しない。既存RLS・GRANTは維持。
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA team_rounds_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_friendly_team_round_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_friendly_team_round_context(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_friendly_team_round(uuid,uuid,text,text,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_friendly_team_round(uuid,uuid,text,text,integer,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_friendly_team_round_card(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_friendly_team_round_card(uuid,uuid,jsonb,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_friendly_team_round_card(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_friendly_team_round_card(uuid,uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
