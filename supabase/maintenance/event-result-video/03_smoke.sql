-- 専用の一時開催だけを使用。成功しても全テスト書込みを内部例外で取り消す。
-- READ COMMITTED: 0045のロック規約に合わせる。実データは出力しない。
DO $smoke$
DECLARE actor uuid; club uuid; eid uuid:=gen_random_uuid(); mid uuid; ctx jsonb;
 aa jsonb; bb jsonb; prior jsonb; final_rows jsonb; r jsonb; member_actor uuid;
BEGIN
 BEGIN
  SELECT coalesce(pp.linked_auth_user_id,cm.profile_id),cm.club_id INTO actor,club
  FROM public.club_members cm LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
  JOIN public.clubs c ON c.id=cm.club_id
  WHERE cm.is_active AND (pp.id IS NULL OR pp.is_active) AND NOT c.is_deleted
   AND cm.role IN ('main_admin','sub_admin') AND coalesce(pp.linked_auth_user_id,cm.profile_id) IS NOT NULL
  ORDER BY cm.id LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION '0047_no_dedicated_test_actor'; END IF;
  INSERT INTO public.events(id,name,court_count,event_mode,stats_mode,created_by_auth_user_id)
   VALUES(eid,'PR202動画RPC専用検証',1,'team','record_only',actor);
  INSERT INTO public.event_team_sides(event_id,side,club_id,team_name)
   VALUES(eid,'team_a',club,'検証A'),(eid,'team_b',club,'検証B');
  INSERT INTO public.event_team_guests(event_id,side,guest_name)
   SELECT eid,s,'検証ゲスト'||n FROM unnest(ARRAY['team_a','team_b']) s CROSS JOIN generate_series(1,2) n;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ctx:=public.get_friendly_team_round_context(eid);
  SELECT jsonb_agg(p ORDER BY p->>'guest_id') INTO aa FROM jsonb_array_elements(ctx->'roster') p WHERE p->>'source'='team_a' AND p->>'guest_id' IS NOT NULL;
  SELECT jsonb_agg(p ORDER BY p->>'guest_id') INTO bb FROM jsonb_array_elements(ctx->'roster') p WHERE p->>'source'='team_b' AND p->>'guest_id' IS NOT NULL;
  PERFORM public.create_friendly_team_round(eid,gen_random_uuid(),ctx->>'revision','confrontation',1,
   jsonb_build_array(jsonb_build_object('court',1,'pairs',jsonb_build_array(aa,bb))));
  EXECUTE 'RESET ROLE';
  INSERT INTO public.event_team_matches(event_id,match_order,team_a_player1_guest_name,team_a_player2_guest_name,team_b_player1_guest_name,team_b_player2_guest_name,result)
   VALUES(eid,2,'手動A1','手動A2','手動B1','手動B2','undecided');
  -- 開催中の保存も確認してから終了する。スコア・編成は一度も更新しない。
  SELECT id INTO mid FROM public.event_team_matches WHERE event_id=eid AND round_id IS NOT NULL;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.save_friendly_team_match_video(eid,mid,'https://youtu.be/active',NULL);
  PERFORM public.save_friendly_team_match_video(eid,mid,NULL,'https://youtu.be/active');
  EXECUTE 'RESET ROLE';
  UPDATE public.events SET status='closed',share_enabled=true,share_token='pr202-'||eid::text WHERE id=eid;
  SELECT jsonb_agg(to_jsonb(m)-ARRAY['youtube_url','updated_at'] ORDER BY id) INTO prior FROM public.event_team_matches m WHERE event_id=eid;
  FOR mid IN SELECT id FROM public.event_team_matches WHERE event_id=eid ORDER BY id LOOP
   PERFORM set_config('request.jwt.claim.sub',actor::text,true);
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
   EXECUTE 'SET LOCAL ROLE authenticated';
   r:=public.save_friendly_team_match_video(eid,mid,'https://youtu.be/first',NULL);
   IF r IS DISTINCT FROM public.save_friendly_team_match_video(eid,mid,'https://youtu.be/first',NULL) THEN RAISE EXCEPTION '0047_retry_differs'; END IF;
   BEGIN
    PERFORM public.save_friendly_team_match_video(eid,mid,'https://youtu.be/stale',NULL);
    RAISE SQLSTATE 'PZ048';
   EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
   BEGIN
    PERFORM public.save_friendly_team_match_video(eid,mid,'javascript:invalid','https://youtu.be/first');
    RAISE SQLSTATE 'PZ048';
   EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
   PERFORM public.save_friendly_team_match_video(eid,mid,'https://youtube.com/shorts/second','https://youtu.be/first');
   PERFORM public.save_friendly_team_match_video(eid,mid,NULL,'https://youtube.com/shorts/second');
   EXECUTE 'RESET ROLE';
  END LOOP;
  -- 任意の未所属アカウントと、実在する一般所属者（存在する場合）の拒否。
  SELECT coalesce(pp.linked_auth_user_id,cm.profile_id) INTO member_actor
   FROM public.club_members cm LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
   WHERE cm.club_id=club AND cm.is_active AND cm.role='member'
    AND coalesce(pp.linked_auth_user_id,cm.profile_id)<>actor
    AND NOT EXISTS(SELECT 1 FROM public.app_admins a WHERE a.profile_id=coalesce(pp.linked_auth_user_id,cm.profile_id) AND a.is_active)
    AND NOT EXISTS(SELECT 1 FROM public.club_members admin LEFT JOIN public.player_profiles ap ON ap.id=admin.player_profile_id WHERE admin.club_id=club AND admin.is_active AND admin.role IN ('main_admin','sub_admin') AND coalesce(ap.linked_auth_user_id,admin.profile_id)=coalesce(pp.linked_auth_user_id,cm.profile_id))
   ORDER BY cm.id LIMIT 1;
  FOREACH actor IN ARRAY array_remove(ARRAY[gen_random_uuid(),member_actor],NULL) LOOP
   PERFORM set_config('request.jwt.claim.sub',actor::text,true);
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
   EXECUTE 'SET LOCAL ROLE authenticated';
   BEGIN
    PERFORM public.save_friendly_team_match_video(eid,mid,'https://youtu.be/forbidden',NULL);
    RAISE SQLSTATE 'PZ048';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   EXECUTE 'RESET ROLE';
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  PERFORM set_config('request.headers',jsonb_build_object('x-padel-share-token','pr202-'||eid::text)::text,true);
  EXECUTE 'SET LOCAL ROLE anon';
  IF (SELECT count(*) FROM public.event_team_matches WHERE event_id=eid)<>2 THEN RAISE EXCEPTION '0047_shared_read_failed'; END IF;
  BEGIN
   PERFORM public.save_friendly_team_match_video(eid,mid,'https://youtu.be/forbidden',NULL);
   RAISE SQLSTATE 'PZ048';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  SELECT jsonb_agg(to_jsonb(m)-ARRAY['youtube_url','updated_at'] ORDER BY id) INTO final_rows FROM public.event_team_matches m WHERE event_id=eid;
  IF final_rows IS DISTINCT FROM prior OR EXISTS(SELECT 1 FROM public.event_team_matches WHERE event_id=eid AND youtube_url IS NOT NULL) THEN RAISE EXCEPTION '0047_score_lineup_or_video_differs'; END IF;
  RAISE SQLSTATE 'PZ047';
 EXCEPTION WHEN SQLSTATE 'PZ047' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM public.events WHERE id=eid) THEN RAISE EXCEPTION '0047_test_data_not_rolled_back'; END IF;
END $smoke$;
