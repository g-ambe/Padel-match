"""PR207 / 0048 only. Reuses the established encrypted backup and isolated restore guards."""
import copy
from datetime import datetime, timezone
import hashlib, importlib.util, json, os
from pathlib import Path
import re, sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
spec=importlib.util.spec_from_file_location('profile207_previous_release',HERE.parent/'event-result-video/cloud_release.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
b,c,a,require,q=v.b,v.c,v.a,v.require,v.q
Production=v.Production
MIGRATION=ROOT/'supabase/migrations/0048_private_profile_media.sql'
SHA='32e1839393d7ed50f2950ba2a0f7045224f7c3b3b4f5780b0fec096739fad093'
MAIN='a418a84056e7a2e5ff6d2800fa5810b48ae15cf0'
SECRET_SHA='080768bc089060b817bf2be39b23dd50338e1b50cf53ba609a9593b444557ccf'
HISTORY=v.HISTORY
RPCS={'profile_media_ready','profile_media_attempt','save_my_instagram','prepare_profile_image','commit_profile_image','abort_profile_image','profile_media_gc_candidates','claim_profile_media_gc','finish_profile_media_gc'}
TRIGGERS={'profile_media_detach','profile_media_remove'}

def all_checks(sha):
    checks=[];page=1
    while True:
        values=b.api('/commits/'+sha+'/check-runs?per_page=100&page='+str(page))['check_runs']
        checks.extend(values)
        if len(values)<100:return checks
        page+=1

def require_isolated_checks():
    sha=os.environ['BACKUP_SOURCE_SHA']
    # Label workflows can put the required job beyond the API's default first 30 rows.
    checks=b.api('/commits/'+sha+'/check-runs?check_name=private-media&filter=latest&per_page=100')['check_runs']
    require(bool(checks) and all(x['name']=='private-media' and x['head_sha']==sha and x['status']=='completed' and x['conclusion']=='success' for x in checks),'0048_required_isolated_checks_not_successful')

def authority():
    require(hashlib.sha256(MIGRATION.read_bytes()).hexdigest()==SHA,'0048_reviewed_sql_changed')
    pr=b.api('/pulls/207')
    require(pr['state']=='open' and not pr['merged'] and pr['head']['repo']['full_name']==b.REPOSITORY and pr['head']['ref']=='codex/profile-r2-instagram' and pr['head']['sha']==os.environ['BACKUP_SOURCE_SHA'],'0048_pr_head_changed')
    require(b.api('/commits/main')['sha']==MAIN,'0048_main_changed')
    checks=all_checks(pr['head']['sha'])
    require(not any(x['status']=='completed' and x['conclusion'] not in ('success','neutral','skipped') and x['name']!='Workers Builds: padel-match-staging' for x in checks),'0048_github_check_failed')
    statuses=b.api('/commits/'+pr['head']['sha']+'/status')['statuses']
    require(not any(x['state'] in ('failure','error') and 'padel-match-staging' not in x['context'] for x in statuses),'0048_github_status_failed')

def select_backup():
    run_id=os.environ['BACKUP_RUN_ID']
    require(run_id.isdigit(),'0048_backup_run_invalid')
    run=b.api('/actions/runs/'+run_id)
    require(run['conclusion']=='success' and run['head_sha']==MAIN and run['run_attempt']==1 and run['path']=='.github/workflows/cloud-db-backup.yml','0048_actual_backup_restore_not_successful')
    releases=[r for r in b.api('/releases?per_page=100') if r['draft'] and r['name'].endswith(' '+run_id)]
    require(len(releases)==1,'0048_unique_private_backup_missing')
    release=releases[0]
    require('復元確認：成功' in release['body'],'0048_real_restore_not_verified')
    record=json.loads(release['body'].split('\n\n')[-1])
    assets=[x for x in release['assets'] if x['name']=='backup.tar.gpg']
    require(len(assets)==1 and bool(re.fullmatch('[0-9a-f]{64}',record['sha256'])),'0048_backup_asset_invalid')
    selected={'BACKUP_RELEASE_ID':str(release['id']),'BACKUP_ASSET_ID':str(assets[0]['id']),'BACKUP_SHA256':record['sha256']}
    for key,value in selected.items():
        require(key not in os.environ or os.environ[key]==value,'0048_selected_backup_changed')
        os.environ[key]=value
    if os.environ.get('GITHUB_ENV'):
        with open(os.environ['GITHUB_ENV'],'a') as f:
            for key,value in selected.items():f.write(key+'='+value+'\n')
    print('PASS: fixed_latest_backup_private_retention_actual_restore_and_checksum',flush=True)

def history(target):
    present=target.query('SELECT to_json(to_regclass('+q(HISTORY)+') IS NOT NULL)')
    require(present,'0048_expected_migration_history_missing')
    cols=target.query("SELECT json_object_agg(column_name,data_type) FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'")
    require(cols.get('version')=='text' and cols.get('name')=='text' and cols.get('statements')=='ARRAY','0048_history_structure_differs')
    require(target.query("SELECT to_json(NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0048' OR name='private_profile_media'))"),'0048_history_already_recorded')

def history_insert():
    return "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('0048','private_profile_media',ARRAY["+q(c.body(MIGRATION))+']::text[]);'

def rows_guard(rows,recorded=False):return v.rows_guard(rows,recorded).replace('0047','0048')
def guard(probes):return v.guard(probes).replace('0047','0048')

def old_catalog_unchanged(before,after):
    normalized=copy.deepcopy(after)
    for item in normalized:
        value=item['value']
        if isinstance(value,list):item['value']=[x for x in value if not(isinstance(x,dict) and 'arguments' in x and x.get('name') in RPCS)]
        elif isinstance(value,dict) and 'triggers' in value:
            value['triggers']=[t for t in value['triggers'] if t[0] not in TRIGGERS]
    require(before==normalized,'0048_existing_catalog_RLS_GRANT_changed')

def preflight():
    authority()
    c.source_sql((HERE/'01_preflight.sql').read_text())
    history(Production())
    require(Production().query("SELECT to_json(to_regnamespace('profile_media_private') IS NULL AND to_regclass('public.player_profile_private') IS NULL)"),'0048_already_installed')
    print('PASS: readonly_target_schema_existing_RLS_and_unapplied_history',flush=True)

def install():
    return c.body(MIGRATION)+"INSERT INTO profile_media_private.settings(singleton,commit_secret_sha256) VALUES(true,decode("+q(SECRET_SHA)+",'hex'));"+history_insert()

def verify():
    return c.body(HERE/'02_verify.sql')+"DO $receipt$ BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0048' AND name='private_profile_media' AND statements=ARRAY["+q(c.body(MIGRATION))+"]::text[]) OR NOT EXISTS(SELECT 1 FROM profile_media_private.settings WHERE commit_secret_sha256=decode("+q(SECRET_SHA)+",'hex')) THEN RAISE EXCEPTION '0048_history_or_secret_hash_differs'; END IF; END $receipt$;"

def smoke(target):
    target.sql('BEGIN;SET LOCAL lock_timeout=\'5s\';'+b.SQL_SETTINGS+c.body(HERE/'03_smoke.sql')+'ROLLBACK;')
    print('PASS: dedicated_temporary_profile_Instagram_image_CAS_retry_abort_quota_owner_RLS_anon_GC; all_test_writes_rolled_back',flush=True)

def isolated_rollback():
    return "DROP FUNCTION public.profile_media_ready(text),public.profile_media_attempt(),public.save_my_instagram(uuid,bigint,text,uuid),public.prepare_profile_image(uuid,uuid,bigint,text,uuid,text),public.commit_profile_image(uuid,uuid,text),public.abort_profile_image(uuid,uuid,text),public.profile_media_gc_candidates(text),public.claim_profile_media_gc(text,text),public.finish_profile_media_gc(text,text);DROP SCHEMA profile_media_private CASCADE;DROP TABLE public.player_profile_private,public.profile_media_operations,public.profile_media_objects,public.profile_media_attempts;DELETE FROM supabase_migrations.schema_migrations WHERE version='0048' AND name='private_profile_media';"

def rehearse():
    authority();select_backup()
    root=b.workdir();files,manifest=b.unpack(root)
    require(0<=(datetime.now(timezone.utc)-datetime.fromisoformat(manifest['captured_at'])).total_seconds()<14400,'0048_backup_not_recent')
    target=b.start_isolated_database(root);b.restore_files(target,files,manifest);a.align_isolated_defaults(target)
    history(target);before=v.probes(target,manifest)
    c.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+guard(before)+'ROLLBACK;',phase='0048_latest_production_catalog_differs')
    rows=json.loads((files/'rows.json').read_text())
    target.sql('SET ROLE postgres;BEGIN;'+b.SQL_SETTINGS+install()+verify()+rows_guard(rows,True)+'COMMIT;')
    after=v.probes(target,manifest);old_catalog_unchanged(before,after)
    smoke(target);target.sql('SET ROLE postgres;'+rows_guard(rows,True))
    target.sql('SET ROLE postgres;BEGIN;'+isolated_rollback()+guard(before)+rows_guard(rows)+'COMMIT;')
    target.sql('SET ROLE postgres;BEGIN;'+b.SQL_SETTINGS+install()+verify()+guard(after)+rows_guard(rows,True)+'COMMIT;')
    b.json_file(root/'profile207-proof.json',{'head':os.environ['BACKUP_SOURCE_SHA'],'main':MAIN,'migration':SHA,'secret_hash':SECRET_SHA,'backup':os.environ['BACKUP_SHA256'],'manifest':manifest,'before':before,'after':after,'rows':rows})
    print('::notice title=TASK01 isolated rehearsal::PASS actual_file_restore_0048_existing_rows_RLS_GRANT_unchanged_smoke_rollback_reapply',flush=True)

