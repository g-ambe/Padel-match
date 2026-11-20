-- H18 Stage-only SQL ROLLBACK acceptance using ACTUAL JWT-created pending link requests.
-- No successful merge/approval survives transaction commit: always ROLLBACK.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='70s';
DO $seed$
DECLARE v_owner uuid;v_recipient uuid;v_pub uuid;v_priv uuid;v_public_req uuid;v_private_req uuid;
BEGIN
 IF current_user<>'postgres' OR (SELECT count(*) FROM public.clubs)<>5
 OR (SELECT count(*) FROM public.club_members)<>16
 OR (SELECT count(*) FROM public.player_profiles)<>14
 OR (SELECT count(*) FROM public.player_profile_merges)<>0
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.player_profile_link_requests)<>2
 THEN RAISE EXCEPTION 'H18 real pending approval probe baseline drift'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT v_recipient FROM auth.users WHERE lower(email)='recipient@example.com';
 SELECT id INTO STRICT v_pub FROM public.clubs
 WHERE name='TASK08-H18-HTTP-20261120-PUBLIC' AND owner_id=v_owner;
 SELECT id INTO STRICT v_priv FROM public.clubs
 WHERE name='TASK08-H18-HTTP-20261120-PRIVATE' AND owner_id=v_owner;
 SELECT l.id INTO STRICT v_public_req FROM public.player_profile_link_requests l
 JOIN public.club_members cm ON cm.id=l.source_club_member_id
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE l.club_id=v_pub AND l.target_auth_user_id=v_recipient AND
 l.requested_by_auth_user_id=v_owner AND l.status='pending'
 AND cm.club_display_name='H18-HTTP-PUBLIC-ALIAS'
 AND pp.display_name='H18-HTTP-PUBLIC-PROFILE'
 AND pp.linked_auth_user_id IS NULL AND cm.is_active AND pp.is_active;
 SELECT l.id INTO STRICT v_private_req FROM public.player_profile_link_requests l
 JOIN public.club_members cm ON cm.id=l.source_club_member_id
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE l.club_id=v_priv AND l.target_auth_user_id=v_recipient
 AND l.requested_by_auth_user_id=v_owner AND l.status='pending'
 AND cm.club_display_name IS NULL AND pp.display_name='H18-HTTP-PRIVATE-PROFILE'
 AND pp.linked_auth_user_id IS NULL AND cm.is_active AND pp.is_active;
 PERFORM set_config('h18_jwt.owner',v_owner::text,true);
 PERFORM set_config('h18_jwt.recipient',v_recipient::text,true);
 PERFORM set_config('h18_jwt.pub',v_pub::text,true);
 PERFORM set_config('h18_jwt.priv',v_priv::text,true);
 PERFORM set_config('h18_jwt.pub_req',v_public_req::text,true);
 PERFORM set_config('h18_jwt.priv_req',v_private_req::text,true);
END $seed$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h18_jwt.recipient'),true);
DO $approve_public$
DECLARE v jsonb;r jsonb;
BEGIN
 v:=public.get_player_profile_link_request(current_setting('h18_jwt.pub_req')::uuid);
 IF v->>'group_display_name_suggestion'<>'H18-HTTP-PUBLIC-ALIAS' THEN
  RAISE EXCEPTION 'H18 real JWT pending group alias preview changed'; END IF;
 r:=public.review_player_profile_link_named(current_setting('h18_jwt.pub_req')::uuid,
 v->>'review_token','H18-HTTP-CONFIRMED-PUBLIC',v->>'group_display_name_current',true);
 IF r->>'status'<>'approved' OR r->>'club_display_name'<>'H18-HTTP-CONFIRMED-PUBLIC'
 OR (r->>'public_name_confirmed')::boolean IS NOT TRUE THEN
 RAISE EXCEPTION 'H18 real JWT public approval mismatch'; END IF;
END $approve_public$;
DO $approve_private$
DECLARE v jsonb;r jsonb;
BEGIN
 v:=public.get_player_profile_link_request(current_setting('h18_jwt.priv_req')::uuid);
 IF v->>'group_display_name_suggestion'<>'H18-HTTP-PRIVATE-PROFILE'
 OR v->>'group_visibility'<>'private'
 THEN RAISE EXCEPTION 'H18 real JWT pending private preview changed'; END IF;
 r:=public.review_player_profile_link_named(current_setting('h18_jwt.priv_req')::uuid,
 v->>'review_token','H18-HTTP-PRIVATE-CHOICE',NULL,false);
 IF r->>'status'<>'approved' OR r->>'club_display_name'<>'H18-HTTP-PRIVATE-CHOICE'
 OR (r->>'public_name_confirmed')::boolean IS TRUE THEN
 RAISE EXCEPTION 'H18 real JWT private approval mismatch'; END IF;
END $approve_private$;
RESET ROLE;

SELECT jsonb_build_object(
 'rollback_only',true,
 'approved_both',(SELECT count(*)=2 FROM public.player_profile_link_requests
   WHERE id IN(current_setting('h18_jwt.pub_req')::uuid,current_setting('h18_jwt.priv_req')::uuid)
   AND status='approved'),
 'public_name_and_consent',(SELECT count(*)=1 FROM public.club_members cm
  JOIN public.player_profile_link_requests l ON l.source_club_member_id=cm.id
  JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
  WHERE l.id=current_setting('h18_jwt.pub_req')::uuid
  AND cm.club_display_name='H18-HTTP-CONFIRMED-PUBLIC'
  AND cm.club_display_name_public_confirmed_at IS NOT NULL
  AND pp.linked_auth_user_id=current_setting('h18_jwt.recipient')::uuid),
 'private_name_not_public',(SELECT count(*)=1 FROM public.club_members cm
  JOIN public.player_profile_link_requests l ON l.source_club_member_id=cm.id
  JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
  WHERE l.id=current_setting('h18_jwt.priv_req')::uuid
  AND cm.club_display_name='H18-HTTP-PRIVATE-CHOICE'
  AND cm.club_display_name_public_confirmed_at IS NULL
  AND pp.linked_auth_user_id=current_setting('h18_jwt.recipient')::uuid),
 'receiver_choices_on_requests',(SELECT count(*)=2 FROM public.player_profile_link_requests l
  WHERE (l.id=current_setting('h18_jwt.pub_req')::uuid
     AND l.club_display_name_selected='H18-HTTP-CONFIRMED-PUBLIC'
     AND l.club_display_name_public_confirmed_at IS NOT NULL)
  OR (l.id=current_setting('h18_jwt.priv_req')::uuid
     AND l.club_display_name_selected='H18-HTTP-PRIVATE-CHOICE'
     AND l.club_display_name_public_confirmed_at IS NULL)),
 'audit_snapshots_accurate',(SELECT count(*)=2
 FROM public.player_profile_merges m JOIN profile_link_private.merge_changes changes
 ON changes.merge_id=m.id JOIN public.player_profile_link_requests l ON l.id=m.link_request_id
 JOIN public.club_members cm ON cm.id=l.source_club_member_id
 WHERE l.id IN(current_setting('h18_jwt.pub_req')::uuid,current_setting('h18_jwt.priv_req')::uuid)
  AND changes.source_schema='public' AND changes.source_table='club_members'
  AND changes.row_id=cm.id AND changes.after_row=to_jsonb(cm)
  AND changes.before_row->>'club_display_name' IS DISTINCT FROM cm.club_display_name),
 'public_name_only_after_approval',(SELECT count(*)=1 FROM public.get_public_club_directory(current_setting('h18_jwt.pub')::uuid))
) AS report;
ROLLBACK;