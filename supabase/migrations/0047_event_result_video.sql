-- 終了後の動画登録用。既存RLS・カード/スコア更新RPCは変更しない。
BEGIN;
CREATE FUNCTION public.save_friendly_team_match_video(
  p_event uuid, p_match uuid, p_url text, p_expected_url text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.events; m public.event_team_matches; next_url text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = '42501';
  END IF;
  -- 生成・終了・採点と同じくイベントからロックし、更新項目を動画だけに限定する。
  SELECT * INTO e FROM public.events WHERE id = p_event FOR UPDATE;
  IF NOT FOUND OR e.event_mode <> 'team' OR e.is_deleted
    OR e.status NOT IN ('active', 'closed')
    OR NOT coalesce(public.can_manage_friendly_team_event_by_sides(e.id, e.created_by_auth_user_id), false)
    OR NOT coalesce(public.can_view_friendly_team_event_by_sides(e.id, e.created_by_auth_user_id), false) THEN
    RAISE EXCEPTION '動画を変更する権限がありません' USING ERRCODE = '42501';
  END IF;
  next_url := nullif(btrim(p_url), '');
  IF next_url IS NOT NULL AND (length(next_url) > 2048 OR NOT (
    next_url ~ '^https://(www\.)?youtube\.com/watch\?v='
    OR next_url ~ '^https://youtu\.be/'
    OR next_url ~ '^https://(www\.)?youtube\.com/shorts/'
  )) THEN
    RAISE EXCEPTION 'YouTubeのURLを入力してください' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM public.event_team_matches
    WHERE id = p_match AND event_id = p_event FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '試合を確認できませんでした' USING ERRCODE = '42501';
  END IF;
  IF m.youtube_url IS NOT DISTINCT FROM next_url THEN
    RETURN jsonb_build_object('id', m.id, 'youtube_url', m.youtube_url);
  END IF;
  IF m.youtube_url IS DISTINCT FROM p_expected_url THEN
    RAISE EXCEPTION '他の端末で動画が変更されています。再読み込みしてください';
  END IF;
  UPDATE public.event_team_matches
    SET youtube_url = next_url, updated_at = clock_timestamp()
    WHERE id = m.id;
  RETURN jsonb_build_object('id', m.id, 'youtube_url', next_url);
END;
$$;
REVOKE ALL ON FUNCTION public.save_friendly_team_match_video(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_friendly_team_match_video(uuid, uuid, text, text) TO authenticated;
COMMIT;
