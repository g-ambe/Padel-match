-- TASK-08 H13: STAGING ONLY - remove ONLY the two controlled synthetic clubs.
-- No user, profile, existing club, other club membership or real match deletion.
-- Check all single-column foreign-key dependent relations BEFORE deleting.
-- Stop rather than deleting if any unexpected child row exists.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $cleanup$
DECLARE uid uuid; c record; fk record; n integer; member_n integer;
 total_clubs integer := 0; total_members integer := 0;
BEGIN
 IF current_user <> 'postgres'
  OR (SELECT count(*) FROM public.clubs WHERE name IN
    ('TASK08-P0-20261119-A','TASK08-P0-20261119-B')) <> 2
 THEN RAISE EXCEPTION 'H13 stage-only precondition mismatch'; END IF;
 SELECT id INTO STRICT uid FROM auth.users
 WHERE lower(email)='main-a@example.com' AND email_confirmed_at IS NOT NULL;
 IF EXISTS (
   SELECT 1 FROM pg_constraint k WHERE k.contype='f'
    AND k.confrelid='public.clubs'::regclass AND array_length(k.conkey,1)<>1
 ) THEN RAISE EXCEPTION 'Unknown composite FK; manual review required'; END IF;
 FOR c IN
  SELECT id,name,owner_id FROM public.clubs
   WHERE name IN('TASK08-H13-HTTP-20261119-SINGLE','TASK08-H13-HTTP-20261119-RACE')
     AND created_at > '2026-11-19'::timestamptz
   ORDER BY name FOR UPDATE
 LOOP
   IF c.owner_id IS DISTINCT FROM uid THEN
     RAISE EXCEPTION 'H13 cleanup owner mismatch; stop';
   END IF;
   -- All memberships of these two fixture clubs must belong to main-A only.
   IF EXISTS (
    SELECT 1 FROM public.club_members cm
    LEFT JOIN public.player_profiles pp ON pp.id=cm.player_profile_id
    WHERE cm.club_id=c.id AND (
      cm.profile_id IS DISTINCT FROM uid
      OR pp.linked_auth_user_id IS DISTINCT FROM uid
      OR cm.role IS DISTINCT FROM 'main_admin')
   ) THEN RAISE EXCEPTION 'H13 unexpected member, stop without deletion';
   END IF;
   SELECT count(*) INTO member_n FROM public.club_members cm WHERE cm.club_id=c.id;
   IF member_n > 2 THEN RAISE EXCEPTION 'H13 unexpected member count; stop'; END IF;
   FOR fk IN
     SELECT ns.nspname AS schema_name, rel.relname AS table_name,
            att.attname AS fk_column
     FROM pg_constraint k
     JOIN pg_class rel ON rel.oid=k.conrelid
     JOIN pg_namespace ns ON ns.oid=rel.relnamespace
     JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=k.conkey[1]
     WHERE k.contype='f'
       AND k.confrelid='public.clubs'::regclass
       AND k.conrelid<>'public.club_members'::regclass
   LOOP
     EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I=$1',
        fk.schema_name,fk.table_name,fk.fk_column)
     INTO n USING c.id;
     IF n<>0 THEN
       RAISE EXCEPTION 'H13 unexpected child dependency %, stop',
         fk.schema_name||'.'||fk.table_name;
     END IF;
   END LOOP;
   IF EXISTS (SELECT 1 FROM public.join_requests r
       JOIN public.club_members cm ON cm.id=r.target_club_member_id
       WHERE cm.club_id=c.id)
     OR EXISTS (SELECT 1 FROM public.player_profile_link_requests r
       JOIN public.club_members cm ON cm.id=r.source_club_member_id
       WHERE cm.club_id=c.id)
   THEN RAISE EXCEPTION 'H13 member linked to request; stop'; END IF;
   DELETE FROM public.clubs WHERE id=c.id AND owner_id=uid;
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>1 THEN RAISE EXCEPTION 'H13 delete count mismatch'; END IF;
   total_clubs:=total_clubs+1;
   total_members:=total_members+member_n;
 END LOOP;
 IF (SELECT count(*) FROM public.clubs WHERE name IN
   ('TASK08-H13-HTTP-20261119-SINGLE','TASK08-H13-HTTP-20261119-RACE'))<>0
 THEN RAISE EXCEPTION 'H13 fixture remained, rollback'; END IF;
 PERFORM set_config('task08.cleaned_clubs',total_clubs::text,true);
 PERFORM set_config('task08.cleaned_members',total_members::text,true);
END $cleanup$;
SELECT jsonb_build_object(
  'stage_fixture_clubs_removed',current_setting('task08.cleaned_clubs')::int,
  'stage_fixture_members_removed',current_setting('task08.cleaned_members')::int,
  'stage_fixture_clubs_remaining',
    (SELECT count(*) FROM public.clubs WHERE name IN
       ('TASK08-H13-HTTP-20261119-SINGLE','TASK08-H13-HTTP-20261119-RACE'))
) AS report;
COMMIT;
