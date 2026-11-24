-- TASK-08-03 H18 / STAGE ONLY: complete one-transaction ROLLBACK
-- integration for manager-issued public/private profile link, alias and consent.
-- No existing user, club, match, profile, or event survives any mutations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='80s';
DO $setup$
DECLARE a uuid;b uuid;c uuid;ap uuid;cp uuid;pub uuid;priv uuid;
 sm1 uuid;sm2 uuid;sm3 uuid;p1 uuid;p2 uuid;p3 uuid;
BEGIN
 IF current_user<>'postgres' OR (SELECT count(*) FROM public.clubs)<>3
 OR (SELECT count(*) FROM public.club_members)<>12
 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.player_profile_link_requests)<>0
 OR (SELECT count(*) FROM public.player_profile_merges)<>0
 OR (SELECT count(*) FROM public.notifications)<>0
 OR EXISTS (SELECT 1 FROM public.clubs WHERE name LIKE 'TASK08-H18-RB-%')
 THEN RAISE EXCEPTION 'H18 stage baseline guard failed'; END IF;
 SELECT id INTO STRICT a FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT b FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT c FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT ap FROM public.player_profiles WHERE linked_auth_user_id=a AND is_active;
 SELECT id INTO STRICT cp FROM public.player_profiles WHERE linked_auth_user_id=c AND is_active;
 IF NOT EXISTS (SELECT 1 FROM public.player_profiles WHERE linked_auth_user_id=b AND is_active)
 OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id IN(a,b,c) HAVING count(*)=3)
 THEN RAISE EXCEPTION 'H18 canonical Stage Auth accounts not ready'; END IF;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility)
 VALUES('TASK08-H18-RB-PUBLIC',a,true,'public') RETURNING id INTO pub;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility)
 VALUES('TASK08-H18-RB-PRIVATE',a,true,'private') RETURNING id INTO priv;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(pub,a,ap,'main_admin',true,'active'),
 (priv,a,ap,'main_admin',true,'active');
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('H18 Public Global Name',a,true) RETURNING id INTO p1;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('H18 Private Global Name',a,true) RETURNING id INTO p2;
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('H18 Legacy Global Name',a,true) RETURNING id INTO p3;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status,club_display_name)
 VALUES(pub,NULL,p1,'member',true,'active','H18 Existing Public Alias') RETURNING id INTO sm1;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(priv,NULL,p2,'member',true,'active') RETURNING id INTO sm2;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status,club_display_name)
 VALUES(pub,NULL,p3,'member',true,'active','H18 Legacy Provisional') RETURNING id INTO sm3;
 PERFORM set_config('h18.owner',a::text,true);
 PERFORM set_config('h18.recipient',b::text,true);
 PERFORM set_config('h18.outsider',c::text,true);
 PERFORM set_config('h18.public',pub::text,true);
 PERFORM set_config('h18.private',priv::text,true);
 PERFORM set_config('h18.public_member',sm1::text,true);
 PERFORM set_config('h18.private_member',sm2::text,true);
 PERFORM set_config('h18.legacy_member',sm3::text,true);
 PERFORM set_config('h18.public_source',p1::text,true);
 PERFORM set_config('h18.private_source',p2::text,true);
 PERFORM set_config('h18.legacy_source',p3::text,true);
END $setup$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h18.owner'),true);
SELECT set_config('h18.public_req',public.request_player_profile_link(
 current_setting('h18.public')::uuid,current_setting('h18.public_member')::uuid,
 current_setting('h18.recipient')::uuid)::text,true);
SELECT set_config('h18.private_req',public.request_player_profile_link(
 current_setting('h18.private')::uuid,current_setting('h18.private_member')::uuid,
 current_setting('h18.recipient')::uuid)::text,true);
SELECT set_config('h18.legacy_req',public.request_player_profile_link(
 current_setting('h18.public')::uuid,current_setting('h18.legacy_member')::uuid,
 current_setting('h18.outsider')::uuid)::text,true);

DO $manager_scope$
DECLARE d jsonb;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h18.public_req')::uuid);
 IF d->>'detail_scope'<>'manager'
 OR d ? 'group_display_name_suggestion'
 OR d ? 'group_display_name_current' OR d ? 'group_visibility'
 OR d ? 'review_token' OR d ? 'memberships'
 THEN RAISE EXCEPTION 'H18 manager detail scope unexpectedly expanded'; END IF;
 PERFORM set_config('h18.manager_scope','true',true);
END $manager_scope$;

