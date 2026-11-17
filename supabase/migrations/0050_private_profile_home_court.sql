BEGIN;
ALTER TABLE public.player_profile_private
 ADD COLUMN home_court_name text,
 ADD COLUMN home_court_version bigint NOT NULL DEFAULT 0,
 ADD CONSTRAINT profile_home_court_name_bounds CHECK(home_court_name IS NULL OR (char_length(home_court_name)>=1 AND char_length(home_court_name)<=80 AND home_court_name !~ '[[:cntrl:]]')),
 ADD CONSTRAINT profile_home_court_version_bounds CHECK(home_court_version>=0);

CREATE FUNCTION profile_media_private.reset_home_court() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN NEW.home_court_name:=NULL;NEW.home_court_version:=OLD.home_court_version+1;END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION profile_media_private.reset_home_court() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER profile_home_court_reset BEFORE UPDATE OF owner_id ON public.player_profile_private
 FOR EACH ROW EXECUTE FUNCTION profile_media_private.reset_home_court();

CREATE FUNCTION public.save_my_home_court(p_profile uuid,p_expected bigint,p_name text,p_ticket uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; m public.player_profile_private; court text:=nullif(btrim(p_name),'');
BEGIN
 uid:=profile_media_private.owner(p_profile);
 PERFORM profile_media_private.consume(p_ticket);
 IF p_expected IS NULL OR p_expected<0 OR (court IS NOT NULL AND (char_length(court)>80 OR court ~ '[[:cntrl:]]')) THEN
  RAISE EXCEPTION 'ホームコートは80文字以内のコート名を入力してください' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.player_profile_private(profile_id,owner_id) VALUES(p_profile,uid) ON CONFLICT(profile_id) DO NOTHING;
 UPDATE public.player_profile_private SET home_court_name=court,home_court_version=home_court_version+1,updated_at=clock_timestamp()
 WHERE profile_id=p_profile AND owner_id=uid AND home_court_version=p_expected RETURNING * INTO m;
 IF NOT FOUND THEN RAISE EXCEPTION 'ホームコートが別の画面で変更されています。再読み込みしてください' USING ERRCODE='40001';END IF;
 RETURN to_jsonb(m);
END; $$;
REVOKE ALL ON FUNCTION public.save_my_home_court(uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_my_home_court(uuid,bigint,text,uuid) TO authenticated;
COMMIT;
