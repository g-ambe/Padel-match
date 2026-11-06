"""PR182の承認前調査・隔離リハーサル専用。本番への修復経路は実装しない。"""
import hashlib
import importlib.util
import json
import os
import re
import sys
import tarfile
import uuid
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[2]
sys.path.insert(0,str(HERE.parent/'event-fixed-pairs'))
import cloud_backup as b
_spec=importlib.util.spec_from_file_location('score_repair_release_common',HERE.parent/'event-fixed-pairs/cloud_release.py')
common=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(common)
BACKUP_RELEASE=436144065
BACKUP_ASSET=716073621
BACKUP_SHA='531a1c2bbcaec1ce3ce1c802b25adab9ab0e48b40b3deb0337565d4e617dfc22'
TABLES=('events','event_participants','rounds','matches','match_players','match_results','clubs','club_members','profiles','player_profiles','app_admins')


def plan_query():
    sql=(HERE/'plan.sql').read_text().strip().rstrip(';')
    return "WITH p AS ("+sql+") SELECT jsonb_build_object('plan',p.coalesce,'sha256',encode(sha256(convert_to(p.coalesce::text,'UTF8')),'hex')) FROM p"


def render(name,batch,plan):
    text=(HERE/name).read_text()
    if text.count('-- REVIEWED_INPUT')!=1:
        raise b.BackupError('repair_input_marker_invalid')
    inject='insert into score_repair_approval values('+b.literal(batch)+','+b.literal(json.dumps(plan['plan'],ensure_ascii=False))+'::jsonb,'+b.literal(plan['sha256'])+',true);'
    return text.replace('-- REVIEWED_INPUT',inject)


def atomic_release_sql(batch,plan):
    repair=render('02_repair_reviewed.sql',batch,plan)
    # 全SQL文を保持し、外側のトランザクションだけを一つにまとめる。
    repair=re.sub(r'(?im)^begin;\s*','',repair,count=1)
    repair=re.sub(r'(?im)^commit;\s*$','',repair,count=1)
    migrations=''.join(common.body(ROOT/'supabase/migrations'/name) for name in ('0041_atomic_round_lineups.sql','0042_round_lineup_safety.sql','0043_match_results_one_per_match.sql'))
    return 'BEGIN;'+repair+migrations+'COMMIT;'


def authority():
    if os.environ.get('PADEL_REPAIR_REVIEW')!='PR182-APPROVAL-PENDING' or os.environ.get('BACKUP_RELEASE_ID')!=str(BACKUP_RELEASE) or os.environ.get('BACKUP_ASSET_ID')!=str(BACKUP_ASSET) or os.environ.get('BACKUP_SHA256')!=BACKUP_SHA:
        raise b.BackupError('repair_review_backup_identity_invalid')
    pr=b.api('/pulls/182')
    if not pr['draft'] or pr['state']!='open' or pr['head']['sha']!=os.environ['BACKUP_SOURCE_SHA'] or pr['head']['ref']!='codex/atomic-round-lineup' or pr['head']['repo']['full_name']!=b.REPOSITORY:
        raise b.BackupError('repair_review_pr_identity_invalid')


def references(query,plan):
    ids=[v['row']['id'] for v in plan['plan'] if v['row']['id']!=v['keeper_id']]
    if not ids:return []
    tables=query("SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) order by c.relname),'[]') FROM pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') and c.relname<>'match_results'")
    values=','.join(b.literal(v)+'::uuid' for v in ids)
    found=[]
    for t in tables:
        rel=b.ident(t['schema'])+'.'+b.ident(t['name'])
        count=query("SELECT to_json(count(*)) FROM "+rel+" z WHERE EXISTS(SELECT 1 FROM unnest(ARRAY["+values+"]) u WHERE strpos(to_jsonb(z)::text,u::text)>0)")
        if count:found.append({'table':t['name'],'referencing_rows':count})
    return found


def dump_stats(target,path):
    value=target.query('SELECT jsonb_build_object('+','.join(b.literal(t)+",(select coalesce(jsonb_agg(to_jsonb(z) order by id),'[]') from public."+b.ident(t)+" z)" for t in TABLES)+')')
    b.json_file(path,value)
    raw=b.run(['node',str(HERE/'stats-proof.cjs'),str(path)],phase='private_app_statistics_failed',env=b.clean_env(),cwd=ROOT,timeout=300)
    return json.loads(raw)


def audit_local(target):
    return target.query(common.body(HERE/'01_audit.sql'))


