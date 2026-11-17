BEGIN;
-- 施設IDを保った共通マスター。施設の追加/補正データは別の確認済みMigrationに分離する。
ALTER TABLE public.padel_facilities
 ADD COLUMN facility_key text UNIQUE,
 ADD COLUMN aliases text[] NOT NULL DEFAULT '{}',
 ADD COLUMN availability text NOT NULL DEFAULT 'unverified' CHECK(availability IN('open','seasonal','limited','guests_only','closed','unverified')),
 ADD COLUMN usage_note text,
 ADD COLUMN verified_on date;
ALTER TABLE public.player_profile_private
 ADD COLUMN home_facility_id uuid,
 ADD CONSTRAINT profile_home_facility_fkey FOREIGN KEY(home_facility_id) REFERENCES public.padel_facilities(id) ON DELETE RESTRICT;

-- 旧0050クライアントの自由入力保存は施設選択を明示的に解除する。既存CAS/本人/試行制限は同じ。
CREATE OR REPLACE FUNCTION public.save_my_home_court(p_profile uuid,p_expected bigint,p_name text,p_ticket uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; m public.player_profile_private; court text:=nullif(btrim(p_name),'');
BEGIN
 uid:=profile_media_private.owner(p_profile);
 PERFORM profile_media_private.consume(p_ticket);
 IF p_expected IS NULL OR p_expected<0 OR (court IS NOT NULL AND (char_length(court)>80 OR court ~ '[[:cntrl:]]')) THEN
  RAISE EXCEPTION 'ホームコートは80文字以内のコート名を入力してください' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.player_profile_private(profile_id,owner_id) VALUES(p_profile,uid) ON CONFLICT(profile_id) DO NOTHING;
 UPDATE public.player_profile_private SET home_facility_id=NULL,home_court_name=court,home_court_version=home_court_version+1,updated_at=clock_timestamp()
 WHERE profile_id=p_profile AND owner_id=uid AND home_court_version=p_expected RETURNING * INTO m;
 IF NOT FOUND THEN RAISE EXCEPTION 'ホームコートが別の画面で変更されています。再読み込みしてください' USING ERRCODE='40001';END IF;
 RETURN to_jsonb(m);
END; $$;

CREATE OR REPLACE FUNCTION profile_media_private.reset_home_court() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN NEW.home_facility_id:=NULL;NEW.home_court_name:=NULL;NEW.home_court_version:=OLD.home_court_version+1;END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION public.save_my_home_court_selection(p_profile uuid,p_expected bigint,p_facility uuid,p_name text,p_ticket uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; m public.player_profile_private; court text:=nullif(btrim(p_name),''); selected public.padel_facilities;
BEGIN
 uid:=profile_media_private.owner(p_profile);PERFORM profile_media_private.consume(p_ticket);
 IF p_expected IS NULL OR p_expected<0 THEN RAISE EXCEPTION '変更情報を確認してください' USING ERRCODE='22023';END IF;
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
END; $$;
REVOKE ALL ON FUNCTION public.save_my_home_court_selection(uuid,bigint,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_home_court_selection(uuid,bigint,uuid,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
