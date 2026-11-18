BEGIN READ ONLY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0050' AND name='private_profile_home_court') THEN RAISE EXCEPTION '0051_requires_0050';END IF;
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN('0051','0052') OR name IN('shared_home_facility','jpa_existing_facility_corrections'))
  OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND ((table_name='player_profile_private' AND column_name='home_facility_id') OR (table_name='padel_facilities' AND column_name IN('facility_key','aliases','availability','usage_note','verified_on'))))
  OR to_regprocedure('public.save_my_home_court_selection(uuid,bigint,uuid,text,uuid)') IS NOT NULL THEN RAISE EXCEPTION '0051_already_present_or_partial_stop';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.player_profile_private'::regclass AND relrowsecurity)
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.padel_facilities'::regclass AND relrowsecurity)
  OR has_table_privilege('anon','public.player_profile_private','SELECT') OR has_table_privilege('authenticated','public.player_profile_private','UPDATE')
  OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='padel_facilities' AND cmd<>'SELECT')
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('authenticated','anon') AND (rolsuper OR rolbypassrls))
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid='public.padel_facilities'::regclass AND (pg_has_role('authenticated',relowner,'MEMBER') OR pg_has_role('anon',relowner,'MEMBER')))
  OR NOT has_table_privilege('authenticated','public.padel_facilities','SELECT') THEN RAISE EXCEPTION '0051_existing_protection_differs';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid='public.clubs'::regclass AND k.contype='f' AND k.confrelid='public.padel_facilities'::regclass AND k.convalidated) THEN RAISE EXCEPTION '0051_club_facility_reference_missing';END IF;
END; $$;
ROLLBACK;