SELECT set_config('request.jwt.claim.sub',current_setting('h18.outsider'),true);
DO $third_party_denial$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(
   current_setting('h18.public_req')::uuid,'bogus','H18 Other Account',
   'H18 Existing Public Alias',true);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H18 third-party named approval allowed'; END IF;
 PERFORM set_config('h18.third_party_rejected','true',true);
END $third_party_denial$;

SELECT set_config('request.jwt.claim.sub',current_setting('h18.recipient'),true);
DO $preview_public$
DECLARE d jsonb;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h18.public_req')::uuid);
 IF d->>'detail_scope'<>'recipient' OR d->>'group_visibility'<>'public'
 OR d->>'group_display_name_suggestion'<>'H18 Existing Public Alias'
 OR d->>'group_display_name_current'<>'H18 Existing Public Alias'
 OR length(d->>'review_token')<8
 THEN RAISE EXCEPTION 'H18 public receiver scoped name suggestion invalid'; END IF;
 PERFORM set_config('h18.public_token',d->>'review_token',true);
END $preview_public$;
DO $without_consent$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(
   current_setting('h18.public_req')::uuid,current_setting('h18.public_token'),
   'H18 Chosen Public Alias','H18 Existing Public Alias',false);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H18 public approval without consent succeeded'; END IF;
 PERFORM set_config('h18.public_no_consent','true',true);
END $without_consent$;
DO $stale_name$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(
   current_setting('h18.public_req')::uuid,current_setting('h18.public_token'),
   'H18 Chosen Public Alias','H18 stale CAS',true);
 EXCEPTION WHEN SQLSTATE 'PT409' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H18 stale alias snapshot succeeded'; END IF;
 PERFORM set_config('h18.cas_rejected','true',true);
END $stale_name$;
DO $stale_token$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(
   current_setting('h18.public_req')::uuid,'obsolete-preview-token',
   'H18 Chosen Public Alias','H18 Existing Public Alias',true);
 EXCEPTION WHEN OTHERS THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H18 obsolete token accepted'; END IF;
 PERFORM set_config('h18.token_rejected','true',true);
END $stale_token$;
DO $approve_public$
DECLARE r jsonb;
BEGIN
 r:=public.review_player_profile_link_named(
  current_setting('h18.public_req')::uuid,current_setting('h18.public_token'),
  'H18 Chosen Public Alias','H18 Existing Public Alias',true);
 IF r->>'status'<>'approved' OR r->>'club_display_name'<>'H18 Chosen Public Alias'
  OR (r->>'public_name_confirmed')::boolean IS NOT TRUE
 THEN RAISE EXCEPTION 'H18 public named approval failed'; END IF;
END $approve_public$;

DO $preview_private$
DECLARE d jsonb;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h18.private_req')::uuid);
 IF d->>'detail_scope'<>'recipient' OR d->>'group_visibility'<>'private'
 OR d->>'group_display_name_suggestion'<>'H18 Private Global Name'
 OR d->>'group_display_name_current' IS NOT NULL
 OR length(d->>'review_token')<8
 THEN RAISE EXCEPTION 'H18 private scoped preview not correct'; END IF;
 PERFORM set_config('h18.private_token',d->>'review_token',true);
END $preview_private$;
DO $private_public_reject$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  PERFORM public.review_player_profile_link_named(
   current_setting('h18.private_req')::uuid,current_setting('h18.private_token'),
   'H18 Private Chosen Name',NULL,true);
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'H18 private public-flag unexpectedly accepted'; END IF;
 PERFORM set_config('h18.private_public_rejected','true',true);
END $private_public_reject$;
DO $approve_private$
DECLARE r jsonb;
BEGIN
 r:=public.review_player_profile_link_named(
  current_setting('h18.private_req')::uuid,current_setting('h18.private_token'),
  'H18 Private Chosen Name',NULL,false);
 IF r->>'status'<>'approved'
 OR r->>'club_display_name'<>'H18 Private Chosen Name'
 OR (r->>'public_name_confirmed')::boolean IS NOT FALSE
 THEN RAISE EXCEPTION 'H18 private approval failed'; END IF;
END $approve_private$;