def result_hash(target):
    return target.query("SELECT to_json(encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,'' order by id),''),'UTF8')),'hex')) FROM public.match_results r")


def expect_failure(target,sql,phase):
    try:target.sql('SET ROLE postgres;'+sql)
    except b.BackupError:return
    raise b.BackupError(phase)


def rehearse():
    authority()
    if os.environ.get('SUPABASE_DB_URL'):
        raise b.BackupError('production_connection_must_not_enter_restore_job')
    root=b.workdir();files,manifest=b.unpack(root)
    target=b.start_isolated_database(root)
    restored=b.restore_files(target,files,manifest)
    plan=target.query(plan_query())
    audit=audit_local(target)
    if audit['totals']['conflicting'] or audit['incoming_foreign_keys'] or audit['null_match_rows'] or audit['orphan_rows']:
        raise b.BackupError('repair_preconditions_require_review')
    refs=references(target.query,plan)
    if refs:raise b.BackupError('result_ids_referenced_in_application_data')
    batch=str(uuid.uuid4());before=result_hash(target)
    before_stats=dump_stats(target,root/'statistics-before.json')
    original_rows=b.row_fingerprints(target.query,manifest['tables'])
    original_catalog=b.catalog(target.query,manifest['tables'],manifest['function_schemas'])
    # 未承認と、1行でも削除に失敗した場合の全体ROLLBACKを実データの隔離コピーで試す。
    expect_failure(target,(HERE/'02_repair_reviewed.sql').read_text(),'unapproved_repair_was_not_blocked')
    if result_hash(target)!=before:raise b.BackupError('unapproved_repair_changed_data')
    target.sql("create function public.score_repair_test_fail() returns trigger language plpgsql as $$begin raise exception '隔離試験の途中失敗';end$$;create trigger score_repair_test_fail before delete on public.match_results for each row execute function public.score_repair_test_fail()")
    expect_failure(target,render('02_repair_reviewed.sql',batch,plan),'injected_repair_failure_not_detected')
    if result_hash(target)!=before:raise b.BackupError('repair_failure_did_not_rollback')
    target.sql('drop trigger score_repair_test_fail on public.match_results;drop function public.score_repair_test_fail()')
    target.sql('SET ROLE postgres;'+render('02_repair_reviewed.sql',batch,plan))
    repaired=result_hash(target);after_stats=dump_stats(target,root/'statistics-after.json')
    if before_stats!=after_stats:raise b.BackupError('visible_statistics_changed')
    after_rows=b.row_fingerprints(target.query,manifest['tables'])
    if [x for x in original_rows if (x['schema'],x['name'])!=('public','match_results')]!=[x for x in after_rows if (x['schema'],x['name'])!=('public','match_results')]:raise b.BackupError('unrelated_rows_changed')
    if b.catalog(target.query,manifest['tables'],manifest['function_schemas'])!=original_catalog:raise b.BackupError('repair_changed_existing_rls_acl_or_schema')
    b.verify_foreign_keys(target,manifest['tables'])
    if audit_local(target)['totals']['matches']!=0:raise b.BackupError('duplicates_remain')
    target.sql('SET ROLE postgres;'+render('02_repair_reviewed.sql',batch,plan))
    if result_hash(target)!=repaired:raise b.BackupError('repeat_repair_changed_data')
    # まず修復だけを完全復旧。後続は別の承認バッチで原子的なリリース全体も検証する。
    recover=render('03_recover_reviewed.sql',batch,plan)
    target.sql('SET ROLE postgres;'+recover)
    if result_hash(target)!=repaired:raise b.BackupError('recovery_preview_changed_data')
    target.sql('SET ROLE postgres;'+re.sub(r'rollback;\s*$','commit;',recover,flags=re.I))
    if result_hash(target)!=before:raise b.BackupError('repair_only_recovery_failed')
    batch=str(uuid.uuid4());atomic=atomic_release_sql(batch,plan)
    fail_atomic=atomic.replace('alter table public.match_results add constraint',"DO $$BEGIN RAISE EXCEPTION '隔離試験の後続Migration失敗';END$$;alter table public.match_results add constraint")
    expect_failure(target,fail_atomic,'atomic_release_failure_not_detected')
    if result_hash(target)!=before or target.query("select to_json(to_regnamespace('lineup_private') is not null)"):raise b.BackupError('atomic_release_did_not_rollback')
    target.sql('SET ROLE postgres;'+atomic)
    if dump_stats(target,root/'statistics-migrated.json')!=before_stats:raise b.BackupError('migration_changed_visible_statistics')
    if result_hash(target)!=repaired:raise b.BackupError('migration_changed_existing_results')
    b.verify_foreign_keys(target,manifest['tables']+[{'schema':'score_repair_182','name':'rows'},{'schema':'score_repair_182','name':'batches'},{'schema':'public','name':'friendly_match_operations'},{'schema':'public','name':'friendly_round_lineup_state'}])
    recover=render('03_recover_reviewed.sql',batch,plan)
    target.sql('SET ROLE postgres;'+recover)
    if result_hash(target)!=repaired:raise b.BackupError('recovery_preview_changed_data')
    recover=re.sub(r'rollback;\s*$','commit;',recover,flags=re.I)
    target.sql('SET ROLE postgres;'+recover)
    if result_hash(target)!=before or dump_stats(target,root/'statistics-restored.json')!=before_stats:raise b.BackupError('original_results_not_recovered')
    target.sql('SET ROLE postgres;'+recover)
    if result_hash(target)!=before:raise b.BackupError('repeat_recovery_changed_data')
    report={'raw_result_rows_before':next(x['rows'] for x in original_rows if x['schema']=='public' and x['name']=='match_results'),'raw_result_rows_after':next(x['rows'] for x in after_rows if x['schema']=='public' and x['name']=='match_results'),'backup_release_id':BACKUP_RELEASE,'restore':restored,'audit':audit,'plan_sha256':plan['sha256'],'batch_id':batch,
            'application_references':refs,'statistics':before_stats,'visible_statistics_unchanged':True,'unrelated_rows_unchanged':True,'original_rls_acl_schema_unchanged':True,
            'failure_rollback_verified':True,'repair_repeat_verified':True,'recovery_verified':True,'recovery_repeat_verified':True,
            'unique_migration_rehearsed':True,'atomic_repair_and_migrations_verified':True,'late_migration_failure_rollback_verified':True,'production_mutations':False,'approval_pending':True}
    b.json_file(root/'repair-plan.json',{'batch_id':batch,**plan})
    b.json_file(root/'repair-report.json',report)
    # 個別ID・実スコア入りの承認対象は暗号化保管だけに使用し、Git・公開ログへ出さない。
    archive=root/'repair-review.tar'
    with tarfile.open(archive,'w') as bundle:
        for name in ('repair-plan.json','repair-report.json'):bundle.add(root/name,arcname=name)
    encrypted=root/'repair-review.tar.gpg';b.gpg(archive,encrypted)
    checksum=hashlib.sha256(encrypted.read_bytes()).hexdigest()
    release=b.api('/releases','POST',{'tag_name':'score-repair-review-'+os.environ['GITHUB_RUN_ID'],'target_commitish':os.environ['BACKUP_SOURCE_SHA'],'draft':True,'name':'PR182 重複結果修復プラン（非公開・承認待ち）','body':'本番への修復は未実行。個別対象は暗号化ファイル内だけで保管。\n\n'+json.dumps({'plan_sha256':plan['sha256'],'archive_sha256':checksum,'backup_release_id':BACKUP_RELEASE,'matches':audit['totals']['matches'],'remove_rows':audit['totals']['extra_rows']},ensure_ascii=False)})
    if not release['draft']:raise b.BackupError('review_release_must_remain_private')
    b.github(['api','--method','POST','https://uploads.github.com/repos/'+b.REPOSITORY+'/releases/'+str(release['id'])+'/assets?name=repair-review.tar.gpg','--header','Content-Type: application/octet-stream','--input',str(encrypted)])
    # バッチIDもログに出さない。承認は公開プランSHAと件数、非公開の対象表に対して取得する。
    report.pop('batch_id');report['private_review_release_id']=release['id'];report['archive_sha256']=checksum
    return report


def main():
    os.umask(0o077)
    try:
        if len(sys.argv)!=2 or sys.argv[1]!='rehearse':raise b.BackupError('production_repair_not_implemented_approval_required')
        result=rehearse()
        print('::notice title=PR182重複修復リハーサル::'+json.dumps(result,ensure_ascii=False))
    except (b.BackupError,b.probe.ProbeError) as e:
        print('::error title=PR182重複修復リハーサル::'+str(e));return 1
    except Exception:
        print('::error title=PR182重複修復リハーサル::unexpected_private_failure');return 1
    return 0
if __name__=='__main__':raise SystemExit(main())
