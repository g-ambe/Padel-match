-- TASK-08-03/H15: STAGING ONLY exact one-shot fixture cleanup.
-- Do not delete real users/profiles, unrelated clubs, or historical match records.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='35s';
DO $cleanup$
DECLARE v_owner uuid;v_sub uuid;v_member uuid;
        v_owner_pp uuid;v_sub_pp uuid;v_member_pp uuid;v_club uuid;
        v_count integer;v_fk record;v_row record;v_deleted integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H15 cleanup owner denied'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_sub FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_member FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_owner_pp FROM public.player_profiles WHERE linked_auth_user_id=v_owner AND is_active;
 SELECT id INTO STRICT v_sub_pp FROM public.player_profiles WHERE linked_auth_user_id=v_sub AND is_active;
 SELECT id INTO STRICT v_member_pp FROM public.player_profiles WHERE linked_auth_user_id=v_member AND is_active;
 SELECT id INTO STRICT v_club FROM public.clubs
 WHERE name='TASK08-H15-SELF-EXIT-HTTP-20261119' AND owner_id=v_owner
 AND is_active AND NOT coalesce(is_deleted,false) AND visibility='private';
 IF (SELECT count(*) FROM public.clubs)<>4
 OR (SELECT count(*) FROM public.club_members)<>15
 OR (SELECT count(*) FROM public.player_profiles)<>12
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_club)<>3
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_club AND role='main_admin'
       AND profile_id=v_owner AND player_profile_id=v_owner_pp AND is_active AND status='active')<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_club AND role='sub_admin'
       AND profile_id=v_sub AND player_profile_id=v_sub_pp AND status='active')<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_club AND role='member'
       AND profile_id=v_member AND player_profile_id=v_member_pp AND status='active')<>1
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0
 THEN RAISE EXCEPTION 'H15 fixture drift: no cleanup'; END IF;

 -- Never silently cascade through other business records.
 FOR v_fk IN
  SELECT ns.nspname AS schema_name,cl.relname AS table_name,att.attname AS column_name
  FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
  JOIN pg_namespace ns ON ns.oid=cl.relnamespace
  JOIN pg_attribute att ON att.attrelid=cl.oid AND att.attnum=con.conkey[1]
  WHERE con.contype='f' AND con.confrelid='public.clubs'::regclass
    AND con.conrelid<>'public.club_members'::regclass
 LOOP
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',v_fk.schema_name,v_fk.table_name,v_fk.column_name)
    INTO v_count USING v_club;
  IF v_count<>0 THEN RAISE EXCEPTION 'H15 unexpected related club records'; END IF;
 END LOOP;
 FOR v_row IN SELECT id FROM public.club_members WHERE club_id=v_club FOR UPDATE
 LOOP
  FOR v_fk IN
    SELECT ns.nspname AS schema_name,cl.relname AS table_name,att.attname AS column_name
    FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
    JOIN pg_namespace ns ON ns.oid=cl.relnamespace
    JOIN pg_attribute att ON att.attrelid=cl.oid AND att.attnum=con.conkey[1]
    WHERE con.contype='f' AND con.confrelid='public.club_members'::regclass
      AND con.conrelid<>'group_read_private.directory_refs'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',v_fk.schema_name,v_fk.table_name,v_fk.column_name)
     INTO v_count USING v_row.id;
    IF v_count<>0 THEN RAISE EXCEPTION 'H15 unexpected related member records'; END IF;
  END LOOP;
 END LOOP;
 DELETE FROM public.clubs WHERE id=v_club;
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 IF v_deleted<>1 OR EXISTS (SELECT 1 FROM public.club_members WHERE club_id=v_club)
 THEN RAISE EXCEPTION 'H15 cleanup count mismatch'; END IF;
END $cleanup$;
SELECT jsonb_build_object(
 'stage_cleanup_only',true,
 'fixture_clubs',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H15-SELF-EXIT-HTTP-20261119'),
 'clubs',(SELECT count(*) FROM public.clubs),
 'members',(SELECT count(*) FROM public.club_members),
 'profiles',(SELECT count(*) FROM public.player_profiles),
 'events',(SELECT count(*) FROM public.events)
) AS report;
COMMIT;