-- TASK-08 H08: STAGING ONLY, cleanup the exact pending cross-club public-claim fixture.
-- Stop if request was approved/cancelled/merged or any unexpected unrelated row exists.
-- Only pending join request and its directly related notification(s) are removed.
-- Never delete clubs, profiles, memberships, user identities, or matches.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $cleanup$
DECLARE rid uuid; n_count int; n_removed int; req_removed int; user_id uuid;main_id uuid;source_id uuid;v_club_id uuid;member_id uuid;target_id uuid;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'postgres required'; END IF;
 SELECT id INTO STRICT user_id FROM auth.users WHERE lower(email)='outsider@example.com';
 SELECT id INTO STRICT main_id FROM auth.users WHERE lower(email)='main-a@example.com';
 SELECT id INTO STRICT source_id FROM public.player_profiles
  WHERE display_name='TASK08-P0 provisional U' AND linked_auth_user_id IS NULL AND is_active;
 SELECT id INTO STRICT v_club_id FROM public.clubs WHERE name='TASK08-P0-20261119-A';
 SELECT cm.id INTO STRICT member_id FROM public.club_members cm
  WHERE cm.club_id=v_club_id AND cm.player_profile_id=source_id AND cm.is_active;
 SELECT id INTO STRICT target_id FROM public.player_profiles WHERE linked_auth_user_id=user_id AND is_active;
 IF (SELECT count(*) FROM public.join_requests jr
  WHERE jr.club_id=v_club_id AND jr.target_club_member_id=member_id
    AND jr.requester_auth_user_id=user_id
    AND jr.consent_source_player_profile_id=source_id AND jr.status='pending'
    AND jr.consent_at IS NOT NULL AND jr.consent_snapshot IS NOT NULL
    AND jr.message='TASK08 isolated H08 negative HTTP review')<>1
 THEN RAISE EXCEPTION 'H08 exact fixture request not pending; abort cleanup'; END IF;
 SELECT jr.id INTO STRICT rid FROM public.join_requests jr
 WHERE jr.club_id=v_club_id AND jr.target_club_member_id=member_id
  AND jr.requester_auth_user_id=user_id
  AND jr.consent_source_player_profile_id=source_id
  AND jr.status='pending' AND jr.message='TASK08 isolated H08 negative HTTP review'
 FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.player_profile_merges m WHERE m.join_request_id=rid)
 OR (SELECT count(*) FROM public.club_members cm WHERE cm.player_profile_id=source_id)<>2
 OR EXISTS(SELECT 1 FROM public.club_members cm WHERE cm.player_profile_id=target_id)
 THEN RAISE EXCEPTION 'H08 unexpected merge or membership change; abort cleanup'; END IF;
 SELECT count(*) INTO n_count FROM public.notifications n
 WHERE n.related_join_request_id=rid;
 IF n_count<1 OR n_count>4 THEN RAISE EXCEPTION 'H08 unexpected notification count; abort cleanup'; END IF;
 DELETE FROM public.notifications WHERE related_join_request_id=rid;
 GET DIAGNOSTICS n_removed=ROW_COUNT;
 DELETE FROM public.join_requests WHERE id=rid AND status='pending';
 GET DIAGNOSTICS req_removed=ROW_COUNT;
 IF n_removed<>n_count OR req_removed<>1 THEN RAISE EXCEPTION 'H08 cleanup count mismatch'; END IF;
 PERFORM set_config('task08.notifications_deleted',n_removed::text,true);
END $cleanup$;
SELECT jsonb_build_object(
 'fixture_join_request_removed',true,
 'related_notifications_removed',current_setting('task08.notifications_deleted')::int,
 'pending_join_requests',(SELECT count(*) FROM public.join_requests WHERE status='pending'),
 'active_merges',(SELECT count(*) FROM public.player_profile_merges WHERE restored_at IS NULL)
) AS report;
COMMIT;
