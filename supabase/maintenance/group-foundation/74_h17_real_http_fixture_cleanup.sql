-- TASK-08/H17 STAGING ONLY: exact cleanup for synthetic join Auth HTTP fixture.
-- Handles 0-2 pending test submissions, never deletes existing Auth users or profiles.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $cleanup$
DECLARE v_owner uuid;v_recipient uuid;v_outsider uuid;v_club uuid;v_player uuid;
        v_join_ids uuid[];v_count integer;v_deleted integer;v_fk record;v_member record;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H17 cleanup denied outside postgres'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_recipient FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_outsider FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_club FROM public.clubs
 WHERE name='TASK08-H17-HTTP-20261120-PUBLIC' AND owner_id=v_owner
 AND visibility='public' AND is_active AND NOT coalesce(is_deleted,false);
 SELECT id INTO STRICT v_player FROM public.player_profiles
 WHERE display_name='TASK08-H17-HTTP-UNLINKED'
   AND created_by_auth_user_id=v_owner AND linked_auth_user_id IS NULL AND is_active;

 IF (SELECT count(*) FROM public.clubs)<>4
 OR (SELECT count(*) FROM public.club_members)<>14
 OR (SELECT count(*) FROM public.player_profiles)<>13
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.player_profile_merges)<>0
 OR (SELECT count(*) FROM public.player_profile_link_requests WHERE status='pending')<>0
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_club)<>2
 OR (SELECT count(*) FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
   WHERE cm.club_id=v_club AND cm.role='main_admin' AND cm.is_active AND cm.status='active'
     AND pp.linked_auth_user_id=v_owner)<>1
 OR (SELECT count(*) FROM public.club_members cm WHERE cm.club_id=v_club AND cm.player_profile_id=v_player
     AND cm.role='member' AND cm.profile_id IS NULL AND cm.is_active AND cm.status='active'
     AND cm.club_display_name='H17 Public Provisional Alias')<>1
 OR (SELECT count(*) FROM public.club_members WHERE player_profile_id=v_player AND club_id<>v_club)<>0
 OR (SELECT count(*) FROM public.event_participants WHERE player_profile_id=v_player)<>0
 OR (SELECT count(*) FROM public.join_requests WHERE club_id<>v_club)<>0
 OR (SELECT count(*) FROM public.join_requests WHERE club_id=v_club) > 2
 OR EXISTS (SELECT 1 FROM public.join_requests
   WHERE club_id=v_club AND
     (status<>'pending' OR reviewed_at IS NOT NULL OR reviewed_by_auth_user_id IS NOT NULL
     OR requester_auth_user_id NOT IN (v_recipient,v_outsider)
     OR club_display_name_requested NOT IN ('H17 HTTP Recipient Alias','H17 HTTP Outsider Alias')
     OR club_display_name_confirmed_at IS NULL))
 THEN RAISE EXCEPTION 'H17 cleanup stage fixture drift: refuse to delete'; END IF;

 SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO v_join_ids
 FROM public.join_requests WHERE club_id=v_club;
 IF (SELECT count(DISTINCT requester_auth_user_id)
   FROM public.join_requests WHERE club_id=v_club)
   <> cardinality(v_join_ids) THEN
   RAISE EXCEPTION 'H17 duplicate fixture requests: refuse cleanup';
 END IF;

 -- Refuse cascade if any other business record unexpectedly references club.
 FOR v_fk IN
 SELECT ns.nspname schema_name,cl.relname table_name,a.attname column_name
 FROM pg_constraint fk JOIN pg_class cl ON cl.oid=fk.conrelid
 JOIN pg_namespace ns ON ns.oid=cl.relnamespace
 JOIN pg_attribute a ON a.attrelid=cl.oid AND a.attnum=fk.conkey[1]
 WHERE fk.contype='f' AND fk.confrelid='public.clubs'::regclass
   AND cl.oid NOT IN('public.club_members'::regclass,'public.join_requests'::regclass,'public.notifications'::regclass)
 LOOP
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',v_fk.schema_name,v_fk.table_name,v_fk.column_name)
   INTO v_count USING v_club;
  IF v_count<>0 THEN RAISE EXCEPTION 'H17 unexpected related club business rows'; END IF;
 END LOOP;
 FOR v_member IN SELECT id FROM public.club_members WHERE club_id=v_club FOR UPDATE LOOP
  FOR v_fk IN
  SELECT ns.nspname schema_name,cl.relname table_name,a.attname column_name
  FROM pg_constraint fk JOIN pg_class cl ON cl.oid=fk.conrelid
  JOIN pg_namespace ns ON ns.oid=cl.relnamespace
  JOIN pg_attribute a ON a.attrelid=cl.oid AND a.attnum=fk.conkey[1]
  WHERE fk.contype='f' AND fk.confrelid='public.club_members'::regclass
    AND cl.oid NOT IN('group_read_private.directory_refs'::regclass,'public.join_requests'::regclass)
  LOOP
   EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',v_fk.schema_name,v_fk.table_name,v_fk.column_name)
     INTO v_count USING v_member.id;
   IF v_count<>0 THEN RAISE EXCEPTION 'H17 unexpected related member business rows'; END IF;
  END LOOP;
 END LOOP;

 -- Notification rows are solely tied to this synthetic club or its two requests.
 IF EXISTS(SELECT 1 FROM public.notifications WHERE related_join_request_id=ANY(v_join_ids)
  AND related_club_id IS DISTINCT FROM v_club) THEN
  RAISE EXCEPTION 'H17 notification relation drift'; END IF;
 DELETE FROM public.notifications WHERE related_club_id=v_club OR related_join_request_id=ANY(v_join_ids);
 DELETE FROM public.join_requests WHERE club_id=v_club AND id=ANY(v_join_ids);
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 IF v_deleted<>cardinality(v_join_ids) THEN RAISE EXCEPTION 'H17 request cleanup count mismatch'; END IF;
 DELETE FROM public.clubs WHERE id=v_club;
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 IF v_deleted<>1 OR EXISTS(SELECT 1 FROM public.club_members WHERE club_id=v_club)
 THEN RAISE EXCEPTION 'H17 fixture group cleanup mismatch'; END IF;
 DELETE FROM public.player_profiles WHERE id=v_player;
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 IF v_deleted<>1 THEN RAISE EXCEPTION 'H17 fixture provisional cleanup mismatch'; END IF;
END $cleanup$;
SELECT jsonb_build_object('stage_cleanup_only',true,
 'clubs',(SELECT count(*) FROM public.clubs),
 'members',(SELECT count(*) FROM public.club_members),
 'profiles',(SELECT count(*) FROM public.player_profiles),
 'requests',(SELECT count(*) FROM public.join_requests),
 'notifications',(SELECT count(*) FROM public.notifications),
 'fixture_clubs',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H17-HTTP-20261120-PUBLIC'),
 'fixture_profiles',(SELECT count(*) FROM public.player_profiles WHERE display_name='TASK08-H17-HTTP-UNLINKED')
) report;
COMMIT;