"""PR212: 承認済み0051/0052のみ。実復元の証跡を固定し、本番ロールバック/自動再適用は行わない。"""
import hashlib, importlib.util, json, os, sys
from datetime import datetime, timezone
from pathlib import Path

spec=importlib.util.spec_from_file_location('facility212_isolated',Path(__file__).with_name('cloud_rehearsal.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
b,c,require,q=r.b,r.c,r.require,r.q
AUTHORIZATION='PR212-0051-0052-20261118'

def authority():
    require(os.environ.get('PADEL_RELEASE_AUTHORIZED')==AUTHORIZATION,'212_production_not_authorized')
    r.authority() # PR212/Draft/head/main/両SQL/CSV判断表を固定。
    r.p.p.require_isolated_checks()
    checks=r.p.p.all_checks(os.environ['BACKUP_SOURCE_SHA'])
    require(not any(x['status']=='completed' and x['conclusion'] not in ('success','neutral','skipped') and x['name']!='Workers Builds: padel-match-staging' for x in checks),'212_github_check_failed')
    statuses=b.api('/commits/'+os.environ['BACKUP_SOURCE_SHA']+'/status')['statuses']
    require(not any(x['state'] in ('failure','error') and 'padel-match-staging' not in x['context'] for x in statuses),'212_github_status_failed')

def check_proof(proof,atomic=True):
    require(proof['head']==os.environ['BACKUP_SOURCE_SHA'] and proof['main']==r.MAIN and proof['migrations']==[list(x) for x in r.MIGRATIONS] and proof['backup']==os.environ['BACKUP_SHA256'],'212_rehearsal_proof_changed')
    require(proof['production_mutations'] is False and proof['existing_ids_and_rows_preserved'] is True and proof['held_new_facilities']==15,'212_rehearsal_proof_incomplete')
    require(0<=(datetime.now(timezone.utc)-datetime.fromisoformat(proof['manifest']['captured_at'])).total_seconds()<14400,'212_backup_not_recent')
    if atomic:require(proof.get('atomic_apply_rehearsed') is True and proof.get('atomic_sql_sha256')==hashlib.sha256(apply_sql(proof).encode()).hexdigest(),'212_exact_atomic_apply_not_rehearsed')

def receipt():
    parts=[]
    for version,name,_ in r.MIGRATIONS:
        body=c.body(r.migration(version,name))
        parts.append("IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version="+q(version)+' AND name='+q(name)+' AND statements=ARRAY['+q(body)+"]::text[]) THEN RAISE EXCEPTION '212_migration_receipt_changed';END IF;")
    return 'DO $receipt$ BEGIN '+''.join(parts)+'END $receipt$;'

def postconditions(proof):
    return r.verify()+receipt()+r.v.guard(proof['after'])+r.facility_guard(proof['expected_facilities'])

def reviewed_data_guard(proof):
    critical={('public','padel_facilities'),('supabase_migrations','schema_migrations')}
    rows=[x for x in proof['rows'] if (x['schema'],x['name']) in critical]
    require({(x['schema'],x['name']) for x in rows}==critical,'212_reviewed_data_inventory_missing')
    return r.rows_guard(rows)

def live_rows_guard(proof):
    parts=[]
    for table in proof['manifest']['tables']:
        schema,name=table['schema'],table['name']
        if (schema,name)==('public','padel_facilities'):continue # 別の全行ガードで承認済み9件の補正だけを許可。
        relation=b.ident(schema)+'.'+b.ident(name);expr=c.row_expression(relation)
        if (schema,name)==('public','player_profile_private'):expr=expr.replace('to_jsonb(t)',"(to_jsonb(t)-'home_facility_id')")
        if schema+'.'+name==r.v.HISTORY:expr=expr.replace('FROM '+relation+' t)','FROM '+relation+" t WHERE t.version NOT IN('0051','0052'))")
        parts.append("IF NOT EXISTS(SELECT 1 FROM release_rows_before WHERE schema="+q(schema)+' AND name='+q(name)+") OR EXISTS(SELECT 1 FROM release_rows_before WHERE schema="+q(schema)+' AND name='+q(name)+' AND value IS DISTINCT FROM '+expr+") THEN RAISE EXCEPTION '212_live_data_changed_by_migration';END IF;")
    return 'DO $live$ BEGIN '+''.join(parts)+'END $live$;'

def apply_sql(proof):
    tables=[t for t in proof['manifest']['tables'] if t['schema']=='public' or t['schema']+'.'+t['name']==r.v.HISTORY]
    locks=','.join(b.ident(t['schema'])+'.'+b.ident(t['name']) for t in tables)
    require(bool(locks),'212_lock_inventory_missing')
    return ("BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='5s';"+b.SQL_SETTINGS+
        'SET LOCAL ROLE postgres;LOCK TABLE '+locks+' IN SHARE ROW EXCLUSIVE MODE;SELECT pg_advisory_xact_lock(212005152);'+
        r.v.guard(proof['before'])+reviewed_data_guard(proof)+r.preflight_sql()+c.current_rows_sql(proof['manifest']['tables'])+
        r.install()+postconditions(proof)+live_rows_guard(proof)+
        "SELECT json_build_object('0051_0052_applied',true,'existing_data_RLS_GRANT_ID_unchanged',true,'new_facilities',0);COMMIT;")

def apply():
    authority();r.select_backup()
    proof=json.loads((b.workdir()/'212-atomic-proof.json').read_text());check_proof(proof)
    # レスポンス喪失も停止。再適用や本番復元を推測で行わない。
    c.source_sql(apply_sql(proof),readonly=False,phase='212_atomic_apply_failed_or_response_unknown_preserve_database')
    c.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+postconditions(proof)+'ROLLBACK;',phase='212_postcommit_verification_failed_preserve_database')
    authority()
    print('::notice title=PR212本番適用::PASS 0051_0052_atomic_apply_receipts_existing_data_RLS_GRANT_ID_FK_unchanged; added0_held15; no_production_test_writes',flush=True)

def rehearse_apply():
    r.authority();r.select_backup()
    proof=json.loads((b.workdir()/'212-rehearsal-proof.json').read_text());check_proof(proof,atomic=False)
    target=b.LocalRestore(proof['isolation_container'])
    r.rollback_isolated(target,proof['before_catalog'],proof['original_facilities'])
    target.sql('SET ROLE postgres;BEGIN;'+b.SQL_SETTINGS+r.v.guard(proof['before'])+r.rows_guard(proof['rows'])+'COMMIT;')
    target.sql(apply_sql(proof))
    target.sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+postconditions(proof)+'ROLLBACK;')
    proof.update(atomic_apply_rehearsed=True,atomic_sql_sha256=hashlib.sha256(apply_sql(proof).encode()).hexdigest())
    b.json_file(b.workdir()/'212-atomic-proof.json',proof)
    print('::notice title=PR212本番SQL事前リハーサル::PASS exact_atomic_apply_SQL_on_actual_isolated_restore; production_writes_NONE',flush=True)

if __name__=='__main__':
    try:{'apply':apply,'rehearse-apply':rehearse_apply}[sys.argv[1]]()
    except b.BackupError as error:print('::error title=PR212本番安全停止::'+str(error),flush=True);sys.exit(1)
    except Exception as error:print('::error title=PR212本番安全停止::unexpected_'+type(error).__name__+'_details_withheld',flush=True);sys.exit(1)
