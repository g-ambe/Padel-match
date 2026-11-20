-- H19 STAGE ONLY: exact cleanup of race test fixture (accepted OR cancelled).
-- This cleanup is designed for the single synthetic group from fixture 88.
-- It refuses to touch other groups, user profiles, match data or Auth accounts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $clean$
DECLARE a uuid;b uuid;c uuid;club uuid;owner uuid;status text;rid uuid;n integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Stage-only cleanup requires postgres'; END IF;
 SELECT id INTO STRICT a FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT b FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT c FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id,owner_id INTO STRICT club,owner FROM public.clubs
 WHERE name='TASK08-H19-HTTP-20261120' AND is_active AND NOT coalesce(is_deleted,false);
 SELECT id,status INTO STRICT rid,status FROM public.club_owner_transfer_requests
 WHERE club_id=club;
 IF status NOT IN ('accepted','cancelled')
 OR (status='accepted' AND owner IS DISTINCT FROM b)
 OR (status='cancelled' AND owner IS DISTINCT FROM a)
 OR (SELECT count(*) FROM public.clubs)<>4
 OR (SELECT count(*) FROM public.club_members)<>15
 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.player_profile_merges)<>0
 OR (SELECT count(*) FROM public.club_owner_transfer_requests)<>1
 OR (SELECT count(*) FROM public.notifications)<>2
 OR (SELECT count(*) FROM public.club_members WHERE club_id=club)<>3
 OR (SELECT count(*) FROM public.club_members cm
  JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
  WHERE cm.club_id=club AND cm.is_active AND cm.status='active' AND pp.is_active
  AND ((cm.role='main_admin' AND pp.linked_auth_user_id IN(a,b))
   OR (cm.role='member' AND pp.linked_auth_user_id=c)))<>3
 OR EXISTS(SELECT 1 FROM public.club_owner_transfer_requests r
  WHERE r.id=rid AND (r.from_auth_user_id<>a OR r.to_auth_user_id<>b
   OR r.responded_at IS NULL OR r.from_member_id NOT IN(
     SELECT id FROM public.club_members WHERE club_id=club AND profile_id=a)
   OR r.to_member_id NOT IN(
     SELECT id FROM public.club_members WHERE club_id=club AND profile_id=b)))
 OR EXISTS(SELECT 1 FROM public.notifications n
   WHERE n.related_owner_transfer_request_id IS DISTINCT FROM rid
     OR n.related_club_id IS DISTINCT FROM club
     OR ((n.type='club_owner_transfer_requested' AND n.target_auth_user_id<>b)
      OR (n.type='club_owner_transfer_accepted' AND (status<>'accepted' OR n.target_auth_user_id<>a))
      OR (n.type='club_owner_transfer_cancelled' AND (status<>'cancelled' OR n.target_auth_user_id<>b))
      OR n.type NOT IN ('club_owner_transfer_requested','club_owner_transfer_accepted','club_owner_transfer_cancelled')))
 THEN RAISE EXCEPTION 'H19 Stage race fixture diverged; refuse cleanup'; END IF;
 DELETE FROM public.notifications WHERE related_owner_transfer_request_id=rid;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>2 THEN RAISE EXCEPTION 'H19 notification cleanup mismatch'; END IF;
 DELETE FROM public.club_owner_transfer_requests WHERE id=rid;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'H19 request cleanup mismatch'; END IF;
 DELETE FROM public.clubs WHERE id=club;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 OR EXISTS(SELECT 1 FROM public.club_members WHERE club_id=club)
 THEN RAISE EXCEPTION 'H19 synthetic club cleanup mismatch'; END IF;
END $clean$;
SELECT jsonb_build_object('stage_race_cleanup_only',true,
'clubs',(SELECT count(*) FROM public.clubs),
'members',(SELECT count(*) FROM public.club_members),
'profiles',(SELECT count(*) FROM public.player_profiles),
'owner_transfers',(SELECT count(*) FROM public.club_owner_transfer_requests),
'notifications',(SELECT count(*) FROM public.notifications),
'fixture_clubs',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H19-HTTP-20261120')) report;
COMMIT;