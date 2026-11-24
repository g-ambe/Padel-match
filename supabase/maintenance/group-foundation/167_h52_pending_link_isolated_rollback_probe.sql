-- TASK-08 / H52: isolated PostgreSQL role simulation only, after H51.
-- Synthetic pending requests; no real user is used. Always ROLLBACK.
-- Never execute on a hosted database. Python driver enforces LocalRestore.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='80s';
DO $setup$
DECLARE a uuid;b uuid;c uuid;ap uuid;bp uuid;cp uuid;pub uuid;priv uuid; media_request uuid; media_key text;
 sm1 uuid;sm2 uuid;sm3 uuid;p1 uuid;p2 uuid;p3 uuid; cancel_club uuid; sm4 uuid; p4 uuid; u uuid; mail text;
BEGIN
 IF current_user<>'postgres'
 OR to_regprocedure('profile_link_private.review_player_profile_link_original(uuid,text,text)') IS NULL
 OR to_regclass('public.h51_postcutover_data_preservation') IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.h51_postcutover_data_preservation WHERE marker='retained')
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name='task08_prod_phase2_atomic')<>1
 OR EXISTS (SELECT 1 FROM public.clubs WHERE name LIKE 'TASK08-H52-RB-%')
 THEN RAISE EXCEPTION 'H52 isolated post-H51 baseline guard failed'; END IF;
 a:=gen_random_uuid(); b:=gen_random_uuid(); c:=gen_random_uuid();
 FOREACH u IN ARRAY ARRAY[a,b,c] LOOP
  mail:='task08-h52-'||u::text||'@example.invalid';
  INSERT INTO auth.users(id,email,email_confirmed_at,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(u,mail,now(),'authenticated','authenticated','{"provider":"email","providers":["email"]}'::jsonb,
   jsonb_build_object('display_name','H52 Synthetic Account'),now(),now());
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u) THEN
   INSERT INTO public.profiles(id,display_name,email) VALUES(u,'H52 Synthetic Account',mail);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.player_profiles WHERE linked_auth_user_id=u AND is_active) THEN
   INSERT INTO public.player_profiles(display_name,linked_auth_user_id,created_by_auth_user_id,is_active)
   VALUES('H52 Synthetic Account',u,u,true);
  END IF;
 END LOOP;
 SELECT id INTO STRICT ap FROM public.player_profiles WHERE linked_auth_user_id=a AND is_active;
 SELECT id INTO STRICT bp FROM public.player_profiles WHERE linked_auth_user_id=b AND is_active;
 -- Synthetic canonical target has private settings and a fake local metadata
 -- object/operation (no real R2 object, no network). They must remain intact.
 media_request:=gen_random_uuid();
 media_key:='profiles/'||bp::text||'/'||media_request::text||'.webp';
 INSERT INTO public.profile_media_objects(object_key,profile_id,request_id,state)
 VALUES(media_key,bp,media_request,'active');
 INSERT INTO public.profile_media_operations(request_id,actor_id,profile_id,kind,status,object_key,expected_version,committed_at)
 VALUES(media_request,b,bp,'upload','committed',media_key,0,now());
 INSERT INTO public.player_profile_private(profile_id,owner_id,instagram_username,instagram_version,avatar_version,avatar_key)
 VALUES(bp,b,'h52_synthetic',1,1,media_key)
 ON CONFLICT(profile_id) DO UPDATE SET owner_id=excluded.owner_id,instagram_username=excluded.instagram_username,
 instagram_version=excluded.instagram_version,avatar_version=excluded.avatar_version,avatar_key=excluded.avatar_key;
 PERFORM set_config('h52.target_profile',bp::text,true);
 PERFORM set_config('h52.target_media_digest',md5(jsonb_build_array(
  (SELECT to_jsonb(t) FROM public.player_profile_private t WHERE profile_id=bp),
  (SELECT to_jsonb(t) FROM public.profile_media_objects t WHERE profile_id=bp),
  (SELECT to_jsonb(t) FROM public.profile_media_operations t WHERE profile_id=bp))::text),true);
 SELECT id INTO STRICT cp FROM public.player_profiles WHERE linked_auth_user_id=c AND is_active;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility)
 VALUES('TASK08-H52-RB-PUBLIC',a,true,'public') RETURNING id INTO pub;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility)
 VALUES('TASK08-H52-RB-PRIVATE',a,true,'private') RETURNING id INTO priv;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(pub,a,ap,'main_admin',true,'active'),
 (priv,a,ap,'main_admin',true,'active');
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('H52 Public Global Name',a,true) RETURNING id INTO p1;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('H52 Private Global Name',a,true) RETURNING id INTO p2;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('H52 Legacy Global Name',a,true) RETURNING id INTO p3;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status,club_display_name)
 VALUES(pub,NULL,p1,'member',true,'active','H52 Existing Public Alias') RETURNING id INTO sm1;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(priv,NULL,p2,'member',true,'active') RETURNING id INTO sm2;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status,club_display_name)
 VALUES(pub,NULL,p3,'member',true,'active','H52 Legacy Provisional') RETURNING id INTO sm3;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility)
 VALUES('TASK08-H52-RB-CANCEL',a,true,'private') RETURNING id INTO cancel_club;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(cancel_club,a,ap,'main_admin',true,'active');
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('H52 Cancel Source',a,true) RETURNING id INTO p4;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(cancel_club,NULL,p4,'member',true,'active') RETURNING id INTO sm4;
 PERFORM set_config('h52.cancel_club',cancel_club::text,true);
 PERFORM set_config('h52.cancel_member',sm4::text,true);
 PERFORM set_config('h52.cancel_source',p4::text,true);
 PERFORM set_config('h52.owner',a::text,true);
 PERFORM set_config('h52.recipient',b::text,true);
 PERFORM set_config('h52.outsider',c::text,true);
 PERFORM set_config('h52.public',pub::text,true);
 PERFORM set_config('h52.private',priv::text,true);
 PERFORM set_config('h52.public_member',sm1::text,true);
 PERFORM set_config('h52.private_member',sm2::text,true);
 PERFORM set_config('h52.legacy_member',sm3::text,true);
 PERFORM set_config('h52.public_source',p1::text,true);
 PERFORM set_config('h52.private_source',p2::text,true);
 PERFORM set_config('h52.legacy_source',p3::text,true);
