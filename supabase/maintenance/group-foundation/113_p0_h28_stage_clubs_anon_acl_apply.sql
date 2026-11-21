-- TASK-08 / P0-H28: STAGING-ONLY anonymous clubs base-table access correction.
-- Approved access contract: signed-in nonmembers may browse public clubs; anonymous
-- shared results use token-scoped get_shared_event. Never apply directly to production.
-- This is an isolated, reversible Stage ACL/RLS change; NOT fixed-pair migrations 0040-0043.
-- Stops on drift or missing token-scoped RPC. Execute only on padel-hub-staging.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

DO $guard$
DECLARE v_cols text[];
BEGIN
  IF current_user IN ('anon', 'authenticated', 'service_role')
     OR to_regnamespace('security_private') IS NULL
     OR to_regnamespace('fixed_pair_private') IS NOT NULL
     OR to_regprocedure('public.get_public_club_member_count(uuid)') IS NULL
     OR to_regprocedure('public.get_shared_event(text,text)') IS NULL
     OR NOT has_function_privilege('anon','public.get_shared_event(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Stage project identity / token RPC preflight failed';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.clubs'::regclass)
     OR has_table_privilege('anon','public.clubs','SELECT')
     OR has_table_privilege('public','public.clubs','SELECT')
     OR NOT has_any_column_privilege('anon','public.clubs','SELECT') THEN
    RAISE EXCEPTION 'Clubs RLS / ACL preflight mismatch';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='clubs' AND cmd IN ('SELECT','ALL')
        AND 'anon'=ANY(roles)) <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename='clubs'
        AND policyname='security_public_clubs' AND cmd='SELECT'
        AND roles=ARRAY['anon']::name[] AND permissive='PERMISSIVE'
        AND qual='(is_active AND (NOT is_deleted) AND (visibility = ''public''::text))'
        AND with_check IS NULL)
     OR NOT EXISTS (SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename='clubs'
        AND policyname='security_minimal_clubs_select' AND cmd='SELECT'
        AND 'authenticated'=ANY(roles) AND qual LIKE '%visibility%') THEN
    RAISE EXCEPTION 'Clubs SELECT policy drift; stop';
  END IF;

  SELECT array_agg(a.attname::text ORDER BY a.attname::text) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid='public.clubs'::regclass AND a.attnum>0
     AND NOT a.attisdropped
     AND has_column_privilege('anon',a.attrelid,a.attnum,'SELECT');
  IF v_cols IS DISTINCT FROM ARRAY[
      'created_at','deleted_at','description','id','image_url',
      'is_active','is_deleted','main_facility_id','name','visibility'
     ]::text[] THEN
    RAISE EXCEPTION 'Unexpected anon SELECT columns on clubs; stop';
  END IF;
END
$guard$;

-- Explicit column grants were the only direct anon clubs SELECT path in Stage.
REVOKE SELECT (
  created_at, deleted_at, description, id, image_url,
  is_active, is_deleted, main_facility_id, name, visibility
) ON TABLE public.clubs FROM anon;

-- Keep authenticated public/member/owner/admin SELECT policy untouched.
DROP POLICY security_public_clubs ON public.clubs;

DO $verify$
BEGIN
  IF has_any_column_privilege('anon','public.clubs','SELECT')
     OR has_table_privilege('anon','public.clubs','SELECT')
     OR EXISTS (SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename='clubs'
         AND cmd IN ('SELECT','ALL') AND 'anon'=ANY(roles))
     OR NOT EXISTS (SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename='clubs'
         AND policyname='security_minimal_clubs_select'
         AND cmd='SELECT' AND 'authenticated'=ANY(roles))
     OR NOT has_column_privilege('authenticated','public.clubs','name','SELECT')
     OR NOT has_column_privilege('authenticated','public.clubs','visibility','SELECT')
     OR NOT has_function_privilege('anon','public.get_shared_event(text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'Postcondition failed; transaction must roll back'; END IF;
END
$verify$;
COMMIT;
