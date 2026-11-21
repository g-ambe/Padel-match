-- H19 STAGE ONLY: exact guarded cleanup for synthetic Auth HTTP owner transfer.
-- Refuse unrelated rows, new owner, role drift, or history before deletion.
BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='45s';
DO $cleanup$
DECLARE a uuid;b uuid;c uuid;club uuid;n integer;total integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H19 cleanup postgres only';END IF;
 SELECT id INTO STRICT a FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT b FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT c FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT club FROM public.clubs WHERE name='TASK08-H19-HTTP-20261120'
 AND owner_id=a AND is_active AND NOT coalesce(is_deleted,false);
 IF (SELECT count(*) FROM public.clubs)<>4 OR (SELECT count(*) FROM public.club_members)<>15
 OR (SELECT count(*) FROM public.player_profiles)<>12 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.player_profile_merges)<>0
 OR (SELECT count(*) FROM public.club_members WHERE club_id=club)<>3
 OR (SELECT count(*) FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
 WHERE cm.club_id=club AND cm.is_active AND cm.status='active'
 AND ((cm.role='main_admin' AND pp.linked_auth_user_id IN(a,b))
 OR (cm.role='member' AND pp.linked_auth_user_id=c)))<>3
 OR EXISTS(SELECT 1 FROM public.club_owner_transfer_requests WHERE club_id<>club)
 OR EXISTS(SELECT 1 FROM public.club_owner_transfer_requests r
 WHERE r.club_id=club AND (r.from_auth_user_id<>a OR r.to_auth_user_id<>b
 OR r.from_member_id NOT IN (SELECT id FROM public.club_members WHERE club_id=club AND profile_id=a)
 OR r.to_member_id NOT IN (SELECT id FROM public.club_members WHERE club_id=club AND profile_id=b)
 OR r.status NOT IN ('pending','declined')))
 OR (SELECT count(*) FROM public.club_owner_transfer_requests WHERE club_id=club)>2
 OR (SELECT count(*) FROM public.notifications)>3
 OR EXISTS(SELECT 1 FROM public.notifications n WHERE n.related_club_id IS DISTINCT FROM club
 OR n.related_owner_transfer_request_id IS NULL
 OR n.type NOT IN('club_owner_transfer_requested','club_owner_transfer_declined')
 OR n.target_auth_user_id NOT IN(a,b))
 THEN RAISE EXCEPTION 'H19 fixture changed; refuse cleanup';END IF;
 DELETE FROM public.notifications WHERE related_club_id=club;
 DELETE FROM public.club_owner_transfer_requests WHERE club_id=club;
 DELETE FROM public.clubs WHERE id=club;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 OR (SELECT count(*) FROM public.club_members WHERE club_id=club)<>0
 THEN RAISE EXCEPTION 'H19 club cleanup failed';END IF;
END $cleanup$;
SELECT jsonb_build_object('cleanup_only',true,
 'clubs',(SELECT count(*) FROM public.clubs),
 'members',(SELECT count(*) FROM public.club_members),
 'profiles',(SELECT count(*) FROM public.player_profiles),
 'owner_requests',(SELECT count(*) FROM public.club_owner_transfer_requests),
 'notifications',(SELECT count(*) FROM public.notifications),
 'synthetic_clubs',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H19-HTTP-20261120')) report;
COMMIT;