END $setup$;

-- Unknown new references must still fail closed. This relation is disposable
-- and empty; it is dropped before the normal pending-flow tests.
CREATE TABLE public.h52_unreviewed_reference_probe(profile_id uuid REFERENCES public.player_profiles(id));
DO $unknown_fk$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM profile_link_private.check_reference_schema();
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  denied:=position('未確認の外部キーがあります' IN SQLERRM)>0;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 unknown FK was not rejected'; END IF;
 PERFORM set_config('h52.unknown_fk_denied','true',true);
END $unknown_fk$;
DROP TABLE public.h52_unreviewed_reference_probe;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h52.owner'),true);
SELECT set_config('h52.public_req',public.request_player_profile_link(
 current_setting('h52.public')::uuid,current_setting('h52.public_member')::uuid,
 current_setting('h52.recipient')::uuid)::text,true);
SELECT set_config('h52.private_req',public.request_player_profile_link(
 current_setting('h52.private')::uuid,current_setting('h52.private_member')::uuid,
 current_setting('h52.recipient')::uuid)::text,true);
SELECT set_config('h52.legacy_req',public.request_player_profile_link(
 current_setting('h52.public')::uuid,current_setting('h52.legacy_member')::uuid,
 current_setting('h52.outsider')::uuid)::text,true);

SELECT set_config('h52.cancel_req',public.request_player_profile_link(
 current_setting('h52.cancel_club')::uuid,current_setting('h52.cancel_member')::uuid,
 current_setting('h52.outsider')::uuid)::text,true);

DO $manager_scope$
DECLARE d jsonb;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h52.public_req')::uuid);
 IF d->>'detail_scope' IS DISTINCT FROM 'manager'
 OR d ? 'group_display_name_suggestion'
 OR d ? 'group_display_name_current' OR d ? 'group_visibility'
 OR d ? 'review_token' OR d ? 'memberships'
 THEN RAISE EXCEPTION 'H52 manager detail scope unexpectedly expanded'; END IF;
 PERFORM set_config('h52.manager_scope','true',true);
