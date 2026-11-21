-- TASK-08 H08: STAGING ONLY / pending cross-club consent-review HTTP fixture.
-- Sender main-A, source unlinked U belonging to club A+B, recipient outsider
-- who has no club memberships. The review must be rejected by scoped consent guard.
-- If unexpected review occurs, cleanup intentionally aborts (request no longer pending).
-- TASK-08: STAGING ONLY, remove the ONE pending link request and its normal notification
-- created by 17_link_detail_staging_http_fixture_setup.sql after read-only HTTP checks.
-- Never CASCADE. Never delete clubs, Auth users, player profiles or memberships.
-- Aborts if a different/multiple request, review, merge or notification is detected.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $cleanup$
DECLARE rid uuid; n_deleted int; r_deleted int; v_rec uuid;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'postgres required'; END IF;
 SELECT u.id INTO STRICT v_rec FROM auth.users u
 WHERE lower(u.email)='outsider@example.com' AND u.email_confirmed_at IS NOT NULL;
 IF (SELECT count(*) FROM public.player_profile_link_requests r
 JOIN public.clubs c ON c.id=r.club_id
 JOIN public.club_members cm ON cm.id=r.source_club_member_id
 JOIN public.player_profiles pp ON pp.id=r.source_player_profile_id
 WHERE c.name='TASK08-P0-20261119-A'
   AND cm.player_profile_id=pp.id
   AND pp.display_name='TASK08-P0 provisional U'
   AND r.target_auth_user_id=v_rec
   AND r.requested_by_auth_user_id=(SELECT id FROM auth.users WHERE lower(email)='main-a@example.com')
   AND r.status='pending')<>1
 THEN RAISE EXCEPTION 'expected one specific pending fixture; no deletion'; END IF;
 SELECT r.id INTO STRICT rid FROM public.player_profile_link_requests r
 JOIN public.clubs c ON c.id=r.club_id
 JOIN public.club_members cm ON cm.id=r.source_club_member_id
 JOIN public.player_profiles pp ON pp.id=r.source_player_profile_id
 WHERE c.name='TASK08-P0-20261119-A'
   AND cm.player_profile_id=pp.id
   AND pp.display_name='TASK08-P0 provisional U'
   AND r.target_auth_user_id=v_rec
   AND r.requested_by_auth_user_id=(SELECT id FROM auth.users WHERE lower(email)='main-a@example.com')
   AND r.status='pending'
 FOR UPDATE OF r;
 IF EXISTS(SELECT 1 FROM public.player_profile_merges m WHERE m.link_request_id=rid)
 OR (SELECT count(*) FROM public.notifications n WHERE n.related_profile_link_request_id=rid)<>1
 OR (SELECT count(*) FROM public.notifications n
       WHERE n.related_profile_link_request_id=rid AND n.target_auth_user_id=v_rec)<>1
 THEN RAISE EXCEPTION 'fixture already reviewed or notification state differs; abort cleanup'; END IF;
 DELETE FROM public.notifications n WHERE n.related_profile_link_request_id=rid AND n.target_auth_user_id=v_rec;
 GET DIAGNOSTICS n_deleted=ROW_COUNT;
 DELETE FROM public.player_profile_link_requests r WHERE r.id=rid AND r.status='pending';
 GET DIAGNOSTICS r_deleted=ROW_COUNT;
 IF n_deleted<>1 OR r_deleted<>1 THEN RAISE EXCEPTION 'cleanup count mismatch; rollback'; END IF;
END $cleanup$;
SELECT jsonb_build_object('fixture_cleanup_complete',true,
 'pending_link_requests',(SELECT count(*) FROM public.player_profile_link_requests WHERE status='pending'),
 'fixture_pending_notifications',(SELECT count(*) FROM public.notifications n
    JOIN public.player_profile_link_requests r ON r.id=n.related_profile_link_request_id
    JOIN public.clubs c ON c.id=r.club_id WHERE c.name='TASK08-P0-20261119-A')
) AS report;
COMMIT;
