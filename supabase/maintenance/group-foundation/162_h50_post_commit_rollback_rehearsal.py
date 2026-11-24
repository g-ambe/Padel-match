"""H50: post-COMMIT production cutover rollback rehearsal, ISOLATED ONLY.

Uses H45/H48's READ-ONLY Prod snapshot, 6 limited-column group tables and 18
full-column legacy tables. Rebuilds the exact original Prod schema from
schema.dump and original rows after committed Phase1+2. This is a DESTRUCTIVE
snapshot rollback in the *offline Docker container*, NOT a safe lossless
production rollback. A post-cutover marker proves that intervening changes
will disappear. Explicitly assert old-client API incompatibility after
Phase2, forbid table-wide anon SELECT regrant, and mark production NO-GO.

Secrets, individual record values, member IDs, SQL command stdout/stderr and
restore artifacts are not written to GitHub Actions logs or uploaded.
"""
from __future__ import annotations

def contract_sql() -> str:
    return """SELECT json_build_object(
      'anon_member_select',
        has_table_privilege('anon','public.club_members','SELECT'),
      'anon_any_member_column',
        has_any_column_privilege('anon','public.club_members','SELECT'),
      'old_profile_link_rpc',
        to_regprocedure('public.get_player_profile_link_request(uuid)') IS NOT NULL,
      'old_profile_link_definition_sha',
        (SELECT md5(pg_get_functiondef(p.oid))
         FROM pg_proc p
         WHERE p.oid=to_regprocedure('public.get_player_profile_link_request(uuid)')),
      'alias_column_present',
        EXISTS(SELECT 1 FROM pg_attribute
               WHERE attrelid='public.club_members'::regclass
               AND attname='club_display_name' AND attnum>0 AND NOT attisdropped),
      'new_shared_rpc',
        to_regprocedure('public.get_shared_event(text,text)') IS NOT NULL,
      'owner_transfer_table',
        to_regclass('public.club_owner_transfer_requests') IS NOT NULL,
      'group_private_schema',to_regnamespace('group_read_private') IS NOT NULL,
      'migration_count',(SELECT count(*) FROM supabase_migrations.schema_migrations)
    )"""

def capture(target, h45, require):
    r = target.query(contract_sql())
    require(r['anon_member_select'] is True and
            r['old_profile_link_rpc'] is True and
            r['old_profile_link_definition_sha'] is not None and
            r['alias_column_present'] is False and
            r['group_private_schema'] is False and
            r['new_shared_rpc'] is False and
            r['owner_transfer_table'] is False and
            r['migration_count'] >= 20,
            'H50_baseline_legacy_contract_incorrect')
    print('H50 baseline: legacy old-client contract and 22-ish migration history captured',
          flush=True)
    return r

def run(target, root, roles, source_schemas, migration_history, catalog,
        source_data, legacy_data, legacy_cols, legacy_digest, legacy_integrity,
        baseline, require, b, h44, h45, h48):
    require(isinstance(target,b.LocalRestore),'H50_offline_container_only')
    require(legacy_data is not None and legacy_cols is not None,
            'H50_requires_H48_full_legacy')
    # Earlier H45-H48 completed the 6+11 migration blocks with actual COMMIT.
    after = target.query(contract_sql())
    require(after['migration_count'] == baseline['migration_count']+2 and
            after['new_shared_rpc'] is True and
            after['alias_column_present'] is True and
            after['owner_transfer_table'] is True and
            after['group_private_schema'] is True and
            after['anon_member_select'] is False and
            after['old_profile_link_definition_sha'] is not None and
            after['old_profile_link_definition_sha'] !=
                baseline['old_profile_link_definition_sha'],
            'H50_post_commit_contract_not_distinct')
    print('H50 PASS: post-COMMIT old-client contract regression confirmed;'
          ' naive Worker-only rollback is unsafe', flush=True)

    # A genuine, non-mutating anon role check proves that the old API path
    # cannot simply query club_members after Phase2. No unsafe re-GRANT.
    h44.isolated(target, """BEGIN;
        SET LOCAL ROLE anon;
        DO $probe$
        DECLARE forbidden boolean:=false;
        BEGIN
          BEGIN
            PERFORM count(*) FROM public.club_members;
          EXCEPTION WHEN insufficient_privilege THEN forbidden:=true;
          END;
          IF NOT forbidden THEN
            RAISE EXCEPTION 'H50_ANON_OLD_TABLE_ACCESS_UNEXPECTEDLY_WORKS';
          END IF;
        END $probe$;
        ROLLBACK;""")
    print('H50 PASS: old anon direct membership SELECT denied after Phase2;'
          ' no table-wide SELECT regrant performed',flush=True)

    # Synthetic post-cutover write, solely to demonstrate the risk of
    # *destructive* rollback on an offline DB. This is not a real app row.
    h44.isolated(target, """BEGIN;
        CREATE TABLE public.h50_restore_probe (marker text PRIMARY KEY);
        INSERT INTO public.h50_restore_probe VALUES('post_cutover_only');
        COMMIT;""")
    require(target.query("SELECT json_build_object('present',"
                  "to_regclass('public.h50_restore_probe') IS NOT NULL)")
            ['present'] is True, 'H50_local_postcommit_marker_missing')
    print('H50: synthetic post-cutover write committed in isolated DB',flush=True)

    # A snapshot rollback needs destructive schema reconstruction. Never
    # execute these DROP/restore steps on the hosted Production or Stage DB.
    # group_read_private was created by Phase1 and is absent from the
    # source schema inventory; remove it explicitly before restoring.
    target.sql('DROP SCHEMA IF EXISTS group_read_private CASCADE;')
    h44.restore_schema(target,root,roles,source_schemas)
    h44.install_history(target,migration_history)
    require(h44.query(target,h44.remote_schema_catalog_query()) == catalog,
            'H50_rollback_original_schema_metadata_drift')
    h45.load_rows(target,source_data)
    digest=h48.load(target,b,legacy_data,legacy_cols,require,h45)
    require(digest==legacy_digest,'H50_rollback_legacy_hash_changed')
    h48.verify(target,b,legacy_data,legacy_cols,digest,legacy_integrity,
               require,h45,'H50_after_destructive_restore')
    require(h45.digest(target.query(h45.rows_sql()))==h45.digest(source_data),
            'H50_rollback_group_rows_drift')
    now = target.query(contract_sql())
    require(now==baseline,'H50_rollback_old_rpc_grants_or_history_not_restored')
    require(h44.gate(target)['phase1_eligible'] is True,
            'H50_rollback_pre_cutover_gate_not_restored')
    require(target.query("SELECT json_build_object('present',"
               "to_regclass('public.h50_restore_probe') IS NOT NULL)")['present'] is False,
            'H50_post_cutover_writes_not_lost_as_expected')
    print('H50 PASS: offline destructive rollback rebuilt original DB schema,'
          ' old ACL/RPC/function definitions, 22-ish migration history,'
          ' 6 group tables and 18 legacy tables',flush=True)
    print('H50 NO-GO: a snapshot rollback deletes post-backup writes;'
          ' secure no-data-loss old-Worker forward-fix is not yet proven',flush=True)