END $manager_scope$;

SELECT set_config('request.jwt.claim.sub',current_setting('h52.outsider'),true);
DO $third_party_denial$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(
   current_setting('h52.public_req')::uuid,'bogus','H52 Other Account',
   'H52 Existing Public Alias',true);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 third-party named approval allowed'; END IF;
 PERFORM set_config('h52.third_party_rejected','true',true);
END $third_party_denial$;

SELECT set_config('request.jwt.claim.sub',current_setting('h52.recipient'),true);
DO $preview_public$
DECLARE d jsonb;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h52.public_req')::uuid);
 IF d->>'detail_scope' IS DISTINCT FROM 'recipient' OR d->>'group_visibility' IS DISTINCT FROM 'public'
 OR d->>'group_display_name_suggestion' IS DISTINCT FROM 'H52 Existing Public Alias'
 OR d->>'group_display_name_current' IS DISTINCT FROM 'H52 Existing Public Alias'
 OR coalesce(length(d->>'review_token'),0)<8
 THEN RAISE EXCEPTION 'H52 public receiver scoped name suggestion invalid'; END IF;
 PERFORM set_config('h52.public_token',d->>'review_token',true);
END $preview_public$;
DO $without_consent$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(
   current_setting('h52.public_req')::uuid,current_setting('h52.public_token'),
   'H52 Chosen Public Alias','H52 Existing Public Alias',false);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 public approval without consent succeeded'; END IF;
 PERFORM set_config('h52.public_no_consent','true',true);
END $without_consent$;
DO $stale_name$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(
   current_setting('h52.public_req')::uuid,current_setting('h52.public_token'),
   'H52 Chosen Public Alias','H52 stale CAS',true);
 EXCEPTION WHEN SQLSTATE 'PT409' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 stale alias snapshot succeeded'; END IF;
 PERFORM set_config('h52.cas_rejected','true',true);
END $stale_name$;
DO $stale_token$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(
   current_setting('h52.public_req')::uuid,'obsolete-preview-token',
   'H52 Chosen Public Alias','H52 Existing Public Alias',true);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  denied:=position('確認後に内容が変更されています' IN SQLERRM)>0;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 obsolete token accepted'; END IF;
 PERFORM set_config('h52.token_rejected','true',true);
END $stale_token$;
DO $approve_public$
DECLARE r jsonb;
BEGIN
 r:=public.review_player_profile_link_named(
  current_setting('h52.public_req')::uuid,current_setting('h52.public_token'),
  'H52 Chosen Public Alias','H52 Existing Public Alias',true);
 IF r->>'status' IS DISTINCT FROM 'approved' OR r->>'club_display_name' IS DISTINCT FROM 'H52 Chosen Public Alias'
  OR (r->>'public_name_confirmed')::boolean IS NOT TRUE
 THEN RAISE EXCEPTION 'H52 public named approval failed'; END IF;
END $approve_public$;

DO $preview_private$
DECLARE d jsonb;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h52.private_req')::uuid);
 IF d->>'detail_scope' IS DISTINCT FROM 'recipient' OR d->>'group_visibility' IS DISTINCT FROM 'private'
 OR d->>'group_display_name_suggestion' IS DISTINCT FROM 'H52 Private Global Name'
 OR d->>'group_display_name_current' IS NOT NULL
 OR coalesce(length(d->>'review_token'),0)<8
 THEN RAISE EXCEPTION 'H52 private scoped preview not correct'; END IF;
 PERFORM set_config('h52.private_token',d->>'review_token',true);
END $preview_private$;
DO $private_public_reject$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(
   current_setting('h52.private_req')::uuid,current_setting('h52.private_token'),
   'H52 Private Chosen Name',NULL,true);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 private public-flag unexpectedly accepted'; END IF;
 PERFORM set_config('h52.private_public_rejected','true',true);