def apply():
    require(os.environ.get('PADEL_RELEASE_AUTHORIZED')=='PR207-0048-20261117','0048_production_not_authorized')
    authority();select_backup()
    require_isolated_checks()
    proof=json.loads((b.workdir()/'profile207-proof.json').read_text())
    require(proof['head']==os.environ['BACKUP_SOURCE_SHA'] and proof['main']==MAIN and proof['migration']==SHA and proof['secret_hash']==SECRET_SHA and proof['backup']==os.environ['BACKUP_SHA256'],'0048_rehearsal_proof_changed')
    history(Production())
    tables=[t for t in proof['manifest']['tables'] if t['schema']=='public' or t['schema']+'.'+t['name']==HISTORY]
    locks=','.join(b.ident(t['schema'])+'.'+b.ident(t['name']) for t in tables)
    sql="BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='5s';"+b.SQL_SETTINGS+'SET LOCAL ROLE postgres;LOCK TABLE '+locks+' IN SHARE ROW EXCLUSIVE MODE;SELECT pg_advisory_xact_lock(2070048);'
    sql+=guard(proof['before'])+rows_guard(proof['rows'])+install()+verify()+guard(proof['after'])+rows_guard(proof['rows'],True)
    sql+="SELECT json_build_object('0048_applied',true,'existing_rows_RLS_GRANT_unchanged',true);COMMIT;"
    # A lost response stops the release. No automatic reapply / production rollback.
    c.source_sql(sql,readonly=False,phase='0048_atomic_apply_failed_or_response_unknown_stop')
    post=verify()+guard(proof['after'])+rows_guard(proof['rows'],True)
    c.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+post+'ROLLBACK;',phase='0048_postcommit_verification_failed_stop')
    smoke(Production())
    c.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+post+'ROLLBACK;',phase='0048_post_smoke_verification_failed_stop')
    authority()
    print('::notice title=TASK01 production migration::PASS 0048_applied_dedicated_smoke_all_existing_data_RLS_GRANT_unchanged',flush=True)

if __name__=='__main__':
    try:{'preflight':preflight,'select-backup':select_backup,'rehearse':rehearse,'apply':apply}[sys.argv[1]]()
    except b.BackupError as error:
        print('::error title=PR207安全停止::'+str(error),flush=True);sys.exit(1)
    except Exception:
        print('::error title=PR207安全停止::unexpected_release_error_details_withheld',flush=True);sys.exit(1)
