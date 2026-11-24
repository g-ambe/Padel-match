-- TASK-08 H52: ISOLATED REHEARSAL CANDIDATE ONLY; NOT A PROD MIGRATION.
-- The 0039 FK allowlist predates 0048 private profile/media tables.
-- Recognize ONLY the three inspected FK shapes. Do not merge, copy, detach
-- or transfer private/media rows. A provisional source with ANY such row
-- must fail closed. The authenticated canonical target remains untouched.
-- Requires H51's protected review path and the disposable marker table.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
DO $h52_patch$
DECLARE
 v_guard text; v_merge text; v_guard_new text; v_merge_new text;
 v_old constant text := '(''player_profile_merges'',''target_player_profile_id'')';
 v_new constant text := '(''player_profile_merges'',''target_player_profile_id''),'
   || ' (''player_profile_private'',''profile_id''),'
   || ' (''profile_media_objects'',''profile_id''),'
   || ' (''profile_media_operations'',''profile_id'')';
 v_anchor constant text := 'if exists (select 1 from public.player_profile_merges where source_player_profile_id = p_source and restored_at is null)';
 v_source_guard constant text := $source_guard$
  -- Source and canonical target rows have already been locked FOR UPDATE.
  -- The media owner RPC also locks the profile and requires linked/active
  -- ownership. No app-authorized media write can attach to this unlinked
  -- source while it is locked. Reject even stale/anomalous source rows.
  if exists (select 1 from public.player_profile_private where profile_id = p_source)
    or exists (select 1 from public.profile_media_objects where profile_id = p_source)
    or exists (select 1 from public.profile_media_operations where profile_id = p_source)
  then raise exception 'H52 source private/media references require separate review' using errcode='42501'; end if;
  $source_guard$;
 v_fk_count integer;
BEGIN
 IF current_user<>'postgres'
 OR to_regclass('public.h51_postcutover_data_preservation') IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.h51_postcutover_data_preservation WHERE marker='retained')
 OR to_regprocedure('profile_link_private.review_player_profile_link_original(uuid,text,text)') IS NULL
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name='task08_prod_phase2_atomic')<>1
 THEN RAISE EXCEPTION 'H52_media_candidate_requires_isolated_post_H51'; END IF;

 SELECT CASE WHEN count(*)=3 AND count(DISTINCT t.relname)=3 THEN 3 ELSE 0 END INTO v_fk_count
 FROM pg_constraint c
 JOIN pg_class t ON t.oid=c.conrelid
 JOIN pg_namespace n ON n.oid=t.relnamespace
 JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=c.conkey[1]
 JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=c.confkey[1]
 WHERE c.contype='f' AND c.confrelid='public.player_profiles'::regclass
   AND n.nspname='public' AND cardinality(c.conkey)=1 AND cardinality(c.confkey)=1
   AND a.attname='profile_id' AND pa.attname='id'
   AND a.atttypid='uuid'::regtype AND pa.atttypid='uuid'::regtype
   AND c.confupdtype='a' AND NOT c.condeferrable AND c.convalidated
   AND ((t.relname='player_profile_private' AND c.confdeltype='c')
     OR (t.relname IN ('profile_media_objects','profile_media_operations') AND c.confdeltype='n'));
 IF v_fk_count<>3 THEN RAISE EXCEPTION 'H52_reviewed_media_FK_shape_drift'; END IF;

 SELECT pg_get_functiondef(p.oid) INTO v_guard FROM pg_proc p
 WHERE p.oid=to_regprocedure('profile_link_private.check_reference_schema()')
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef;
 SELECT pg_get_functiondef(p.oid) INTO v_merge FROM pg_proc p
 WHERE p.oid=to_regprocedure('profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)')
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef;

 IF v_guard IS NULL OR v_merge IS NULL
 OR position('未確認の外部キーがあります' IN v_guard)=0
 OR (length(v_guard)-length(replace(v_guard,v_old,'')))<>length(v_old)
 OR position('profile_media_objects' IN v_guard)>0
 OR (length(v_merge)-length(replace(v_merge,v_anchor,'')))<>length(v_anchor)
 OR position('H52 source private/media' IN v_merge)>0
 OR position('perform profile_link_private.check_reference_schema();' IN v_merge)=0
 OR position('select * into source from public.player_profiles where id = p_source for update;' IN v_merge)=0
 OR position('select * into target from public.player_profiles where id = p_target for update;' IN v_merge)=0
 OR position('統合元の未連携状態と本人の正規プロフィールを確認してください' IN v_merge)=0
 THEN RAISE EXCEPTION 'H52_original_merge_or_FK_guard_contract_drift'; END IF;

 -- First prove the unchanged guard rejects the present schema for precisely
 -- the reviewed reason, rather than treating a generic P0001 as expected.
 BEGIN
  PERFORM profile_link_private.check_reference_schema();
  RAISE EXCEPTION 'H52_expected_old_FK_guard_to_reject';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF position('未確認の外部キーがあります' IN SQLERRM)=0 THEN RAISE; END IF;
 END;

 v_guard_new:=replace(v_guard,v_old,v_new);
 v_merge_new:=replace(v_merge,v_anchor,v_source_guard||v_anchor);
 EXECUTE v_guard_new;
 EXECUTE v_merge_new;
 -- Any other, unknown FK still aborts the candidate transaction.
 PERFORM profile_link_private.check_reference_schema();
 IF has_function_privilege('anon','profile_link_private.check_reference_schema()','EXECUTE')
 OR has_function_privilege('authenticated','profile_link_private.check_reference_schema()','EXECUTE')
 OR has_function_privilege('anon','profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','profile_link_private.merge_profiles(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','profile_link_private.review_player_profile_link_original(uuid,text,text)','EXECUTE')
 OR has_table_privilege('anon','public.club_members','SELECT')
 THEN RAISE EXCEPTION 'H52_private_or_anon_boundary_drift'; END IF;
END $h52_patch$;
COMMIT;