END $private_public_reject$;
DO $approve_private$
DECLARE r jsonb;
BEGIN
 r:=public.review_player_profile_link_named(
  current_setting('h52.private_req')::uuid,current_setting('h52.private_token'),
  'H52 Private Chosen Name',NULL,false);
 IF r->>'status' IS DISTINCT FROM 'approved'
 OR r->>'club_display_name' IS DISTINCT FROM 'H52 Private Chosen Name'
 OR (r->>'public_name_confirmed')::boolean IS NOT FALSE
 THEN RAISE EXCEPTION 'H52 private approval failed'; END IF;
END $approve_private$;

SELECT set_config('request.jwt.claim.sub',current_setting('h52.outsider'),true);
DO $legacy_approval$
DECLARE d jsonb;r jsonb; denied boolean:=false; msg text;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h52.legacy_req')::uuid);
 IF d->>'status' IS DISTINCT FROM 'pending' OR d->>'group_display_name_suggestion' IS DISTINCT FROM 'H52 Legacy Provisional'
 OR coalesce(length(d->>'review_token'),0)<8 THEN RAISE EXCEPTION 'H52 legacy pending preview missing'; END IF;
 BEGIN
  PERFORM public.review_player_profile_link(current_setting('h52.legacy_req')::uuid,'approved',d->>'review_token');
 EXCEPTION WHEN insufficient_privilege THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  denied:=position('最新版の連携画面' IN msg)>0;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 old approval unexpectedly allowed'; END IF;
 d:=public.get_player_profile_link_request(current_setting('h52.legacy_req')::uuid);
 IF d->>'status' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'H52 legacy denied request no longer pending'; END IF;
 PERFORM set_config('h52.legacy_denied','true',true);
END $legacy_approval$;

-- Each reviewed private/media FK must be rejected when it points at the
-- provisional source. Seed only a synthetic row and remove it after its
-- negative check. No production row or actual media object is touched.
SET LOCAL ROLE postgres;
INSERT INTO public.player_profile_private(profile_id)
VALUES(current_setting('h52.legacy_source')::uuid);
SET LOCAL ROLE authenticated;
DO $source_private$
DECLARE d jsonb; denied boolean:=false;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h52.legacy_req')::uuid);
 BEGIN
  PERFORM public.review_player_profile_link_named(current_setting('h52.legacy_req')::uuid,
   d->>'review_token','H52 Source Media Must Not Transfer',d->>'group_display_name_current',true);
 EXCEPTION WHEN SQLSTATE '42501' THEN
  denied:=position('H52 source private/media references require separate review' IN SQLERRM)>0;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 source private row not blocked'; END IF;
 IF public.get_player_profile_link_request(current_setting('h52.legacy_req')::uuid)->>'status' IS DISTINCT FROM 'pending'
 THEN RAISE EXCEPTION 'H52 source private denial changed pending'; END IF;
 PERFORM set_config('h52.source_private_denied','true',true);
END $source_private$;
SET LOCAL ROLE postgres;
DELETE FROM public.player_profile_private WHERE profile_id=current_setting('h52.legacy_source')::uuid;
INSERT INTO public.profile_media_objects(object_key,profile_id,request_id,state)
VALUES('profiles/'||current_setting('h52.legacy_source')||'/'||gen_random_uuid()::text||'.webp',
 current_setting('h52.legacy_source')::uuid,gen_random_uuid(),'garbage');
SET LOCAL ROLE authenticated;
DO $source_object$
DECLARE d jsonb; denied boolean:=false;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h52.legacy_req')::uuid);
 BEGIN
  PERFORM public.review_player_profile_link_named(current_setting('h52.legacy_req')::uuid,
   d->>'review_token','H52 Source Media Must Not Transfer',d->>'group_display_name_current',true);
 EXCEPTION WHEN SQLSTATE '42501' THEN
  denied:=position('H52 source private/media references require separate review' IN SQLERRM)>0;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 source object not blocked'; END IF;
 IF public.get_player_profile_link_request(current_setting('h52.legacy_req')::uuid)->>'status' IS DISTINCT FROM 'pending'
 THEN RAISE EXCEPTION 'H52 source object denial changed pending'; END IF;
 PERFORM set_config('h52.source_object_denied','true',true);
