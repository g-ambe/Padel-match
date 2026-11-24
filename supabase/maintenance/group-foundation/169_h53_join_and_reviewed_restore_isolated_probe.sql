-- H53: isolated post-H52 only; synthetic joins and manual reviewed restore. Always ROLLBACK.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='70s';
DO $seed$
DECLARE v_owner uuid;v_recipient uuid;v_outsider uuid;v_owner_pp uuid;
 a uuid;b uuid;c uuid;ap uuid;bp uuid;cp uuid;u uuid;mail text;media_request uuid;media_key text;
 v_recipient_pp uuid;v_outsider_pp uuid;v_club uuid;v_source uuid;v_mid uuid;v_ref uuid;
BEGIN
 IF current_user<>'postgres' OR to_regclass('public.h51_postcutover_data_preservation') IS NULL
 OR position('H52 source private/media' IN pg_get_functiondef('profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure))=0
 THEN RAISE EXCEPTION 'H53 isolated baseline missing'; END IF;
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
 PERFORM set_config('h53.target_profile',bp::text,true);
 PERFORM set_config('h53.target_media_digest',md5(jsonb_build_array(
  (SELECT to_jsonb(t) FROM public.player_profile_private t WHERE profile_id=bp),
  (SELECT to_jsonb(t) FROM public.profile_media_objects t WHERE profile_id=bp),
  (SELECT to_jsonb(t) FROM public.profile_media_operations t WHERE profile_id=bp))::text),true);
 SELECT id INTO STRICT cp FROM public.player_profiles WHERE linked_auth_user_id=c AND is_active;
 v_owner:=a;v_recipient:=c;v_outsider:=b;
 v_owner_pp:=ap;v_recipient_pp:=cp;v_outsider_pp:=bp;
 INSERT INTO public.clubs(name,owner_id,is_active,visibility,description)
 VALUES('TASK08-H53-ROLLBACK-NAMED-JOIN',v_owner,true,'public','isolated named join')
 RETURNING id INTO v_club;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status)
 VALUES(v_club,v_owner,v_owner_pp,'main_admin',true,'active');
 INSERT INTO public.player_profiles(display_name,created_by_auth_user_id,is_active)
 VALUES('TASK08-H53-UNLINKED-SOURCE',v_owner,true) RETURNING id INTO v_source;
 INSERT INTO public.club_members(club_id,profile_id,player_profile_id,role,is_active,status,club_display_name)
 VALUES(v_club,NULL,v_source,'member',true,'active','H53 Old Provisional Name')
 RETURNING id INTO v_mid;
 SELECT public_ref INTO STRICT v_ref FROM group_read_private.directory_refs WHERE member_id=v_mid;
 PERFORM set_config('h53.owner',v_owner::text,true);
 PERFORM set_config('h53.recipient',v_recipient::text,true);
 PERFORM set_config('h53.outsider',v_outsider::text,true);
 PERFORM set_config('h53.club',v_club::text,true);
 PERFORM set_config('h53.source',v_source::text,true);
 PERFORM set_config('h53.member_id',v_mid::text,true);
 PERFORM set_config('h53.public_reference',v_ref::text,true);
 PERFORM set_config('h53.recipient_pp',v_recipient_pp::text,true);
 PERFORM set_config('h53.outsider_pp',v_outsider_pp::text,true);
END $seed$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h53.recipient'),true);
DO $deny_public_unconfirmed$
BEGIN
 BEGIN
  PERFORM public.submit_public_club_claim_named(
   current_setting('h53.club')::uuid,NULL,NULL,NULL,'H53 Not Approved',false);
  RAISE EXCEPTION 'Missing consent was accepted';
 EXCEPTION WHEN SQLSTATE '42501' THEN
  PERFORM set_config('h53.no_consent_blocked','true',true);
 END;
END $deny_public_unconfirmed$;
SELECT set_config('h53.recipient_req',public.submit_public_club_claim_named(
 current_setting('h53.club')::uuid,NULL,NULL,NULL,'H53 Selected Recipient',true)::text,true);

SELECT set_config('request.jwt.claim.sub',current_setting('h53.owner'),true);
DO $approve_normal$
DECLARE r jsonb;
BEGIN
 r:=public.review_profile_join_request(current_setting('h53.recipient_req')::uuid,'approved');
 IF r->>'status' IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'H53 normal review status'; END IF;
END $approve_normal$;

SELECT set_config('request.jwt.claim.sub',current_setting('h53.outsider'),true);
SELECT set_config('h53.preview_token',(
 public.preview_public_club_claim(current_setting('h53.club')::uuid,
 current_setting('h53.public_reference')::uuid)->>'review_token'),true);
DO $preview_guard$
BEGIN
 IF nullif(current_setting('h53.preview_token',true),'') IS NULL
 THEN RAISE EXCEPTION 'H53 preview missing'; END IF;
END $preview_guard$;
SELECT set_config('h53.outsider_req',public.submit_public_club_claim_named(
 current_setting('h53.club')::uuid,current_setting('h53.public_reference')::uuid,
 NULL,current_setting('h53.preview_token'),
 'H53 Approved Chosen Provisional',true)::text,true);
SELECT set_config('request.jwt.claim.sub',current_setting('h53.owner'),true);
DO $approve_claim$
DECLARE r jsonb;
BEGIN
 r:=public.review_profile_join_request(current_setting('h53.outsider_req')::uuid,'approved');
 IF r->>'status' IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'H53 claim review status'; END IF;
END $approve_claim$;
RESET ROLE;

CREATE TEMP TABLE h53_join_report AS SELECT jsonb_build_object('rollback_only',true,
 'no_consent_rejected',current_setting('h53.no_consent_blocked',true)='true',
 'approval_requests',(SELECT count(*)=2 FROM public.join_requests
 WHERE club_id=current_setting('h53.club')::uuid AND status='approved'
  AND club_display_name_requested IS NOT NULL AND club_display_name_confirmed_at IS NOT NULL),
 'recipient_name_applied',(SELECT cm.club_display_name='H53 Selected Recipient'
   AND cm.club_display_name_public_confirmed_at IS NOT NULL FROM public.club_members cm
 WHERE cm.club_id=current_setting('h53.club')::uuid AND cm.player_profile_id=current_setting('h53.recipient_pp')::uuid),
 'claimed_name_applied',(SELECT cm.club_display_name='H53 Approved Chosen Provisional'
   AND cm.club_display_name_public_confirmed_at IS NOT NULL
   AND cm.player_profile_id=current_setting('h53.outsider_pp')::uuid
   FROM public.club_members cm WHERE cm.id=current_setting('h53.member_id')::uuid),
 'provisional_profile_inactivated',(SELECT NOT is_active AND linked_auth_user_id IS NULL
 FROM public.player_profiles WHERE id=current_setting('h53.source')::uuid),
 'merge_audit_consistent',(SELECT count(*)=1
  FROM public.player_profile_merges m
  JOIN profile_link_private.merge_changes c ON c.merge_id=m.id
  WHERE m.join_request_id=current_setting('h53.outsider_req')::uuid
   AND c.source_schema='public' AND c.source_table='club_members'
   AND c.row_id=current_setting('h53.member_id')::uuid
   AND c.before_row->>'club_display_name'='H53 Old Provisional Name'
   AND c.after_row->>'club_display_name'='H53 Approved Chosen Provisional'
   AND c.before_row->>'club_display_name_public_confirmed_at' IS NULL
   AND c.after_row->>'club_display_name_public_confirmed_at' IS NOT NULL),

 'public_directory_only_consented',(SELECT count(*)=2
 FROM public.get_public_club_directory(current_setting('h53.club')::uuid)),
 'public_ref_not_real_member_id',(current_setting('h53.public_reference')::uuid <> current_setting('h53.member_id')::uuid),
 'direct_named_raw_rpc_revoked',NOT has_function_privilege('authenticated','public.submit_profile_join_request_named(uuid,uuid,text,text,text,boolean)','EXECUTE')
) report;

-- Use the exact existing reviewed manual restore body from main; never an app RPC.
CREATE TEMP TABLE reviewed_merge_restore(id uuid primary key) ON COMMIT DROP;
INSERT INTO reviewed_merge_restore SELECT id FROM public.player_profile_merges
 WHERE join_request_id=current_setting('h53.outsider_req')::uuid AND restored_at IS NULL;
SET LOCAL row_security=off;
do $$
declare m public.player_profile_merges; change record; current_row jsonb; assignments text; total integer;
begin
  if (select count(*) from reviewed_merge_restore)<>1 then raise exception '復旧対象の監査IDを1件だけ本人/管理者が確認してください'; end if;
  perform profile_link_private.serialize_operations();
  perform profile_link_private.lock_references();
  select * into m from public.player_profile_merges where id=(select id from reviewed_merge_restore) for update;
  if not found or m.restored_at is not null then raise exception '有効な統合監査が見つからないか復旧済みです'; end if;
  if not exists (select 1 from profile_link_private.merge_changes where merge_id=m.id) then raise exception '変更前後の監査がありません。自動的には復旧できません'; end if;
  for change in select * from profile_link_private.merge_changes where merge_id=m.id loop
    execute format('select to_jsonb(t) from %I.%I t where id=$1',change.source_schema,change.source_table) into current_row using change.row_id;
    if current_row is distinct from change.after_row then raise exception '統合後に %.% の行 % が編集・削除されています。新しい情報を上書きせず中止します',change.source_schema,change.source_table,change.row_id; end if;
  end loop;
  -- 元プロフィールを先に戻し、当時の参照・役職・状態・日時を変更前JSONから復元する。
  for change in select * from profile_link_private.merge_changes where merge_id=m.id order by (source_table='player_profiles') desc,source_schema,source_table,row_id loop
    select string_agg(format('%1$I=b.%1$I',a.attname),',') into assignments from pg_attribute a
      where a.attrelid=format('%I.%I',change.source_schema,change.source_table)::regclass and a.attnum>0 and not a.attisdropped and a.attname<>'id' and a.attgenerated='';
    execute format('update %1$I.%2$I t set %3$s from jsonb_populate_record(null::%1$I.%2$I,$1) b where t.id=$2',change.source_schema,change.source_table,assignments) using change.before_row,change.row_id;
    get diagnostics total=row_count;
    if total<>1 then raise exception '復旧対象の更新件数が1件ではありません'; end if;
  end loop;
  update public.player_profile_merges set restored_at=now(),restored_by=session_user where id=m.id;
  update public.player_profile_link_requests set status='cancelled' where id=m.link_request_id;
  update public.join_requests set status='cancelled' where id=m.join_request_id;
  insert into public.notifications(target_auth_user_id,type,title,body,related_club_id,related_profile_link_request_id,related_join_request_id)
    values(m.target_auth_user_id,'profile_merge_restored','管理者がプロフィール統合を復旧しました','所属と戦績をご確認ください',m.club_id,m.link_request_id,m.join_request_id);
end $$;

SELECT report || jsonb_build_object(
 'reviewed_restore_completed',(SELECT count(*)=1 FROM public.player_profile_merges WHERE join_request_id=current_setting('h53.outsider_req')::uuid AND restored_at IS NOT NULL),
 'restored_member',(SELECT player_profile_id=current_setting('h53.source')::uuid AND club_display_name='H53 Old Provisional Name' AND club_display_name_public_confirmed_at IS NULL FROM public.club_members WHERE id=current_setting('h53.member_id')::uuid),
 'restored_source',(SELECT is_active AND linked_auth_user_id IS NULL FROM public.player_profiles WHERE id=current_setting('h53.source')::uuid),
 'restored_request_cancelled',(SELECT status='cancelled' FROM public.join_requests WHERE id=current_setting('h53.outsider_req')::uuid),
 'normal_join_retained',(SELECT count(*)=1 FROM public.club_members WHERE club_id=current_setting('h53.club')::uuid AND player_profile_id=current_setting('h53.recipient_pp')::uuid AND club_display_name='H53 Selected Recipient'),
 'canonical_media_unchanged',current_setting('h53.target_media_digest')=md5(jsonb_build_array(
 (SELECT to_jsonb(t) FROM public.player_profile_private t WHERE profile_id=current_setting('h53.target_profile')::uuid),
 (SELECT to_jsonb(t) FROM public.profile_media_objects t WHERE profile_id=current_setting('h53.target_profile')::uuid),
 (SELECT to_jsonb(t) FROM public.profile_media_operations t WHERE profile_id=current_setting('h53.target_profile')::uuid))::text)
) FROM h53_join_report;
ROLLBACK;
