"""0050 only: established encrypted backup/real restore, exact catalog + data guards.
No R2 writes, no production rollback. All test writes use dedicated temporary rows + ROLLBACK.
"""
import copy
from datetime import datetime, timezone
import hashlib, importlib.util, json, os, re, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
spec=importlib.util.spec_from_file_location('avatar_previous_release',HERE.parent/'profile-media/cloud_release.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
v,b,c,a,require,q=p.v,p.b,p.c,p.a,p.require,p.q
Production=p.Production
MIGRATION=ROOT/'supabase/migrations/0050_private_profile_home_court.sql'
SHA='6fd3c1dc98aa231cff32eb6153008ae25ffdb2d928342a7476a825dd9315c978'
MAIN='423e7ee169e1d9a40aca319b739ffc14d4e80704'
PR=211
BACKUP_TOOL_SHA=MAIN
BACKUP_ATTEMPT=1
HISTORY=v.HISTORY
FIELDS={'home_court_name','home_court_version'}
RPCS={'save_my_home_court','reset_home_court'}

def authority():
    require(hashlib.sha256(MIGRATION.read_bytes()).hexdigest()==SHA,'0050_reviewed_sql_changed')
    pr=b.api('/pulls/'+str(PR))
    require(pr['state']=='open' and not pr['merged'] and pr['head']['repo']['full_name']==b.REPOSITORY and pr['head']['ref']=='codex/profile-r2-instagram' and pr['head']['sha']==os.environ['BACKUP_SOURCE_SHA'],'0050_pr_head_changed')
    require(b.api('/commits/main')['sha']==MAIN,'0050_main_changed')
    checks=p.all_checks(pr['head']['sha'])
    # GitHub's normal merge still enforces all actual required checks. No bypass.
    require(not any(x['status']=='completed' and x['conclusion'] not in ('success','neutral','skipped') and x['name']!='Workers Builds: padel-match-staging' for x in checks),'0050_github_check_failed')
    statuses=b.api('/commits/'+pr['head']['sha']+'/status')['statuses']
    require(not any(x['state'] in ('failure','error') and 'padel-match-staging' not in x['context'] for x in statuses),'0050_github_status_failed')

def select_backup():
    run_id=os.environ['BACKUP_RUN_ID'];require(run_id.isdigit(),'0050_backup_run_invalid')
    run=b.api('/actions/runs/'+run_id)
    require(run['conclusion']=='success' and run['head_sha']==BACKUP_TOOL_SHA and run['run_attempt']==BACKUP_ATTEMPT and run['path']=='.github/workflows/cloud-db-backup.yml' and run['head_repository']['full_name']==b.REPOSITORY and run['event']=='workflow_dispatch' and run['head_branch']=='main','0050_actual_backup_restore_not_successful')
    releases=[r for r in b.api('/releases?per_page=100') if r['draft'] and r['name'].endswith(' '+run_id)]
    require(len(releases)==1,'0050_unique_private_backup_missing')
    release=releases[0];require('復元確認：成功' in release['body'] and release['target_commitish']==MAIN,'0050_real_restore_not_verified')
    record=json.loads(release['body'].split('\n\n')[-1]);assets=[x for x in release['assets'] if x['name']=='backup.tar.gpg']
    require(len(assets)==1 and bool(re.fullmatch('[0-9a-f]{64}',record['sha256'])),'0050_backup_asset_invalid')
    for key,value in {'BACKUP_RELEASE_ID':str(release['id']),'BACKUP_ASSET_ID':str(assets[0]['id']),'BACKUP_SHA256':record['sha256']}.items():
        require(key not in os.environ or os.environ[key]==value,'0050_selected_backup_changed');os.environ[key]=value
        if os.environ.get('GITHUB_ENV'):
            with open(os.environ['GITHUB_ENV'],'a') as f:f.write(key+'='+value+'\n')
    print('PASS: actual_recent_encrypted_file_and_separate_restore_fixed',flush=True)

def history(target):
    require(target.query("SELECT to_json(EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0049' AND name='profile_avatar_position') AND NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0050' OR name='private_profile_home_court'))"),'0050_history_differs')

def history_insert():
    return "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('0050','private_profile_home_court',ARRAY["+q(c.body(MIGRATION))+']::text[]);'

def guard(probes):return v.guard(probes).replace('0047','0050')

def rows_guard(rows,installed=False):
    parts=[]
    for row in rows:
        relation=b.ident(row['schema'])+'.'+b.ident(row['name']);expression=c.row_expression(relation)
        if installed and row['schema']== 'public' and row['name']=='player_profile_private':
            expression=expression.replace('to_jsonb(t)',"(to_jsonb(t)-ARRAY["+','.join(q(x) for x in sorted(FIELDS))+'])')
        if installed and row['schema']+'.'+row['name']==HISTORY:
            expression=expression.replace('FROM '+relation+' t)','FROM '+relation+" t WHERE t.version<>'0050')")
        expected=q(json.dumps({'rows':row['rows'],'sha256':row['sha256']}))+'::jsonb'
        parts.append('IF '+expression+' IS DISTINCT FROM '+expected+" THEN RAISE EXCEPTION '0050_existing_data_changed' USING ERRCODE='40001'; END IF;")
    return 'DO $rows$ BEGIN '+''.join(parts)+' END $rows$;'

def old_catalog_unchanged(before,after):
    normalized=copy.deepcopy(after)
    for item in normalized:
        value=item['value']
        if isinstance(value,list):item['value']=[x for x in value if not(isinstance(x,dict) and 'arguments' in x and x.get('name') in RPCS)]
        elif isinstance(value,dict) and 'columns' in value and '"public"."player_profile_private"' in item['sql']:
            value['columns']=[x for x in value['columns'] if x[0] not in FIELDS]
            value['constraints']=[x for x in value['constraints'] if x[0] not in ('profile_home_court_name_bounds','profile_home_court_version_bounds')]
            value['triggers']=[x for x in value['triggers'] if x[0]!='profile_home_court_reset']
    require(before==normalized,'0050_unexpected_existing_catalog_RLS_GRANT_change')

def install():return c.body(MIGRATION)+history_insert()
def verify():
    return c.body(HERE/'02_verify.sql')+"DO $receipt$ BEGIN IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0050' AND name='private_profile_home_court' AND statements=ARRAY["+q(c.body(MIGRATION))+"]::text[]) THEN RAISE EXCEPTION '0050_history_differs'; END IF; END $receipt$;"

def preflight():
    authority();history(Production());c.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+c.body(HERE/'01_preflight.sql')+'ROLLBACK;')
    print('::notice title=0050事前確認::PASS latest_production_0049_private_RLS_GRANT_facility_source_and_absent_0050',flush=True)

