-- ChatGPT candidate ONLY; not approved for production.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Unexpected migration role'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.save_my_home_court(uuid, bigint, text, uuid)')) IS DISTINCT FROM '616651b00b92b2ec52f0d2f12907c656' THEN RAISE EXCEPTION 'Baseline changed: public.save_my_home_court'; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.save_my_home_court_selection(uuid, bigint, uuid, text, uuid)')) IS DISTINCT FROM 'a2ba8834ad9d738b40c8c01cacf03a5a' THEN RAISE EXCEPTION 'Baseline changed: public.save_my_home_court_selection'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.save_my_home_court(p_profile uuid, p_expected bigint, p_name text, p_ticket uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE uid uuid; m public.player_profile_private; court text:=nullif(btrim(p_name),'');
BEGIN
 uid:=profile_media_private.owner(p_profile);
 PERFORM profile_media_private.consume(p_ticket);
 IF court IS NOT NULL THEN
  RAISE EXCEPTION 'ホームコートは施設一覧から選択してください。画面を再読み込みしてください' USING ERRCODE='22023';
 END IF;
 IF p_expected IS NULL OR p_expected<0 THEN
  RAISE EXCEPTION '変更情報を確認してください' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.player_profile_private(profile_id,owner_id) VALUES(p_profile,uid) ON CONFLICT(profile_id) DO NOTHING;
 UPDATE public.player_profile_private SET home_facility_id=NULL,home_court_name=court,home_court_version=home_court_version+1,updated_at=clock_timestamp()
 WHERE profile_id=p_profile AND owner_id=uid AND home_court_version=p_expected RETURNING * INTO m;
 IF NOT FOUND THEN RAISE EXCEPTION 'ホームコートが別の画面で変更されています。再読み込みしてください' USING ERRCODE='40001';END IF;
 RETURN to_jsonb(m);
END; $function$;

CREATE OR REPLACE FUNCTION public.save_my_home_court_selection(p_profile uuid, p_expected bigint, p_facility uuid, p_name text, p_ticket uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE uid uuid; m public.player_profile_private; court text:=nullif(btrim(p_name),''); selected public.padel_facilities;
BEGIN
 uid:=profile_media_private.owner(p_profile);PERFORM profile_media_private.consume(p_ticket);
 IF p_expected IS NULL OR p_expected<0 THEN RAISE EXCEPTION '変更情報を確認してください' USING ERRCODE='22023';END IF;
 IF p_facility IS NULL AND court IS NOT NULL THEN
  RAISE EXCEPTION 'ホームコートは施設一覧から選択してください。画面を再読み込みしてください' USING ERRCODE='22023';
 END IF;
 IF p_facility IS NOT NULL THEN
  SELECT * INTO selected FROM public.padel_facilities WHERE id=p_facility FOR SHARE;
  IF NOT FOUND OR selected.availability='closed' THEN RAISE EXCEPTION 'この施設は現在選択できません' USING ERRCODE='22023';END IF;
  court:=selected.name;
 END IF;
 IF court IS NOT NULL AND (char_length(court)>80 OR court ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'ホームコートは80文字以内のコート名を入力してください' USING ERRCODE='22023';END IF;
 INSERT INTO public.player_profile_private(profile_id,owner_id) VALUES(p_profile,uid) ON CONFLICT(profile_id) DO NOTHING;
 UPDATE public.player_profile_private SET home_facility_id=p_facility,home_court_name=court,home_court_version=home_court_version+1,updated_at=clock_timestamp()
 WHERE profile_id=p_profile AND owner_id=uid AND home_court_version=p_expected RETURNING * INTO m;
 IF NOT FOUND THEN RAISE EXCEPTION 'ホームコートが別の画面で変更されています。再読み込みしてください' USING ERRCODE='40001';END IF;
 RETURN to_jsonb(m)||jsonb_build_object('home_facility',CASE WHEN p_facility IS NOT NULL THEN jsonb_build_object('id',selected.id,'name',selected.name,'prefecture',selected.prefecture,'availability',selected.availability,'usage_note',selected.usage_note,'aliases',selected.aliases) ELSE NULL END);
END; $function$;
NOTIFY pgrst,'reload schema';
COMMIT;
