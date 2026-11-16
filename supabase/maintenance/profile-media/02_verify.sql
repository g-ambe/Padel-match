BEGIN READ ONLY;
DO $$
DECLARE n text; fn record;
BEGIN
 FOREACH n IN ARRAY ARRAY['player_profile_private','profile_media_operations','profile_media_objects','profile_media_attempts'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND c.relname=n AND c.relrowsecurity) THEN RAISE EXCEPTION '新テーブルのRLSが不足しています'; END IF;
  IF has_table_privilege('anon','public.'||n,'SELECT') OR has_table_privilege('authenticated','public.'||n,'INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION '新テーブルの権限が広すぎます'; END IF;
 END LOOP;
 FOR fn IN SELECT oid,proname,prosecdef,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('profile_media_ready','profile_media_attempt','save_my_instagram','prepare_profile_image','commit_profile_image','abort_profile_image','profile_media_gc_candidates','claim_profile_media_gc','finish_profile_media_gc') LOOP
  IF NOT fn.prosecdef OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[] OR has_function_privilege('anon',fn.oid,'EXECUTE') OR NOT has_function_privilege('authenticated',fn.oid,'EXECUTE') THEN RAISE EXCEPTION '新RPCの権限・検索パスが不正です'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('profile_media_ready','profile_media_attempt','save_my_instagram','prepare_profile_image','commit_profile_image','abort_profile_image','profile_media_gc_candidates','claim_profile_media_gc','finish_profile_media_gc'))<>9 THEN RAISE EXCEPTION 'RPCの数が一致しません'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.player_profiles'::regclass AND tgname IN ('profile_media_detach','profile_media_remove') AND tgenabled='O')<>2 THEN RAISE EXCEPTION '連携変更時の保護が不足しています'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profile_media_private.settings WHERE octet_length(commit_secret_sha256)=32) THEN RAISE EXCEPTION 'Workerとの秘密値の照合設定が未完了です'; END IF;
 IF EXISTS(SELECT 1 FROM public.player_profile_private p JOIN public.profile_media_objects o ON o.object_key=p.avatar_key WHERE o.profile_id IS DISTINCT FROM p.profile_id OR o.state<>'active') THEN RAISE EXCEPTION '画像参照が不整合です'; END IF;
 IF EXISTS(SELECT 1 FROM public.player_profile_private m JOIN public.player_profiles p ON p.id=m.profile_id WHERE m.owner_id IS DISTINCT FROM CASE WHEN p.is_active THEN p.linked_auth_user_id ELSE NULL END) THEN RAISE EXCEPTION '本人用情報の所有者が不整合です'; END IF;
END; $$;
SELECT jsonb_build_object('verified',true,'public_images',false,'instagram_public',false) AS profile_media_verification;
ROLLBACK;