def smoke(target):
    target.sql("SET ROLE postgres;BEGIN;SET LOCAL lock_timeout='5s';"+b.SQL_SETTINGS+c.body(HERE/'03_smoke.sql')+'ROLLBACK;')
    print('PASS: dedicated_temporary_home_court_CRUD_CAS_image_quota_unchanged_RLS_owner_reset; all_test_writes_ROLLBACK',flush=True)

def isolated_rollback():
    return "DROP FUNCTION public.save_my_home_court(uuid,bigint,text,uuid);DROP TRIGGER profile_home_court_reset ON public.player_profile_private;DROP FUNCTION profile_media_private.reset_home_court();ALTER TABLE public.player_profile_private DROP CONSTRAINT profile_home_court_name_bounds,DROP CONSTRAINT profile_home_court_version_bounds,DROP COLUMN home_court_name,DROP COLUMN home_court_version;DELETE FROM supabase_migrations.schema_migrations WHERE version='0050' AND name='private_profile_home_court';"

def rehearse():
    authority();select_backup();root=b.workdir();files,manifest=b.unpack(root)
    require(0<=(datetime.now(timezone.utc)-datetime.fromisoformat(manifest['captured_at'])).total_seconds()<14400,'0050_backup_not_recent')
    target=b.start_isolated_database(root);b.restore_files(target,files,manifest);a.align_isolated_defaults(target)
    target.sql('SET ROLE postgres;'+c.body(HERE/'01_preflight.sql'));history(target)
    before=v.probes(target,manifest)
    c.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+guard(before)+'ROLLBACK;',phase='0050_latest_production_catalog_differs')
    rows=json.loads((files/'rows.json').read_text())
    target.sql('SET ROLE postgres;BEGIN;'+b.SQL_SETTINGS+install()+verify()+rows_guard(rows,True)+'COMMIT;')
    after=v.probes(target,manifest);old_catalog_unchanged(before,after)
    require(target.query('SELECT to_json(NOT EXISTS(SELECT 1 FROM public.player_profile_private WHERE home_court_name IS NOT NULL OR home_court_version<>0))'),'0050_defaults_not_empty')
    smoke(target);target.sql('SET ROLE postgres;'+rows_guard(rows,True))
    target.sql('SET ROLE postgres;BEGIN;'+isolated_rollback()+guard(before)+rows_guard(rows)+'COMMIT;')
    target.sql('SET ROLE postgres;BEGIN;'+b.SQL_SETTINGS+install()+verify()+guard(after)+rows_guard(rows,True)+'COMMIT;')
    b.json_file(root/'home-court-proof.json',{'head':os.environ['BACKUP_SOURCE_SHA'],'main':MAIN,'migration':SHA,'backup':os.environ['BACKUP_SHA256'],'manifest':manifest,'before':before,'after':after,'rows':rows})
    print('::notice title=0050隔離検証::PASS actual_file_restore_0050_existing_data_RLS_GRANT_home_court_quota_CAS_rollback_reapply',flush=True)

