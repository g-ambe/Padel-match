BEGIN;
DO $$
DECLARE actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid(); req uuid;
 m jsonb; previous_key text; before_success bigint; before_objects bigint; denied boolean; proof text:=repeat('a',64); pose bigint;
BEGIN
 INSERT INTO public.player_profiles(id,display_name,linked_auth_user_id,is_active) VALUES(profile,'表示位置一時検証',actor,true);
 UPDATE profile_media_private.settings SET commit_secret_sha256=sha256(convert_to(proof,'UTF8'));
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 FOR n IN 0..2 LOOP
  req:=gen_random_uuid();PERFORM public.prepare_profile_image(profile,req,n,'upload',public.profile_media_attempt(),repeat('0',64));m:=public.commit_profile_image(profile,req,proof);
 END LOOP;
 previous_key:=m->>'avatar_key';pose:=(m->>'avatar_pose_version')::bigint;
 SET LOCAL ROLE postgres;
 SELECT count(*) INTO before_success FROM public.profile_media_operations WHERE actor_id=actor AND status='committed';
 SELECT count(*) INTO before_objects FROM public.profile_media_objects;
 SET LOCAL ROLE authenticated;
 denied:=false;BEGIN PERFORM public.prepare_profile_image(profile,gen_random_uuid(),3,'upload',public.profile_media_attempt(),repeat('0',64));EXCEPTION WHEN SQLSTATE 'PT429' THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION '0049_image_quota_lost'; END IF;
 m:=public.save_my_avatar_position(profile,3,pose,.6,.4,2,public.profile_media_attempt());
 IF m->>'avatar_key' IS DISTINCT FROM previous_key OR (m->>'avatar_version')::int<>3 OR (m->>'avatar_pose_version')::bigint<>pose+1 OR (m->>'avatar_zoom')::int<>2 THEN RAISE EXCEPTION '0049_pose_write_invalid'; END IF;
 denied:=false;BEGIN PERFORM public.save_my_avatar_position(profile,3,pose,.2,.3,3,public.profile_media_attempt());EXCEPTION WHEN serialization_failure THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION '0049_stale_position_allowed'; END IF;
 denied:=false;BEGIN PERFORM public.save_my_avatar_position(profile,2,pose+1,.2,.3,3,public.profile_media_attempt());EXCEPTION WHEN serialization_failure THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION '0049_stale_image_allowed'; END IF;
 denied:=false;BEGIN PERFORM public.save_my_avatar_position(profile,3,pose+1,'NaN'::float8,.3,3,public.profile_media_attempt());EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION '0049_NaN_allowed'; END IF;
 -- 画像確定の同じ操作IDでの再試行でも、確定後の位置はリセットしない。
 m:=public.commit_profile_image(profile,req,proof);IF (m->>'avatar_zoom')::int<>2 THEN RAISE EXCEPTION '0049_idempotent_retry_reset_pose'; END IF;
 PERFORM public.get_my_profile_group_usage();
 SET LOCAL ROLE postgres;
 IF (SELECT count(*) FROM public.profile_media_operations WHERE actor_id=actor AND status='committed')<>before_success OR (SELECT count(*) FROM public.profile_media_objects)<>before_objects THEN RAISE EXCEPTION '0049_pose_consumed_image_operations'; END IF;
 PERFORM set_config('request.jwt.claim.sub',other_actor::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',other_actor,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;denied:=false;
 BEGIN PERFORM public.save_my_avatar_position(profile,3,pose+1,.2,.3,3,public.profile_media_attempt());EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied OR EXISTS(SELECT 1 FROM public.player_profile_private WHERE profile_id=profile) THEN RAISE EXCEPTION '0049_other_owner_allowed'; END IF;
 SET LOCAL ROLE anon;denied:=false;BEGIN PERFORM public.get_my_profile_group_usage();EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION '0049_anonymous_usage_allowed'; END IF;
 SET LOCAL ROLE postgres;
 UPDATE public.player_profiles SET linked_auth_user_id=other_actor WHERE id=profile;
 IF EXISTS(SELECT 1 FROM public.player_profile_private WHERE profile_id=profile AND (avatar_key IS NOT NULL OR avatar_focus_x<>.5 OR avatar_focus_y<>.5 OR avatar_zoom<>1)) THEN RAISE EXCEPTION '0049_detach_not_reset'; END IF;
END; $$;
ROLLBACK;
