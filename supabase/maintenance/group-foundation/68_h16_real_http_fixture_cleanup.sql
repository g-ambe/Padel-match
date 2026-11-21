-- H16 exact stage-only synthetic fixture cleanup; never apply on production.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $cleanup$
DECLARE v_owner uuid;v_sub uuid;v_member uuid;v_ownerpp uuid;v_subpp uuid;v_memberpp uuid;
 v_public uuid;v_private uuid;v_unlinked uuid;v_deleted integer;v_fk record;v_check_count integer;
 v_mid record;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H16 cleanup owner must be postgres'; END IF;
 SELECT id INTO STRICT v_owner FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_sub FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_member FROM auth.users WHERE lower(email)='recipient@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT v_ownerpp FROM public.player_profiles WHERE linked_auth_user_id=v_owner AND is_active;
 SELECT id INTO STRICT v_subpp FROM public.player_profiles WHERE linked_auth_user_id=v_sub AND is_active;
 SELECT id INTO STRICT v_memberpp FROM public.player_profiles WHERE linked_auth_user_id=v_member AND is_active;
 SELECT id INTO STRICT v_public FROM public.clubs WHERE
  name='TASK08-H16-HTTP-20261120-PUBLIC' AND owner_id=v_owner AND visibility='public' AND is_active AND NOT coalesce(is_deleted,false);
 SELECT id INTO STRICT v_private FROM public.clubs WHERE
  name='TASK08-H16-HTTP-20261120-PRIVATE' AND owner_id=v_owner AND visibility='private' AND is_active AND NOT coalesce(is_deleted,false);
 SELECT id INTO STRICT v_unlinked FROM public.player_profiles WHERE
  display_name='TASK08-H16-HTTP-UNLINKED' AND created_by_auth_user_id=v_owner
  AND linked_auth_user_id IS NULL AND is_active;
 IF (SELECT count(*) FROM public.clubs)<>5
 OR (SELECT count(*) FROM public.club_members)<>18
 OR (SELECT count(*) FROM public.player_profiles)<>13
 OR (SELECT count(*) FROM public.events)<>0
 OR (SELECT count(*) FROM public.join_requests WHERE status='pending')<>0
 OR (SELECT count(*) FROM public.club_members WHERE club_id IN(v_public,v_private))<>6
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_public AND is_active AND status='active')<>4
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_private AND is_active AND status='active')<>2
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_public AND role='main_admin' AND profile_id=v_owner AND player_profile_id=v_ownerpp)<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_public AND role='sub_admin' AND profile_id=v_sub AND player_profile_id=v_subpp)<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_public AND role='member' AND profile_id=v_member AND player_profile_id=v_memberpp)<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_public AND role='member' AND profile_id IS NULL AND player_profile_id=v_unlinked)<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_private AND role='main_admin' AND profile_id=v_owner AND player_profile_id=v_ownerpp)<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=v_private AND role='member' AND profile_id=v_member AND player_profile_id=v_memberpp)<>1
 OR (SELECT count(*) FROM public.club_members WHERE player_profile_id=v_unlinked AND club_id<>v_public)<>0
 THEN RAISE EXCEPTION 'H16 fixture drift: cleanup refused'; END IF;

 FOR v_fk IN
  SELECT ns.nspname schema_name,cl.relname table_name,att.attname column_name
  FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
  JOIN pg_namespace ns ON ns.oid=cl.relnamespace
  JOIN pg_attribute att ON att.attrelid=cl.oid AND att.attnum=con.conkey[1]
  WHERE con.contype='f' AND con.confrelid='public.clubs'::regclass
    AND con.conrelid<>'public.club_members'::regclass
 LOOP
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=ANY($1)',v_fk.schema_name,v_fk.table_name,v_fk.column_name)
   INTO v_check_count USING ARRAY[v_public,v_private];
  IF v_check_count<>0 THEN RAISE EXCEPTION 'H16 unexpected dependent club records'; END IF;
 END LOOP;

 FOR v_mid IN SELECT id FROM public.club_members WHERE club_id IN(v_public,v_private) FOR UPDATE
 LOOP
  FOR v_fk IN SELECT ns.nspname schema_name,cl.relname table_name,att.attname column_name
  FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
  JOIN pg_namespace ns ON ns.oid=cl.relnamespace
  JOIN pg_attribute att ON att.attrelid=cl.oid AND att.attnum=con.conkey[1]
  WHERE con.contype='f' AND con.confrelid='public.club_members'::regclass
    AND con.conrelid<>'group_read_private.directory_refs'::regclass
  LOOP
   EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',v_fk.schema_name,v_fk.table_name,v_fk.column_name)
     INTO v_check_count USING v_mid.id;
   IF v_check_count<>0 THEN RAISE EXCEPTION 'H16 unexpected member dependencies'; END IF;
  END LOOP;
 END LOOP;

 DELETE FROM public.clubs WHERE id IN(v_public,v_private);
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 IF v_deleted<>2 OR EXISTS(SELECT 1 FROM public.club_members WHERE club_id IN(v_public,v_private))
 THEN RAISE EXCEPTION 'H16 cleanup club/membership count mismatch'; END IF;

 DELETE FROM public.player_profiles WHERE id=v_unlinked;
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 IF v_deleted<>1 THEN RAISE EXCEPTION 'H16 cleanup temporary profile count mismatch'; END IF;
END $cleanup$;

SELECT jsonb_build_object('stage_only',true,
  'clubs',(SELECT count(*) FROM public.clubs),
  'members',(SELECT count(*) FROM public.club_members),
  'profiles',(SELECT count(*) FROM public.player_profiles),
  'events',(SELECT count(*) FROM public.events),
  'fixture_clubs',(SELECT count(*) FROM public.clubs WHERE name LIKE 'TASK08-H16-HTTP-20261120-%'),
  'fixture_profiles',(SELECT count(*) FROM public.player_profiles WHERE display_name='TASK08-H16-HTTP-UNLINKED'),
  'linked_legacy_aliases',(SELECT count(*) FROM public.club_members WHERE club_display_name IS NOT NULL)
) report;
COMMIT;