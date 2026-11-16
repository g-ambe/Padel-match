-- 本人専用プロフィール拡張。既存player_profilesの公開列・権限・集計は変更しない。
BEGIN;
CREATE SCHEMA profile_media_private;
REVOKE ALL ON SCHEMA profile_media_private FROM PUBLIC, anon, authenticated;
CREATE TABLE profile_media_private.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), commit_secret_sha256 bytea NOT NULL CHECK(octet_length(commit_secret_sha256)=32)
);
CREATE TABLE public.profile_media_objects (
  object_key text PRIMARY KEY, profile_id uuid REFERENCES public.player_profiles(id) ON DELETE SET NULL,
  request_id uuid NOT NULL UNIQUE, state text NOT NULL CHECK(state IN ('staged','active','garbage','deleting','deleted')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), collect_after timestamptz,
  claimed_at timestamptz, deleted_at timestamptz
);
CREATE TABLE public.player_profile_private (
  profile_id uuid PRIMARY KEY REFERENCES public.player_profiles(id) ON DELETE CASCADE,
  owner_id uuid, instagram_username text,
  instagram_version bigint NOT NULL DEFAULT 0, avatar_version bigint NOT NULL DEFAULT 0,
  avatar_key text UNIQUE REFERENCES public.profile_media_objects(object_key), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(owner_id IS NOT NULL OR (instagram_username IS NULL AND avatar_key IS NULL)),
  CHECK(instagram_username IS NULL OR (length(instagram_username) BETWEEN 1 AND 30 AND instagram_username ~ '^[A-Za-z0-9_](\.?[A-Za-z0-9_])*$'))
);
CREATE TABLE public.profile_media_operations (
  request_id uuid PRIMARY KEY, actor_id uuid NOT NULL, profile_id uuid REFERENCES public.player_profiles(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK(kind IN ('upload','delete')), status text NOT NULL CHECK(status IN ('pending','committed','aborted')),
  object_key text UNIQUE, old_key text, expected_version bigint NOT NULL, content_sha256 text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes', committed_at timestamptz
);
CREATE UNIQUE INDEX profile_media_one_pending ON public.profile_media_operations(profile_id) WHERE status='pending';
CREATE INDEX profile_media_quota ON public.profile_media_operations(actor_id,committed_at) WHERE status='committed';
CREATE INDEX profile_media_profile_quota ON public.profile_media_operations(profile_id,committed_at) WHERE status='committed';
CREATE INDEX profile_media_expiry ON public.profile_media_operations(expires_at) WHERE status='pending';
CREATE INDEX profile_media_staged ON public.profile_media_objects(request_id) WHERE state='staged';
CREATE INDEX profile_media_gc ON public.profile_media_objects(collect_after) WHERE state IN ('garbage','deleting');
CREATE TABLE public.profile_media_attempts (ticket uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), used boolean NOT NULL DEFAULT false);
CREATE INDEX profile_media_attempt_actor ON public.profile_media_attempts(actor_id,created_at);
ALTER TABLE public.player_profile_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_media_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_media_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_media_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.player_profile_private, public.profile_media_operations, public.profile_media_objects, public.profile_media_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.player_profile_private,public.profile_media_operations TO authenticated;
CREATE POLICY profile_private_owner_read ON public.player_profile_private FOR SELECT TO authenticated USING (
 owner_id=auth.uid() AND EXISTS(SELECT 1 FROM public.player_profiles p WHERE p.id=profile_id AND p.is_active AND p.linked_auth_user_id=auth.uid())
);
CREATE POLICY profile_media_operation_owner_read ON public.profile_media_operations FOR SELECT TO authenticated USING (
 actor_id=auth.uid() AND EXISTS(SELECT 1 FROM public.player_profiles p WHERE p.id=profile_id AND p.is_active AND p.linked_auth_user_id=auth.uid())
);
CREATE FUNCTION profile_media_private.owner(p_profile uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); linked uuid;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('profile-media:'||uid::text,0));
 SELECT linked_auth_user_id INTO linked FROM public.player_profiles WHERE id=p_profile AND is_active FOR UPDATE;
 IF NOT FOUND OR linked IS DISTINCT FROM uid THEN RAISE EXCEPTION '本人の有効なプロフィールだけ変更できます' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM public.player_profiles WHERE linked_auth_user_id=uid AND is_active)<>1 THEN RAISE EXCEPTION '正規プロフィールを一意に特定できません' USING ERRCODE='42501'; END IF;
 RETURN uid;