def apply():
    require(os.environ.get('PADEL_RELEASE_AUTHORIZED')=='PR211-0050-20261117','0050_production_not_authorized')
    authority();select_backup();p.require_isolated_checks()
    proof=json.loads((b.workdir()/'home-court-proof.json').read_text())
    require(proof['head']==os.environ['BACKUP_SOURCE_SHA'] and proof['main']==MAIN and proof['migration']==SHA and proof['backup']==os.environ['BACKUP_SHA256'],'0050_rehearsal_proof_changed')
    require(0<=(datetime.now(timezone.utc)-datetime.fromisoformat(proof['manifest']['captured_at'])).total_seconds()<14400,'0050_backup_not_recent')
    history(Production())
    tables=[t for t in proof['manifest']['tables'] if t['schema']=='public' or t['schema']+'.'+t['name']==HISTORY]
    locks=','.join(b.ident(t['schema'])+'.'+b.ident(t['name']) for t in tables)
    sql="BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='5s';"+b.SQL_SETTINGS+'SET LOCAL ROLE postgres;LOCK TABLE '+locks+' IN SHARE ROW EXCLUSIVE MODE;SELECT pg_advisory_xact_lock(2110050);'
    sql+=guard(proof['before'])+rows_guard(proof['rows'])+c.body(HERE/'01_preflight.sql')+install()+verify()+guard(proof['after'])+rows_guard(proof['rows'],True)
    sql+="SELECT json_build_object('0050_applied',true,'existing_data_RLS_GRANT_unchanged',true);COMMIT;"
    c.source_sql(sql,readonly=False,phase='0050_atomic_apply_failed_or_response_unknown_stop')
    post=verify()+guard(proof['after'])+rows_guard(proof['rows'],True)
    c.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+post+'ROLLBACK;',phase='0050_postcommit_verification_failed_stop')
    smoke(Production())
    c.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+post+'ROLLBACK;',phase='0050_post_smoke_verification_failed_stop')
    authority();print('::notice title=0050本番適用::PASS 0050_applied_existing_data_RLS_GRANT_unchanged_dedicated_smoke_rolled_back',flush=True)

if __name__=='__main__':
    try:{'preflight':preflight,'select-backup':select_backup,'rehearse':rehearse,'apply':apply}[sys.argv[1]]()
    except b.BackupError as error:print('::error title=0050安全停止::'+str(error),flush=True);sys.exit(1)
    except Exception:print('::error title=0050安全停止::unexpected_release_error_details_withheld',flush=True);sys.exit(1)