SELECT set_config('request.jwt.claim.sub',current_setting('h18.outsider'),true);
DO $legacy_approval$
DECLARE d jsonb;r jsonb;
BEGIN
 d:=public.get_player_profile_link_request(current_setting('h18.legacy_req')::uuid);
 IF d->>'group_display_name_suggestion'<>'H18 Legacy Provisional' THEN
  RAISE EXCEPTION 'H18 legacy suggestion missing'; END IF;
 r:=public.review_player_profile_link(current_setting('h18.legacy_req')::uuid,
  'approved',d->>'review_token');
 IF r->>'status'<>'approved' THEN RAISE EXCEPTION 'H18 old reviewer broken'; END IF;
END $legacy_approval$;
RESET ROLE;

SELECT jsonb_build_object(
'rollback_only',true,
'manager_scope_safe',current_setting('h18.manager_scope',true)='true',
'other_user_rejected',current_setting('h18.third_party_rejected',true)='true',
'public_requires_consent',current_setting('h18.public_no_consent',true)='true',
'alias_cas_pt409',current_setting('h18.cas_rejected',true)='true',
'obsolete_review_token_rejected',current_setting('h18.token_rejected',true)='true',
'private_public_flag_rejected',current_setting('h18.private_public_rejected',true)='true',
'approved_all',(SELECT count(*)=3 FROM public.player_profile_link_requests
 WHERE club_id IN(current_setting('h18.public')::uuid,current_setting('h18.private')::uuid)
 AND status='approved'),
'public_alias_saved',(SELECT count(*)=1 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.id=current_setting('h18.public_member')::uuid
 AND cm.club_display_name='H18 Chosen Public Alias'
 AND cm.club_display_name_public_confirmed_at IS NOT NULL
 AND pp.linked_auth_user_id=current_setting('h18.recipient')::uuid),
'private_alias_is_private',(SELECT count(*)=1 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.id=current_setting('h18.private_member')::uuid
 AND cm.club_display_name='H18 Private Chosen Name'
 AND cm.club_display_name_public_confirmed_at IS NULL
 AND pp.linked_auth_user_id=current_setting('h18.recipient')::uuid),
'old_legacy_alias_not_exposed',(SELECT count(*)=1 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.id=current_setting('h18.legacy_member')::uuid
 AND cm.club_display_name='H18 Legacy Provisional'
 AND cm.club_display_name_public_confirmed_at IS NULL
 AND pp.linked_auth_user_id=current_setting('h18.outsider')::uuid),
'public_directory_only_approved',(SELECT count(*)=1
 FROM public.get_public_club_directory(current_setting('h18.public')::uuid)),
'merge_snapshots_consistent',(SELECT count(*)=2
 FROM public.player_profile_merges m
 JOIN profile_link_private.merge_changes mc ON mc.merge_id=m.id
 JOIN public.player_profile_link_requests lr ON lr.id=m.link_request_id
 JOIN public.club_members cm ON cm.id=lr.source_club_member_id
 WHERE lr.id IN(current_setting('h18.public_req')::uuid,current_setting('h18.private_req')::uuid)
 AND mc.source_schema='public' AND mc.source_table='club_members'
 AND mc.row_id=cm.id AND mc.after_row=to_jsonb(cm)
 AND mc.before_row->>'club_display_name' IS DISTINCT FROM cm.club_display_name),
'request_receiver_consent_saved',(SELECT count(*)=1 FROM public.player_profile_link_requests
 WHERE id=current_setting('h18.public_req')::uuid
 AND club_display_name_selected='H18 Chosen Public Alias'
 AND club_display_name_public_confirmed_at IS NOT NULL),
'private_request_consent_not_public',(SELECT count(*)=1 FROM public.player_profile_link_requests
 WHERE id=current_setting('h18.private_req')::uuid
 AND club_display_name_selected='H18 Private Chosen Name'
 AND club_display_name_public_confirmed_at IS NULL),
'legacy_request_not_backfilled',(SELECT count(*)=1 FROM public.player_profile_link_requests
 WHERE id=current_setting('h18.legacy_req')::uuid
 AND club_display_name_selected IS NULL
 AND club_display_name_public_confirmed_at IS NULL),
'original_profile_names_unmodified',(SELECT count(*)=3 FROM public.player_profiles
 WHERE linked_auth_user_id IN(current_setting('h18.owner')::uuid,current_setting('h18.recipient')::uuid,current_setting('h18.outsider')::uuid)
 AND is_active),
'synthetic_sources_retired',(SELECT count(*)=3 FROM public.player_profiles WHERE
 id IN(current_setting('h18.public_source')::uuid,current_setting('h18.private_source')::uuid,current_setting('h18.legacy_source')::uuid)
 AND NOT is_active AND linked_auth_user_id IS NULL)
) report;
ROLLBACK;