-- TASK-08/H17: check real JWT-submitted pending requests in a single
-- ROLLBACK-only SQL transaction, including approval + profile merge audit.
-- Never approve Stage requests permanently, never use on production.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='65s';
DO $setup$
DECLARE v_owner uuid;v_recipient uuid;v_outsider uuid;v_club uuid;
 v_new uuid;v_claim uuid;v_mid uuid;v_source uuid;
BEGIN
 IF current_user<>'postgres'
 OR (SELECT count(*) FROM public.clubs)<>4
 OR (SELECT count(*) FROM public.club_members)<>14
 OR (SELECT count(*) FROM public.player_profiles)<>13
 OR (SELECT count(*) FROM public.player_profile_merges)<>0
 THEN RAISE EXCEPTION 'H17 real-request approval rollback isolation changed'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT v_recipient FROM auth.users WHERE lower(email)='recipient@example.com';
 SELECT id INTO STRICT v_outsider FROM auth.users WHERE lower(email)='outsider@example.com';
 SELECT id INTO STRICT v_club FROM public.clubs
 WHERE name='TASK08-H17-HTTP-20261120-PUBLIC' AND owner_id=v_owner
 AND is_active AND visibility='public';
 SELECT id INTO STRICT v_mid FROM public.club_members
 WHERE club_id=v_club AND club_display_name='H17 Public Provisional Alias'
 AND is_active AND role='member';
 SELECT player_profile_id INTO STRICT v_source FROM public.club_members WHERE id=v_mid;
 SELECT id INTO STRICT v_new FROM public.join_requests
 WHERE club_id=v_club AND requester_auth_user_id=v_recipient
 AND status='pending' AND target_club_member_id IS NULL
 AND club_display_name_requested='H17 HTTP Recipient Alias'
 AND club_display_name_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_claim FROM public.join_requests
 WHERE club_id=v_club AND requester_auth_user_id=v_outsider
 AND status='pending' AND target_club_member_id=v_mid
 AND club_display_name_requested='H17 HTTP Outsider Alias'
 AND club_display_name_confirmed_at IS NOT NULL
 AND consent_snapshot IS NOT NULL;
 IF (SELECT count(*) FROM public.join_requests)<>2 OR v_new=v_claim
 OR (SELECT count(*) FROM public.notifications WHERE related_club_id=v_club)<>4
 THEN RAISE EXCEPTION 'H17 real request fixture contents unexpected'; END IF;
 PERFORM set_config('h17_http.club',v_club::text,true);
 PERFORM set_config('h17_http.owner',v_owner::text,true);
 PERFORM set_config('h17_http.recipient',v_recipient::text,true);
 PERFORM set_config('h17_http.outsider',v_outsider::text,true);
 PERFORM set_config('h17_http.normal',v_new::text,true);
 PERFORM set_config('h17_http.claim',v_claim::text,true);
 PERFORM set_config('h17_http.member',v_mid::text,true);
 PERFORM set_config('h17_http.source',v_source::text,true);
END $setup$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('h17_http.owner'),true);
DO $approvals$
DECLARE r jsonb;
BEGIN
 r:=public.review_profile_join_request(current_setting('h17_http.normal')::uuid,'approved');
 IF r->>'status'<>'approved' THEN RAISE EXCEPTION 'H17 normal approval failed'; END IF;
 r:=public.review_profile_join_request(current_setting('h17_http.claim')::uuid,'approved');
 IF r->>'status'<>'approved' THEN RAISE EXCEPTION 'H17 claimed provisional approval failed'; END IF;
END $approvals$;
RESET ROLE;
SELECT jsonb_build_object(
 'rollback_only',true,
 'approved_both',(SELECT count(*)=2 FROM public.join_requests
 WHERE club_id=current_setting('h17_http.club')::uuid AND status='approved'
 AND club_display_name_confirmed_at IS NOT NULL),
 'recipient_alias_live',(SELECT count(*)=1 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=current_setting('h17_http.club')::uuid
 AND pp.linked_auth_user_id=current_setting('h17_http.recipient')::uuid
 AND cm.club_display_name='H17 HTTP Recipient Alias'
 AND cm.club_display_name_public_confirmed_at IS NOT NULL),
 'provisional_claim_alias_live',(SELECT count(*)=1 FROM public.club_members cm
 JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.id=current_setting('h17_http.member')::uuid
 AND pp.linked_auth_user_id=current_setting('h17_http.outsider')::uuid
 AND cm.club_display_name='H17 HTTP Outsider Alias'
 AND cm.club_display_name_public_confirmed_at IS NOT NULL),
 'merge_audit_before_after',(SELECT count(*)=1 FROM public.player_profile_merges pm
 JOIN profile_link_private.merge_changes c ON c.merge_id=pm.id
 WHERE pm.join_request_id=current_setting('h17_http.claim')::uuid
 AND c.source_schema='public' AND c.source_table='club_members'
 AND c.row_id=current_setting('h17_http.member')::uuid
 AND c.before_row->>'club_display_name'='H17 Public Provisional Alias'
 AND c.after_row->>'club_display_name'='H17 HTTP Outsider Alias'
 AND c.before_row->>'club_display_name_public_confirmed_at' IS NULL
 AND c.after_row->>'club_display_name_public_confirmed_at' IS NOT NULL),
 'source_profile_retired',(SELECT NOT is_active AND linked_auth_user_id IS NULL
 FROM public.player_profiles WHERE id=current_setting('h17_http.source')::uuid),
 'published_only_consented',(SELECT count(*)=2 FROM public.get_public_club_directory(current_setting('h17_http.club')::uuid)),
 'unchanged_global_profiles',(SELECT count(*)=3 FROM public.player_profiles
 WHERE linked_auth_user_id IN(current_setting('h17_http.owner')::uuid,
 current_setting('h17_http.recipient')::uuid,current_setting('h17_http.outsider')::uuid)
 AND is_active)
) report;
ROLLBACK;