END; $$;
CREATE FUNCTION profile_media_private.proof(p_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_proof IS NULL OR length(p_proof)<>64 OR NOT EXISTS(SELECT 1 FROM profile_media_private.settings WHERE commit_secret_sha256=sha256(convert_to(p_proof,'UTF8'))) THEN
  RAISE EXCEPTION '画像APIの設定を確認してください' USING ERRCODE='42501';
 END IF;
END; $$;
CREATE FUNCTION public.profile_media_ready(p_proof text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_proof IS NOT NULL AND length(p_proof)=64 AND EXISTS(SELECT 1 FROM profile_media_private.settings WHERE commit_secret_sha256=sha256(convert_to(p_proof,'UTF8')));
$$;
CREATE FUNCTION public.profile_media_attempt() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); result uuid;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'ログインしてください' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('profile-media:'||uid::text,0));
 DELETE FROM public.profile_media_attempts WHERE actor_id=uid AND created_at<clock_timestamp()-interval '10 minutes';
 IF (SELECT count(*) FROM public.profile_media_attempts WHERE actor_id=uid)>=10 THEN RETURN NULL; END IF;
 INSERT INTO public.profile_media_attempts(actor_id) VALUES(uid) RETURNING ticket INTO result;
 RETURN result;
END; $$;
CREATE FUNCTION profile_media_private.consume(p_ticket uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.profile_media_attempts SET used=true WHERE ticket=p_ticket AND actor_id=auth.uid() AND NOT used AND created_at>clock_timestamp()-interval '10 minutes';
 IF NOT FOUND THEN RAISE EXCEPTION '操作回数の制限です。時間をおいてください' USING ERRCODE='PT429'; END IF;
END; $$;
CREATE FUNCTION profile_media_private.quota(p_profile uuid, p_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.profile_media_operations WHERE status='committed' AND committed_at>clock_timestamp()-interval '30 days' AND (actor_id=p_actor OR profile_id=p_profile)
 HAVING count(*) FILTER(WHERE actor_id=p_actor AND committed_at>clock_timestamp()-interval '24 hours')>=3
 OR count(*) FILTER(WHERE profile_id=p_profile AND committed_at>clock_timestamp()-interval '24 hours')>=3
 OR count(*) FILTER(WHERE actor_id=p_actor)>=10 OR count(*) FILTER(WHERE profile_id=p_profile)>=10) THEN
  RAISE EXCEPTION '画像変更の上限です（24時間3回・30日10回）' USING ERRCODE='PT429';
 END IF;
END; $$;
CREATE FUNCTION public.save_my_instagram(p_profile uuid,p_expected bigint,p_username text,p_ticket uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; m public.player_profile_private; name text:=nullif(regexp_replace(btrim(p_username),'^@',''),'');
BEGIN
 uid:=profile_media_private.owner(p_profile); PERFORM profile_media_private.consume(p_ticket);
 IF name IS NOT NULL AND (length(name)>30 OR name !~ '^[A-Za-z0-9_](\.?[A-Za-z0-9_])*$') THEN RAISE EXCEPTION 'Instagram IDの形式を確認してください' USING ERRCODE='22023'; END IF;
 INSERT INTO public.player_profile_private(profile_id,owner_id) VALUES(p_profile,uid) ON CONFLICT DO NOTHING;
 UPDATE public.player_profile_private SET instagram_username=name,instagram_version=instagram_version+1,updated_at=clock_timestamp() WHERE profile_id=p_profile AND owner_id=uid AND instagram_version=p_expected RETURNING * INTO m;
 IF NOT FOUND THEN RAISE EXCEPTION '別の画面で変更されています。再読み込みしてください' USING ERRCODE='40001'; END IF;
 RETURN to_jsonb(m);
END; $$;
CREATE FUNCTION public.prepare_profile_image(p_profile uuid,p_request uuid,p_expected bigint,p_kind text,p_ticket uuid,p_content_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; m public.player_profile_private; op public.profile_media_operations; key text;
BEGIN
 uid:=profile_media_private.owner(p_profile); PERFORM profile_media_private.consume(p_ticket);
 IF p_request IS NULL OR p_expected IS NULL OR p_expected<0 OR coalesce(p_kind,'') NOT IN ('upload','delete') OR (p_kind='upload' AND (p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$')) THEN RAISE EXCEPTION '入力内容を確認してください' USING ERRCODE='22023'; END IF;
 INSERT INTO public.player_profile_private(profile_id,owner_id) VALUES(p_profile,uid) ON CONFLICT DO NOTHING;
 SELECT * INTO m FROM public.player_profile_private WHERE profile_id=p_profile AND owner_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'プロフィールの所有者が変わっています' USING ERRCODE='42501'; END IF;
 SELECT * INTO op FROM public.profile_media_operations WHERE request_id=p_request;
 IF FOUND THEN
  IF op.actor_id<>uid OR op.profile_id<>p_profile OR op.kind<>p_kind OR op.expected_version<>p_expected OR op.content_sha256 IS DISTINCT FROM p_content_hash THEN RAISE EXCEPTION '操作IDが一致しません' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('operation',to_jsonb(op),'profile',to_jsonb(m));
 END IF;
 IF m.avatar_version<>p_expected THEN RAISE EXCEPTION '画像が別の画面で変更されています' USING ERRCODE='40001'; END IF;
 UPDATE public.profile_media_operations SET status='aborted' WHERE profile_id=p_profile AND status='pending' AND expires_at<=clock_timestamp();
 UPDATE public.profile_media_objects o SET state='garbage',collect_after=clock_timestamp()+interval '24 hours' WHERE o.profile_id=p_profile AND o.state='staged' AND EXISTS(SELECT 1 FROM public.profile_media_operations q WHERE q.request_id=o.request_id AND q.status='aborted');
 IF EXISTS(SELECT 1 FROM public.profile_media_operations WHERE profile_id=p_profile AND status='pending') THEN RAISE EXCEPTION 'このプロフィールの画像を変更中です' USING ERRCODE='40001'; END IF;
 IF p_kind='delete' AND m.avatar_key IS NULL THEN RETURN jsonb_build_object('operation',jsonb_build_object('status','unchanged'),'profile',to_jsonb(m)); END IF;
 PERFORM profile_media_private.quota(p_profile,uid);
 key:=CASE WHEN p_kind='upload' THEN 'profiles/'||p_profile::text||'/'||p_request::text||'.webp' ELSE NULL END;
 INSERT INTO public.profile_media_operations(request_id,actor_id,profile_id,kind,status,object_key,old_key,expected_version,content_sha256) VALUES(p_request,uid,p_profile,p_kind,'pending',key,m.avatar_key,p_expected,p_content_hash) RETURNING * INTO op;
 IF key IS NOT NULL THEN INSERT INTO public.profile_media_objects(object_key,profile_id,request_id,state) VALUES(key,p_profile,p_request,'staged'); END IF;
 RETURN jsonb_build_object('operation',to_jsonb(op),'profile',to_jsonb(m));
END; $$;
CREATE FUNCTION public.commit_profile_image(p_profile uuid,p_request uuid,p_proof text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; m public.player_profile_private; op public.profile_media_operations;
BEGIN
 PERFORM profile_media_private.proof(p_proof); uid:=profile_media_private.owner(p_profile);
 SELECT * INTO m FROM public.player_profile_private WHERE profile_id=p_profile AND owner_id=uid FOR UPDATE;
 SELECT * INTO op FROM public.profile_media_operations WHERE request_id=p_request AND profile_id=p_profile AND actor_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '画像の操作を確認できません' USING ERRCODE='42501'; END IF;
 IF op.status='committed' THEN RETURN to_jsonb(m); END IF;
 IF op.status<>'pending' OR op.expires_at<=clock_timestamp() OR m.avatar_version<>op.expected_version OR m.avatar_key IS DISTINCT FROM op.old_key THEN RAISE EXCEPTION '画像が変更されています。状態を再確認してください' USING ERRCODE='40001'; END IF;
 PERFORM profile_media_private.quota(p_profile,uid);
 IF op.kind='upload' THEN
  UPDATE public.profile_media_objects SET state='active' WHERE object_key=op.object_key AND profile_id=p_profile AND request_id=p_request AND state='staged';
  IF NOT FOUND THEN RAISE EXCEPTION '保存先を確認できません' USING ERRCODE='40001'; END IF;
 END IF;
 UPDATE public.player_profile_private SET avatar_key=op.object_key,avatar_version=avatar_version+1,updated_at=clock_timestamp() WHERE profile_id=p_profile RETURNING * INTO m;
 UPDATE public.profile_media_operations SET status='committed',committed_at=clock_timestamp() WHERE request_id=p_request;
 UPDATE public.profile_media_objects SET state='garbage',collect_after=clock_timestamp() WHERE object_key=op.old_key;
 RETURN to_jsonb(m);
END; $$;
CREATE FUNCTION public.abort_profile_image(p_profile uuid,p_request uuid,p_proof text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM profile_media_private.proof(p_proof); PERFORM profile_media_private.owner(p_profile);
 UPDATE public.profile_media_operations SET status='aborted' WHERE request_id=p_request AND profile_id=p_profile AND actor_id=auth.uid() AND status='pending';
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.profile_media_objects SET state='garbage',collect_after=clock_timestamp()+interval '24 hours' WHERE request_id=p_request AND state='staged';
 RETURN true;
END; $$;
CREATE FUNCTION public.profile_media_gc_candidates(p_proof text) RETURNS SETOF text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM profile_media_private.proof(p_proof);
 UPDATE public.profile_media_operations SET status='aborted' WHERE request_id IN(SELECT request_id FROM public.profile_media_operations WHERE status='pending' AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 20 FOR UPDATE SKIP LOCKED);
 UPDATE public.profile_media_objects o SET state='garbage',collect_after=greatest(o.created_at+interval '24 hours',clock_timestamp()) WHERE o.object_key IN(SELECT b.object_key FROM public.profile_media_objects b WHERE b.state='staged' AND EXISTS(SELECT 1 FROM public.profile_media_operations q WHERE q.request_id=b.request_id AND q.status='aborted') ORDER BY b.created_at LIMIT 20 FOR UPDATE SKIP LOCKED);
 RETURN QUERY SELECT object_key FROM public.profile_media_objects WHERE (state='garbage' AND collect_after<=clock_timestamp()) OR (state='deleting' AND claimed_at<clock_timestamp()-interval '5 minutes') ORDER BY collect_after NULLS LAST LIMIT 20;
END; $$;
CREATE FUNCTION public.claim_profile_media_gc(p_key text,p_proof text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM profile_media_private.proof(p_proof);
 UPDATE public.profile_media_objects o SET state='deleting',claimed_at=clock_timestamp() WHERE object_key=p_key
 AND ((state='garbage' AND collect_after<=clock_timestamp()) OR (state='deleting' AND claimed_at<clock_timestamp()-interval '5 minutes'))
 AND NOT EXISTS(SELECT 1 FROM public.player_profile_private m WHERE m.avatar_key=p_key)
 AND NOT EXISTS(SELECT 1 FROM public.profile_media_operations q WHERE q.object_key=p_key AND q.status='pending');
 RETURN FOUND;
END; $$;
CREATE FUNCTION public.finish_profile_media_gc(p_key text,p_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM profile_media_private.proof(p_proof);
 UPDATE public.profile_media_objects SET state='deleted',deleted_at=clock_timestamp() WHERE object_key=p_key AND state='deleting' AND NOT EXISTS(SELECT 1 FROM public.player_profile_private WHERE avatar_key=p_key);
END; $$;
-- 連携解除・統合・所有者変更で、以前の本人専用データを新しい所有者へ引き渡さない。
CREATE FUNCTION profile_media_private.detach() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.linked_auth_user_id IS DISTINCT FROM NEW.linked_auth_user_id OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
  UPDATE public.profile_media_objects SET state='garbage',collect_after=clock_timestamp()+interval '24 hours' WHERE object_key IN(SELECT avatar_key FROM public.player_profile_private WHERE profile_id=NEW.id);
  UPDATE public.player_profile_private SET owner_id=CASE WHEN NEW.is_active THEN NEW.linked_auth_user_id ELSE NULL END,instagram_username=NULL,instagram_version=instagram_version+1,avatar_key=NULL,avatar_version=avatar_version+1,updated_at=clock_timestamp() WHERE profile_id=NEW.id;
  UPDATE public.profile_media_operations SET status='aborted' WHERE profile_id=NEW.id AND status='pending';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER profile_media_detach AFTER UPDATE OF linked_auth_user_id,is_active ON public.player_profiles FOR EACH ROW EXECUTE FUNCTION profile_media_private.detach();
CREATE FUNCTION profile_media_private.remove_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.player_profile_private SET avatar_key=NULL WHERE profile_id=OLD.id;
 UPDATE public.profile_media_operations SET status='aborted' WHERE profile_id=OLD.id AND status='pending';
 UPDATE public.profile_media_objects o SET state='garbage',collect_after=clock_timestamp()+interval '24 hours' WHERE profile_id=OLD.id AND state IN ('staged','active') AND NOT EXISTS(SELECT 1 FROM public.player_profile_private p WHERE p.avatar_key=o.object_key);
 RETURN OLD;
END; $$;
CREATE TRIGGER profile_media_remove BEFORE DELETE ON public.player_profiles FOR EACH ROW EXECUTE FUNCTION profile_media_private.remove_profile();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA profile_media_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.profile_media_ready(text),public.profile_media_attempt(),public.save_my_instagram(uuid,bigint,text,uuid),public.prepare_profile_image(uuid,uuid,bigint,text,uuid,text),public.commit_profile_image(uuid,uuid,text),public.abort_profile_image(uuid,uuid,text),public.profile_media_gc_candidates(text),public.claim_profile_media_gc(text,text),public.finish_profile_media_gc(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.profile_media_ready(text),public.profile_media_attempt(),public.save_my_instagram(uuid,bigint,text,uuid),public.prepare_profile_image(uuid,uuid,bigint,text,uuid,text),public.commit_profile_image(uuid,uuid,text),public.abort_profile_image(uuid,uuid,text),public.profile_media_gc_candidates(text),public.claim_profile_media_gc(text,text),public.finish_profile_media_gc(text,text) TO authenticated;
COMMIT;