END $source_object$;
SET LOCAL ROLE postgres;
DELETE FROM public.profile_media_objects WHERE profile_id=current_setting('h52.legacy_source')::uuid;
INSERT INTO public.profile_media_operations(request_id,actor_id,profile_id,kind,status,expected_version)
VALUES(gen_random_uuid(),current_setting('h52.outsider')::uuid,current_setting('h52.legacy_source')::uuid,'delete','aborted',0);
SET LOCAL ROLE authenticated;
DO $source_operation$
DECLARE d jsonb; denied boolean:=false;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h52.legacy_req')::uuid);
 BEGIN
  PERFORM public.review_player_profile_link_named(current_setting('h52.legacy_req')::uuid,
   d->>'review_token','H52 Source Media Must Not Transfer',d->>'group_display_name_current',true);
 EXCEPTION WHEN SQLSTATE '42501' THEN
  denied:=position('H52 source private/media references require separate review' IN SQLERRM)>0;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 source operation not blocked'; END IF;
 IF public.get_player_profile_link_request(current_setting('h52.legacy_req')::uuid)->>'status' IS DISTINCT FROM 'pending'
 THEN RAISE EXCEPTION 'H52 source operation denial changed pending'; END IF;
 PERFORM set_config('h52.source_operation_denied','true',true);
END $source_operation$;
SET LOCAL ROLE postgres;
DELETE FROM public.profile_media_operations WHERE profile_id=current_setting('h52.legacy_source')::uuid;
SET LOCAL ROLE authenticated;
DO $valid_reject$
DECLARE r jsonb;
BEGIN
 r:=public.review_player_profile_link(current_setting('h52.legacy_req')::uuid,'rejected',NULL);
 IF r->>'status' IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'H52 legitimate pending rejection failed'; END IF;
END $valid_reject$;

-- A non-manager cannot cancel, even the recipient. Original authorization
-- uses a generic raise exception (P0001); require that exact reason.
DO $invalid_cancel$
DECLARE denied boolean:=false;msg text;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link(current_setting('h52.cancel_req')::uuid,'cancelled',NULL);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  denied:=position('管理者の取消' IN msg)>0;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 nonmanager cancel not safely denied'; END IF;
END $invalid_cancel$;
SELECT set_config('request.jwt.claim.sub',current_setting('h52.owner'),true);
DO $valid_cancel$
DECLARE r jsonb;
BEGIN
 r:=public.review_player_profile_link(current_setting('h52.cancel_req')::uuid,'cancelled',NULL);
 IF r->>'status' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'H52 legitimate pending cancellation failed'; END IF;
END $valid_cancel$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $anon_named$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(current_setting('h52.public_req')::uuid,'fake','H52 Alias',NULL,true);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H52 anonymous named execution allowed'; END IF;
END $anon_named$;
RESET ROLE;

