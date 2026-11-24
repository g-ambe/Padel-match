-- TASK-08 / P0-H28: STAGING-ONLY rollback for 113.
-- WARNING: Restores direct anonymous SELECT of public club metadata.
-- Do NOT run automatically or in production. Require explicit recovery decision.
-- No data deletion, no cascading object drop. Valid only against the H28 poststate.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

DO $guard$
BEGIN
 IF current_user IN ('anon','authenticated','service_role')
    OR to_regnamespace('security_private') IS NULL
    OR to_regnamespace('fixed_pair_private') IS NOT NULL
    OR to_regprocedure('public.get_public_club_member_count(uuid)') IS NULL
    OR has_any_column_privilege('anon','public.clubs','SELECT')
    OR has_table_privilege('anon','public.clubs','SELECT')
    OR EXISTS (SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename='clubs'
         AND cmd IN ('SELECT','ALL') AND 'anon'=ANY(roles))
    OR NOT EXISTS (SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename='clubs'
         AND policyname='security_minimal_clubs_select'
         AND cmd='SELECT' AND 'authenticated'=ANY(roles))
 THEN RAISE EXCEPTION 'H28 Stage rollback preflight mismatch; stop'; END IF;
END
$guard$;

GRANT SELECT (
 created_at, deleted_at, description, id, image_url,
 is_active, is_deleted, main_facility_id, name, visibility
) ON TABLE public.clubs TO anon;

CREATE POLICY security_public_clubs ON public.clubs
 AS PERMISSIVE FOR SELECT TO anon
 USING (is_active AND NOT is_deleted AND visibility='public');

DO $verify$
BEGIN
 IF NOT has_column_privilege('anon','public.clubs','id','SELECT')
    OR NOT has_column_privilege('anon','public.clubs','name','SELECT')
    OR NOT EXISTS (SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename='clubs'
         AND policyname='security_public_clubs'
         AND cmd='SELECT' AND 'anon'=ANY(roles))
 THEN RAISE EXCEPTION 'H28 Stage rollback postcondition mismatch; abort'; END IF;
END
$verify$;
COMMIT;
