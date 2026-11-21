-- H18 STAGING ONLY exact cleanup for synthetic public/private Auth HTTP fixture.
-- Do not run against Prod. Refuses unexpected side effects; never deletes Auth users.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $cleanup$
DECLARE v_owner uuid;v_recipient uuid;v_pub uuid;v_priv uuid;
 v_pp uuid;v_pr uuid;v_request_ids uuid[];v_count integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H18 cleanup postgres only'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users
 WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_recipient FROM auth.users
 WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_pub FROM public.clubs
 WHERE name='TASK08-H18-HTTP-20261120-PUBLIC' AND owner_id=v_owner
 AND is_active AND NOT coalesce(is_deleted,false) AND visibility='public';
 SELECT id INTO STRICT v_priv FROM public.clubs
 WHERE name='TASK08-H18-HTTP-20261120-PRIVATE' AND owner_id=v_owner
 AND is_active AND NOT coalesce(is_deleted,false) AND visibility='private';
 SELECT id INTO STRICT v_pp FROM public.player_profiles
 WHERE display_name='H18-HTTP-PUBLIC-PROFILE'
   AND created_by_auth_user_id=v_owner AND is_active AND linked_auth_user_id IS NULL;
 SELECT id INTO STRICT v_pr FROM public.player_profiles
 WHERE display_name='H18-HTTP-PRIVATE-PROFILE'
   AND created_by_auth_user_id=v_owner AND is_active AND linked_auth_user_id IS NULL;

 IF (SELECT count(*) FROM public.clubs)<>5
 OR (SELECT count(*) FROM public.club_members)<>16
 OR (SELECT count(*) FROM public.player_profiles)<>14
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.player_profile_merges)<>0
 OR (SELECT count(*) FROM public.club_members WHERE club_id IN(v_pub,v_priv))<>4
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_pub AND player_profile_id=v_pp
     AND club_display_name='H18-HTTP-PUBLIC-ALIAS' AND is_active AND role='member')<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_priv AND player_profile_id=v_pr
     AND club_display_name IS NULL AND is_active AND role='member')<>1
 OR (SELECT count(*) FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
     WHERE cm.club_id IN(v_pub,v_priv) AND cm.role='main_admin'
       AND pp.linked_auth_user_id=v_owner AND cm.is_active AND cm.status='active')<>2
 OR EXISTS(SELECT 1 FROM public.club_members
     WHERE player_profile_id IN(v_pp,v_pr) AND club_id NOT IN(v_pub,v_priv))
 OR EXISTS(SELECT 1 FROM public.player_profile_link_requests
     WHERE club_id NOT IN(v_pub,v_priv))
 OR (SELECT count(*) FROM public.player_profile_link_requests
     WHERE club_id IN(v_pub,v_priv))>2
 OR EXISTS(SELECT 1 FROM public.player_profile_link_requests
     WHERE club_id IN(v_pub,v_priv) AND
     (target_auth_user_id<>v_recipient OR requested_by_auth_user_id<>v_owner
      OR status<>'pending' OR reviewed_at IS NOT NULL
      OR club_display_name_selected IS NOT NULL
      OR club_display_name_public_confirmed_at IS NOT NULL
      OR (club_id=v_pub AND source_player_profile_id<>v_pp)
      OR (club_id=v_priv AND source_player_profile_id<>v_pr)))
 THEN RAISE EXCEPTION 'H18 cleanup fixture or pending requests drift'; END IF;
 SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_request_ids
 FROM public.player_profile_link_requests WHERE club_id IN(v_pub,v_priv);

 IF (SELECT count(*) FROM public.notifications)>cardinality(v_request_ids)
 OR EXISTS(SELECT 1 FROM public.notifications
   WHERE type<>'profile_link_requested'
   OR target_auth_user_id<>v_recipient
   OR related_profile_link_request_id IS NULL
   OR related_profile_link_request_id<>ALL(v_request_ids)
   OR related_club_id NOT IN(v_pub,v_priv))
 THEN RAISE EXCEPTION 'H18 fixture notifications drift'; END IF;

 DELETE FROM public.notifications WHERE related_profile_link_request_id=ANY(v_request_ids);
 DELETE FROM public.player_profile_link_requests WHERE id=ANY(v_request_ids);
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>cardinality(v_request_ids) THEN RAISE EXCEPTION 'H18 requests deletion mismatch'; END IF;

 DELETE FROM public.clubs WHERE id IN(v_pub,v_priv);
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>2 OR EXISTS(SELECT 1 FROM public.club_members WHERE club_id IN(v_pub,v_priv))
 THEN RAISE EXCEPTION 'H18 club deletion mismatch'; END IF;
 DELETE FROM public.player_profiles WHERE id IN(v_pp,v_pr);
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>2 THEN RAISE EXCEPTION 'H18 synthetic profiles deletion mismatch'; END IF;
END $cleanup$;
SELECT jsonb_build_object('stage_cleanup_only',true,
 'clubs',(SELECT count(*) FROM public.clubs),
 'members',(SELECT count(*) FROM public.club_members),
 'profiles',(SELECT count(*) FROM public.player_profiles),
 'link_requests',(SELECT count(*) FROM public.player_profile_link_requests),
 'merges',(SELECT count(*) FROM public.player_profile_merges),
 'notifications',(SELECT count(*) FROM public.notifications),
 'fixture_clubs',(SELECT count(*) FROM public.clubs WHERE name LIKE 'TASK08-H18-HTTP-20261120-%')
) report;
COMMIT;