SELECT jsonb_build_object(
'rollback_only',true,
'unknown_fk_denied',current_setting('h52.unknown_fk_denied',true)='true',
'source_private_denied',current_setting('h52.source_private_denied',true)='true',
'source_object_denied',current_setting('h52.source_object_denied',true)='true',
'source_operation_denied',current_setting('h52.source_operation_denied',true)='true',
'canonical_target_media_unchanged',current_setting('h52.target_media_digest')=md5(jsonb_build_array(
 (SELECT to_jsonb(t) FROM public.player_profile_private t WHERE profile_id=current_setting('h52.target_profile')::uuid),
 (SELECT to_jsonb(t) FROM public.profile_media_objects t WHERE profile_id=current_setting('h52.target_profile')::uuid),
 (SELECT to_jsonb(t) FROM public.profile_media_operations t WHERE profile_id=current_setting('h52.target_profile')::uuid))::text),
'legacy_approval_denied',current_setting('h52.legacy_denied',true)='true',
'pending_rejected_cancelled',(SELECT count(*)=2 FROM public.player_profile_link_requests WHERE (id=current_setting('h52.legacy_req')::uuid AND status='rejected') OR (id=current_setting('h52.cancel_req')::uuid AND status='cancelled')),
'no_merge_reject_cancel',(SELECT count(*)=0 FROM public.player_profile_merges WHERE link_request_id IN(current_setting('h52.legacy_req')::uuid,current_setting('h52.cancel_req')::uuid)),
'cancel_source_preserved',(SELECT count(*)=1 FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=cm.player_profile_id WHERE cm.id=current_setting('h52.cancel_member')::uuid AND pp.id=current_setting('h52.cancel_source')::uuid AND pp.linked_auth_user_id IS NULL AND pp.is_active),
'manager_scope_safe',current_setting('h52.manager_scope',true)='true',
'other_user_rejected',current_setting('h52.third_party_rejected',true)='true',
'public_requires_consent',current_setting('h52.public_no_consent',true)='true',
'alias_cas_pt409',current_setting('h52.cas_rejected',true)='true',
'obsolete_review_token_rejected',current_setting('h52.token_rejected',true)='true',
'private_public_flag_rejected',current_setting('h52.private_public_rejected',true)='true',
'approved_both',(SELECT count(*)=2 FROM public.player_profile_link_requests
 WHERE club_id IN(current_setting('h52.public')::uuid,current_setting('h52.private')::uuid)
 AND status='approved'),
'public_alias_saved',(SELECT count(*)=1 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.id=current_setting('h52.public_member')::uuid
 AND cm.club_display_name='H52 Chosen Public Alias'
 AND cm.club_display_name_public_confirmed_at IS NOT NULL
 AND pp.linked_auth_user_id=current_setting('h52.recipient')::uuid),
'private_alias_is_private',(SELECT count(*)=1 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.id=current_setting('h52.private_member')::uuid
 AND cm.club_display_name='H52 Private Chosen Name'
 AND cm.club_display_name_public_confirmed_at IS NULL
 AND pp.linked_auth_user_id=current_setting('h52.recipient')::uuid),
'old_legacy_rejection_preserves_source',(SELECT count(*)=1 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.id=current_setting('h52.legacy_member')::uuid
 AND cm.club_display_name='H52 Legacy Provisional'
 AND cm.club_display_name_public_confirmed_at IS NULL
 AND pp.linked_auth_user_id IS NULL AND pp.is_active),
'public_directory_confirmed_or_unlinked',(SELECT count(*)=2
 FROM public.get_public_club_directory(current_setting('h52.public')::uuid)),
'merge_snapshots_consistent',(SELECT count(*)=2
 FROM public.player_profile_merges m
 JOIN profile_link_private.merge_changes mc ON mc.merge_id=m.id
 JOIN public.player_profile_link_requests lr ON lr.id=m.link_request_id
 JOIN public.club_members cm ON cm.id=lr.source_club_member_id
 WHERE lr.id IN(current_setting('h52.public_req')::uuid,current_setting('h52.private_req')::uuid)
 AND mc.source_schema='public' AND mc.source_table='club_members'
 AND mc.row_id=cm.id AND mc.after_row=to_jsonb(cm)
 AND mc.before_row->>'club_display_name' IS DISTINCT FROM cm.club_display_name),
'request_receiver_consent_saved',(SELECT count(*)=1 FROM public.player_profile_link_requests
 WHERE id=current_setting('h52.public_req')::uuid
 AND club_display_name_selected='H52 Chosen Public Alias'
 AND club_display_name_public_confirmed_at IS NOT NULL),
'private_request_consent_not_public',(SELECT count(*)=1 FROM public.player_profile_link_requests
 WHERE id=current_setting('h52.private_req')::uuid
 AND club_display_name_selected='H52 Private Chosen Name'
 AND club_display_name_public_confirmed_at IS NULL),
'legacy_request_not_backfilled',(SELECT count(*)=1 FROM public.player_profile_link_requests
 WHERE id=current_setting('h52.legacy_req')::uuid
 AND club_display_name_selected IS NULL
 AND club_display_name_public_confirmed_at IS NULL),
'original_profile_names_unmodified',(SELECT count(*)=3 FROM public.player_profiles
 WHERE linked_auth_user_id IN(current_setting('h52.owner')::uuid,current_setting('h52.recipient')::uuid,current_setting('h52.outsider')::uuid)
 AND is_active),
'approved_sources_retired',(SELECT count(*)=2 FROM public.player_profiles WHERE
 id IN(current_setting('h52.public_source')::uuid,current_setting('h52.private_source')::uuid)
 AND NOT is_active AND linked_auth_user_id IS NULL)
) report;
ROLLBACK;