"""PR212専用: 最新バックアップの実復元と0051/0052隔離リハーサル。本番書込み機能は持たない。"""
import copy, hashlib, importlib.util, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
spec=importlib.util.spec_from_file_location('facility_previous_release',HERE.parent/'profile-home-court/cloud_release.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
v,b,c,a,require,q=p.v,p.b,p.c,p.a,p.require,p.q
spec=importlib.util.spec_from_file_location('facility_reviewed_data',HERE/'facility_data.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
MAIN='35b601331b26ee852642bddc07d2c30b1816d2fa'
MIGRATIONS=[('0051','shared_home_facility','7a4f39374f3ad328f103a26089e1e2745e36d453dd1446f2d8c0a40b1073289d'),('0052','jpa_existing_facility_corrections','85efc24e9eb3a42e8fe0c4a5a1d7198bd0574885a37015cf206bd670d23ee697')]
MASTER_FIELDS={'facility_key','aliases','availability','usage_note','verified_on'}
NEW_ARGUMENTS='p_profile uuid, p_expected bigint, p_facility uuid, p_name text, p_ticket uuid'

def migration(version,name):return ROOT/'supabase/migrations'/f'{version}_{name}.sql'
def authority():
    for version,name,sha in MIGRATIONS:require(hashlib.sha256(migration(version,name).read_bytes()).hexdigest()==sha,'212_reviewed_sql_changed')
    require(d.MIGRATION.read_text()==d.sql(),'212_csv_decision_sql_changed')
    pr=b.api('/pulls/212')
    require(pr['state']=='open' and not pr['merged'] and pr['draft'] and pr['head']['repo']['full_name']==b.REPOSITORY and pr['head']['ref']=='codex/profile-r2-instagram' and pr['head']['sha']==os.environ['BACKUP_SOURCE_SHA'],'212_pr_changed_or_not_draft')
    require(b.api('/commits/main')['sha']==MAIN,'212_main_changed')

def select_backup():
    run_id=os.environ['BACKUP_RUN_ID'];require(run_id.isdigit(),'212_backup_id_invalid')
    run=b.api('/actions/runs/'+run_id)
    require(run['conclusion']=='success' and run['head_sha']==MAIN and run['run_attempt']==1 and run['path']=='.github/workflows/cloud-db-backup.yml' and run['head_repository']['full_name']==b.REPOSITORY and run['head_branch']=='main' and run['event']=='workflow_dispatch','212_backup_restore_not_successful')
    releases=[r for r in b.api('/releases?per_page=100') if r['draft'] and r['name'].endswith(' '+run_id)]
    require(len(releases)==1 and '復元確認：成功' in releases[0]['body'] and releases[0]['target_commitish']==MAIN,'212_actual_restore_not_verified')
    record=json.loads(releases[0]['body'].split('\n\n')[-1]);assets=[x for x in releases[0]['assets'] if x['name']=='backup.tar.gpg']
    require(len(assets)==1 and len(record['sha256'])==64,'212_backup_asset_invalid')
    require(0<=(datetime.now(timezone.utc)-datetime.fromisoformat(record['captured_at'])).total_seconds()<14400,'212_backup_not_recent')
    for key,value in {'BACKUP_RELEASE_ID':str(releases[0]['id']),'BACKUP_ASSET_ID':str(assets[0]['id']),'BACKUP_SHA256':record['sha256']}.items():
        require(key not in os.environ or os.environ[key]==value,'212_backup_changed');os.environ[key]=value
        if os.environ.get('GITHUB_ENV'):
            with open(os.environ['GITHUB_ENV'],'a') as f:f.write(key+'='+value+'\n')
    print('PASS: latest_main_encrypted_backup_actual_restore_and_hash_fixed',flush=True)

def preflight_sql():return c.body(HERE/'01_preflight.sql')+c.body(HERE.parent/'profile-home-court/02_verify.sql')
def diagnose():
    # 真偽値だけ。接続情報・実データ・権限を持つユーザーIDは出力しない。
    flags=p.Production().query("""SELECT json_build_object(
      'history0050',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0050' AND name='private_profile_home_court'),
      'history0051or0052',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN('0051','0052')),
      'new_columns_present',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND ((table_name='player_profile_private' AND column_name='home_facility_id') OR (table_name='padel_facilities' AND column_name IN('facility_key','aliases','availability','usage_note','verified_on')))),
      'private_rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.player_profile_private'::regclass),
      'master_rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.padel_facilities'::regclass),
      'anon_private_select',has_table_privilege('anon','public.player_profile_private','SELECT'),
      'authenticated_private_update',has_table_privilege('authenticated','public.player_profile_private','UPDATE'),
      'authenticated_master_select',has_table_privilege('authenticated','public.padel_facilities','SELECT'),
      'authenticated_master_update',has_table_privilege('authenticated','public.padel_facilities','UPDATE'),
      'authenticated_master_insert',has_table_privilege('authenticated','public.padel_facilities','INSERT'),
      'master_nonselect_policies',EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='padel_facilities' AND cmd<>'SELECT'),
      'club_facility_fk',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.clubs'::regclass AND contype='f' AND confrelid='public.padel_facilities'::regclass AND convalidated))""")
    print('::notice title=PR212読取診断::'+json.dumps(flags,sort_keys=True),flush=True)
def preflight():
    authority()
    try:c.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+preflight_sql()+'ROLLBACK;')
    except b.BackupError:diagnose();raise
    print('PASS: readonly_production_0050_RLS_GRANT_FK_and_unapplied_0051_0052',flush=True)

def install():
    out=''
    for version,name,_ in MIGRATIONS:
        sql=c.body(migration(version,name));out+=sql+f"INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('{version}','{name}',ARRAY["+q(sql)+']::text[]);'
    return out

def verify():
    return c.body(HERE/'02_verify.sql')+c.body(HERE.parent/'profile-home-court/02_verify.sql')

def catalog_unchanged(before,after):
    old,new=copy.deepcopy(before),copy.deepcopy(after)
    for catalog in (old,new):
        for table in catalog['tables']:
            if table['schema']!='public':continue
            fields={'player_profile_private':{'home_facility_id'},'padel_facilities':MASTER_FIELDS}.get(table['name'],set())
            value=table['definition'];value['columns']=[x for x in value['columns'] if x[0] not in fields]
            if table['name']=='player_profile_private':value['constraints']=[x for x in value['constraints'] if x[0]!='profile_home_facility_fkey']
            if table['name']=='padel_facilities':
                value['constraints']=[x for x in value['constraints'] if x[0] not in ('padel_facilities_facility_key_key','padel_facilities_availability_check')]
                value['indexes']=[x for x in value['indexes'] if x[0]!='padel_facilities_facility_key_key']
        for functions in catalog['functions']:
            schema=functions['schema']
            functions['definitions']=[f for f in functions['definitions'] if not(schema=='public' and f['name']=='save_my_home_court_selection' and f['arguments']==NEW_ARGUMENTS)]
            for f in functions['definitions']:
                if (schema,f['name'],f['arguments']) in {('public','save_my_home_court','p_profile uuid, p_expected bigint, p_name text, p_ticket uuid'),('profile_media_private','reset_home_court','')}:
                    f.pop('definition',None) # SQLハッシュ固定。既存RPCの所有者・引数・ACLは比較する。
    require(old==new,'212_existing_catalog_RLS_GRANT_changed')

def rows_guard(rows,installed=False):
    statements=[]
    for row in rows:
        if installed and (row['schema'],row['name'])==('public','padel_facilities'):continue
        relation=b.ident(row['schema'])+'.'+b.ident(row['name']);expr=c.row_expression(relation)
        if installed and (row['schema'],row['name'])==('public','player_profile_private'):expr=expr.replace('to_jsonb(t)',"(to_jsonb(t)-'home_facility_id')")
        if installed and row['schema']+'.'+row['name']==v.HISTORY:expr=expr.replace('FROM '+relation+' t)','FROM '+relation+" t WHERE t.version NOT IN('0051','0052'))")
        expected=q(json.dumps({'rows':row['rows'],'sha256':row['sha256']}))+'::jsonb'
        statements.append('IF '+expr+' IS DISTINCT FROM '+expected+" THEN RAISE EXCEPTION '212_existing_data_changed';END IF;")
    return 'DO $rows$ BEGIN '+''.join(statements)+'END $rows$;'

def expected_facilities(before):
    rows=copy.deepcopy(before)
    for row in rows:row.update(facility_key=None,aliases=[],availability='unverified',usage_note=None,verified_on=None)
    for item in d.reviewed_rows():
        matched=[r for r in rows if r['name']==item['old_name']];require(len(matched)==1,'212_baseline_facility_not_unique');r=matched[0]
        require(r['prefecture']==item['old_prefecture'] and r['address'] is None and r['source_url']=='https://www.japanpadel.com/','212_baseline_facility_changed')
        r.update(name=item['name'],prefecture=item['prefecture'],address=item['address'],source_url=d.SOURCE,facility_key=item['key'],aliases=[] if item['old_name']==item['name'] else [item['old_name']],usage_note='JPA公式一覧掲載（提供CSV: 2026-11-18）。営業・一般利用可否は未確認。')
    return rows

def facility_guard(expected):
    return "DO $facilities$ BEGIN IF (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.padel_facilities t) IS DISTINCT FROM "+q(json.dumps(expected,ensure_ascii=False))+"::jsonb THEN RAISE EXCEPTION '212_unexpected_facility_data_or_id_change';END IF;END $facilities$;"

def rollback_isolated(target,before_catalog,facilities):
    require(isinstance(target,b.LocalRestore),'212_rollback_isolated_only')
    restore=''
    for entry in before_catalog['functions']:
        for f in entry['definitions']:
            if (entry['schema'],f['name']) in {('public','save_my_home_court'),('profile_media_private','reset_home_court')}:restore+=f['definition']+';'
    for row in facilities:
        restore+='UPDATE public.padel_facilities SET '+','.join(b.ident(k)+'='+('NULL' if val is None else q(str(val))) for k,val in row.items() if k!='id')+' WHERE id='+q(row['id'])+';'
    restore+='DROP FUNCTION public.save_my_home_court_selection(uuid,bigint,uuid,text,uuid);ALTER TABLE public.player_profile_private DROP COLUMN home_facility_id;ALTER TABLE public.padel_facilities '+','.join('DROP COLUMN '+b.ident(f) for f in sorted(MASTER_FIELDS))+";DELETE FROM supabase_migrations.schema_migrations WHERE version IN('0051','0052');"
    target.sql('SET ROLE postgres;BEGIN;'+restore+'COMMIT;')

def rehearse():
    authority();select_backup();root=b.workdir();files,manifest=b.unpack(root)
    require(0<=(datetime.now(timezone.utc)-datetime.fromisoformat(manifest['captured_at'])).total_seconds()<14400,'212_backup_not_recent')
    target=b.start_isolated_database(root);b.restore_files(target,files,manifest);a.align_isolated_defaults(target)
    target.sql('SET ROLE postgres;'+preflight_sql())
    before=v.probes(target,manifest)
    c.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+v.guard(before)+'ROLLBACK;',phase='212_latest_production_catalog_changed')
    before_catalog=b.catalog(target.query,manifest['tables'],manifest['function_schemas'])
    facilities=target.query('SELECT json_agg(to_jsonb(t) ORDER BY id) FROM public.padel_facilities t');expected=expected_facilities(facilities)
    rows=json.loads((files/'rows.json').read_text())
    check=verify()+rows_guard(rows,True)+facility_guard(expected)
    target.sql('SET ROLE postgres;BEGIN;'+b.SQL_SETTINGS+install()+check+'COMMIT;')
    catalog_unchanged(before_catalog,b.catalog(target.query,manifest['tables'],manifest['function_schemas']))
    target.sql('SET ROLE postgres;BEGIN;'+c.body(d.MIGRATION)+check+'COMMIT;') # 冪等性
    target.sql('SET ROLE postgres;'+(HERE/'03_smoke.sql').read_text())
    target.sql('SET ROLE postgres;'+check)
    rollback_isolated(target,before_catalog,facilities)
    target.sql('SET ROLE postgres;'+v.guard(before)+rows_guard(rows))
    target.sql('SET ROLE postgres;BEGIN;'+install()+check+'COMMIT;')
    catalog_unchanged(before_catalog,b.catalog(target.query,manifest['tables'],manifest['function_schemas']))
    authority()
    after=v.probes(target,manifest)
    b.json_file(root/'212-rehearsal-proof.json',{'head':os.environ['BACKUP_SOURCE_SHA'],'main':MAIN,'migrations':MIGRATIONS,'backup':os.environ['BACKUP_SHA256'],'manifest':manifest,'before':before,'after':after,'rows':rows,'expected_facilities':expected,'before_catalog':before_catalog,'original_facilities':facilities,'isolation_container':target.container,'production_mutations':False,'existing_ids_and_rows_preserved':True,'held_new_facilities':15})
    print('::notice title=PR212隔離検証::PASS actual_backup_restore_0051_0052_idempotence_RLS_GRANT_all_old_data_FK_CAS_rollback_reapply; production_writes_NONE; new15_HELD',flush=True)

if __name__=='__main__':
    try:{'preflight':preflight,'select-backup':select_backup,'rehearse':rehearse}[sys.argv[1]]()
    except b.BackupError as error:print('::error title=PR212安全停止::'+str(error),flush=True);sys.exit(1)
    except Exception:print('::error title=PR212安全停止::unexpected_rehearsal_error_details_withheld',flush=True);sys.exit(1)
