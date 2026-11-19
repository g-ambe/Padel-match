-- TASK-08 H09/H10: STAGING ONLY - guarded removal of exact disposable test objects.
-- Never delete any Auth identity, real member/profile, match, or unrelated club.
-- Refuse if extra FK dependencies/records exist. No broad CASCADE.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $cleanup$
DECLARE ca uuid;ua uuid;ux uuid;pa uuid;px uuid;unlinked uuid;
    m record; child record;fk record;n int;member_deleted int;club_deleted int;player_deleted int;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'H09/H10 cleanup requires postgres'; END IF;
 SELECT id INTO STRICT ua FROM auth.users WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT ux FROM auth.users WHERE lower(email)='outsider@example.com' AND email_confirmed_at IS NOT NULL;
 SELECT id INTO STRICT pa FROM public.player_profiles WHERE linked_auth_user_id=ua AND is_active;
 SELECT id INTO STRICT px FROM public.player_profiles WHERE linked_auth_user_id=ux AND is_active;
 SELECT id INTO STRICT ca FROM public.clubs WHERE name='TASK08-H09H10-HTTP-20261119' AND owner_id=ua AND visibility='private' AND is_active;
 SELECT p.id INTO STRICT unlinked FROM public.player_profiles p
 JOIN public.club_members cm ON cm.player_profile_id=p.id
 WHERE cm.club_id=ca AND cm.profile_id IS NULL AND p.linked_auth_user_id IS NULL
   AND p.created_by_auth_user_id=ua
   AND p.display_name IN('TASK08-H09H10-HTTP-UNLINKED','TASK08-H09H10-HTTP-RENAMED');
 IF (SELECT count(*) FROM public.club_members WHERE club_id=ca)<>3
 OR (SELECT count(*) FROM public.club_members WHERE club_id=ca AND profile_id=ua AND player_profile_id=pa)<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=ca AND profile_id=ux AND player_profile_id=px)<>1
 OR (SELECT count(*) FROM public.club_members WHERE club_id=ca AND profile_id IS NULL AND player_profile_id=unlinked)<>1
 OR (SELECT count(*) FROM public.club_members WHERE player_profile_id=unlinked)<>1
 THEN RAISE EXCEPTION 'H09/H10 unexpected fixture members'; END IF;
 -- Any FK to this club other than the exact club_members is a blocker.
 FOR fk IN
  SELECT n.nspname AS schem,c.relname AS tab,a.attname AS col
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.conkey[1]
  WHERE k.contype='f' AND k.confrelid='public.clubs'::regclass AND k.conrelid<>'public.club_members'::regclass
 LOOP
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',fk.schem,fk.tab,fk.col) INTO n USING ca;
  IF n<>0 THEN RAISE EXCEPTION 'H09/H10 unexpected club dependent row in %.%',fk.schem,fk.tab; END IF;
 END LOOP;
 -- Any FK to the unlinked player other than that one membership is a blocker.
 FOR fk IN
  SELECT n.nspname AS schem,c.relname AS tab,a.attname AS col
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.conkey[1]
  WHERE k.contype='f' AND k.confrelid='public.player_profiles'::regclass AND k.conrelid<>'public.club_members'::regclass
 LOOP
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',fk.schem,fk.tab,fk.col) INTO n USING unlinked;
  IF n<>0 THEN RAISE EXCEPTION 'H09/H10 unexpected player dependent row in %.%',fk.schem,fk.tab; END IF;
 END LOOP;
 -- No child member ref other than group directory refs.
 FOR m IN SELECT id FROM public.club_members WHERE club_id=ca FOR UPDATE
 LOOP
  FOR fk IN
   SELECT n.nspname AS schem,c.relname AS tab,a.attname AS col
   FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.conkey[1]
   WHERE k.contype='f' AND k.confrelid='public.club_members'::regclass
    AND k.conrelid<>'group_read_private.directory_refs'::regclass
  LOOP
   EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',fk.schem,fk.tab,fk.col) INTO n USING m.id;
   IF n<>0 THEN RAISE EXCEPTION 'H09/H10 unexpected member child %.%',fk.schem,fk.tab; END IF;
  END LOOP;
 END LOOP;
 DELETE FROM public.clubs WHERE id=ca AND owner_id=ua;
 GET DIAGNOSTICS club_deleted=ROW_COUNT;
 DELETE FROM public.player_profiles WHERE id=unlinked AND linked_auth_user_id IS NULL;
 GET DIAGNOSTICS player_deleted=ROW_COUNT;
 IF club_deleted<>1 OR player_deleted<>1
  OR EXISTS(SELECT 1 FROM public.club_members WHERE club_id=ca)
 THEN RAISE EXCEPTION 'H09/H10 cleanup count mismatch'; END IF;
END $cleanup$;
SELECT jsonb_build_object(
 'cleanup_complete',true,
 'fixture_clubs_remaining',(SELECT count(*) FROM public.clubs WHERE name='TASK08-H09H10-HTTP-20261119'),
 'fixture_profiles_remaining',(SELECT count(*) FROM public.player_profiles WHERE display_name IN('TASK08-H09H10-HTTP-UNLINKED','TASK08-H09H10-HTTP-RENAMED')),
 'pending_join_requests',(SELECT count(*) FROM public.join_requests WHERE status='pending')
) AS report;
COMMIT;
