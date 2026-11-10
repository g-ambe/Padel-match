"""PR191限定の本番互換性確認・0045適用。秘密情報と実データは出力しない。"""
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import sys
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / 'event-fixed-pairs'))
import cloud_backup as b

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

common = module('team191_common', HERE.parent / 'event-fixed-pairs/cloud_release.py')
attendance = module('team191_attendance', HERE.parent / 'team-attendance/cloud_release.py')
MIGRATION = ROOT / 'supabase/migrations/0045_friendly_team_random_rounds.sql'
MIGRATION_SHA = '1ab4a4db4e95e999ba6b5e62cf38dfa2cd72aa5a8682ae86e3ef89012367796c'
MAIN_SHA = 'de7286c9a0ea333334d8a9db085385c31e094e97'
NEW_COLUMNS = ['round_id','round_number','court_number','pair_1_score','pair_2_score','pair_result','generation_mode'] + [p+s for p in ('team_a_player1','team_a_player2','team_b_player1','team_b_player2') for s in ('_source_side','_guest_id')]
RPCS = ['get_friendly_team_round_context','create_friendly_team_round','update_friendly_team_round_card','delete_friendly_team_round_card']
q = b.literal
require = attendance.require

def authority(smoke=False):
    require(hashlib.sha256(MIGRATION.read_bytes()).hexdigest() == MIGRATION_SHA, '0045_reviewed_sql_changed')
    pr = b.api('/pulls/191')
    require(pr['head']['repo']['full_name'] == b.REPOSITORY and pr['head']['ref'] == 'codex/friendly-team-random-rounds' and pr['head']['sha'] == os.environ['BACKUP_SOURCE_SHA'], '0045_head_changed')
    require(pr['merged'] if smoke else pr['state']=='open', '0045_pr_state_changed')
    require(b.api('/commits/main')['sha'] == (pr['merge_commit_sha'] if smoke else MAIN_SHA), '0045_main_changed')
    checks = b.api('/commits/' + pr['head']['sha'] + '/check-runs')['check_runs']
    require(not any(c['name'] != 'Workers Builds: padel-match-staging' and c['status']=='completed' and c['conclusion'] not in ('success','neutral','skipped') for c in checks), '0045_github_check_failed')

def select_backup():
    # 対象runを固定し、別のバックアップ／再実行へ自動的に切り替えない。
    run_id=os.environ['BACKUP_RUN_ID']
    require(run_id.isdigit(),'0045_backup_run_invalid')
    run=b.api('/actions/runs/'+run_id)
    require(run['conclusion']=='success' and run['head_sha']==MAIN_SHA and run['run_attempt']==1 and run['path']=='.github/workflows/cloud-db-backup.yml','0045_backup_and_restore_not_successful')
    release=b.api('/releases/'+str(int(os.environ['BACKUP_RELEASE_ID'])))
    require(release['name'].endswith(' '+run_id) and release['draft'] and '復元確認：成功' in release['body'],'0045_verified_private_backup_missing')
    record=json.loads(release['body'].split('\n\n')[-1])
    require(bool(re.fullmatch('[0-9a-f]{64}',record['sha256'])) and record['sha256']==os.environ['BACKUP_SHA256'],'0045_backup_hash_invalid')
    assets=[v for v in release['assets'] if v['name']=='backup.tar.gpg' and v['id']==int(os.environ['BACKUP_ASSET_ID'])]
    require(len(assets)==1,'0045_backup_asset_invalid')
    print('PASS: pinned_backup_run_private_asset_hash_and_actual_restore',flush=True)

def probes(target, manifest):
    result=[]
    def capture(sql):
        value=target.query(sql)
        result.append({'sql':sql,'value':copy.deepcopy(value)})
        return value
    exists=target.query("SELECT to_json(to_regclass('public.event_team_rounds') IS NOT NULL)")
    tables=manifest['tables']+([{'schema':'public','name':'event_team_rounds'}] if exists else [])
    schemas=manifest['function_schemas']+(['team_rounds_private'] if exists else [])
    b.catalog(capture,tables,schemas)
    capture(b.ROLE_METADATA)
    capture(attendance.DEFAULT_ACL)
    return result

def guard(values):
    return attendance.catalog_guard(values).replace("0044_catalog_changed","0045_catalog_changed")

def old_catalog_unchanged(before,after):
    def normalize(values):
        out=[]
        for original in values:
            v=copy.deepcopy(original)
            if "n.nspname='team_rounds_private'" in v['sql'] or "'\"public\".\"event_team_rounds\"'::regclass" in v['sql']:
                continue
            value=v['value']
            if isinstance(value,dict) and 'columns' in value and "'\"public\".\"event_team_matches\"'::regclass" in v['sql']:
                value['columns']=[c for c in value['columns'] if c[0] not in NEW_COLUMNS]
                names={'team_round_metadata','team_round_sources','team_round_scores','team_round_identity'} | {'event_team_matches_'+c+suffix for c in NEW_COLUMNS for suffix in ('_check','_fkey')}
                value['constraints']=[c for c in value['constraints'] if c[0] not in names]
                value['indexes']=[i for i in value['indexes'] if i[0]!='team_round_court_unique']
                value['triggers']=[t for t in value['triggers'] if t[0] not in ('a_team_round_write','team_round_identity')]
            if isinstance(value,list) and value and isinstance(value[0],dict) and 'arguments' in value[0]:
                value=[f for f in value if f['name'] not in RPCS]
                for f in value:
                    if f['name']=='set_friendly_team_attendance':
                        f['definition']='reviewed replacement in immutable 0045'
                v['value']=value
            out.append(v)
        return out
    require(normalize(before)==normalize(after),'0045_existing_catalog_unexpected_change')

def expression(relation):
    sql=common.row_expression(relation)
    if relation=='"public"."event_team_matches"':
        sql=sql.replace('to_jsonb(t)::text', '(to_jsonb(t)-ARRAY['+','.join(q(c) for c in NEW_COLUMNS)+'])::text')
    return sql

def rows_guard(rows):
    return 'DO $rows$ BEGIN '+''.join('IF '+expression(b.ident(r['schema'])+'.'+b.ident(r['name']))+' IS DISTINCT FROM '+q(json.dumps({'rows':r['rows'],'sha256':r['sha256']}))+"::jsonb THEN RAISE EXCEPTION '0045_existing_rows_changed' USING ERRCODE='40001'; END IF;" for r in rows)+'END $rows$;'

def verify_sql():
    return """DO $verify$ BEGIN
 PERFORM profile_link_private.check_reference_schema();
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.event_team_rounds'::regclass)
 OR NOT has_table_privilege('authenticated','public.event_team_rounds','SELECT')
 OR has_table_privilege('authenticated','public.event_team_rounds','INSERT,UPDATE,DELETE')
 OR has_table_privilege('anon','public.event_team_rounds','SELECT,INSERT,UPDATE,DELETE')
 OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('get_friendly_team_round_context','create_friendly_team_round','update_friendly_team_round_card','delete_friendly_team_round_card') AND prosecdef AND proconfig @> ARRAY['search_path=""'] AND has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE'))<>4
 OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='team_rounds_private'::regnamespace AND (has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE')))
 OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.event_team_matches'::regclass AND tgname IN ('a_team_round_write','team_round_identity') AND tgenabled='O')<>2
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.event_team_matches'::regclass AND conname='team_round_scores' AND convalidated)
 THEN RAISE EXCEPTION '0045_security_verification_failed'; END IF;
 PERFORM team_rounds_private.check_round(id) FROM public.event_team_rounds;
END $verify$;"""

class Production:
    def sql(self,sql):
        return common.source_sql(sql,readonly=False,phase='0045_dedicated_event_failed')
    def query(self,sql):
        return json.loads(common.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+sql+';ROLLBACK;'))

def preflight():
    authority()
    common.source_sql((HERE/'01_preflight.sql').read_text(),phase='0045_readonly_preflight_failed')
    value=Production().query("SELECT json_build_object('before',to_regclass('public.event_team_rounds') IS NULL,'attendance',to_regclass('public.event_team_attendance') IS NOT NULL,'attendance_rpc',to_regprocedure('public.set_friendly_team_attendance(uuid,text,uuid,uuid,text)') IS NOT NULL)")
    require(all(value.values()),'0045_production_prerequisite_failed')
    print('PASS: production_readonly_preflight_0044_and_reference_schema',flush=True)


def functional(target, production=False):
    # 既存所属の読取りだけ。書込みはランダムIDの専用開催とその子行に限定。
    actor=target.query("""SELECT row_to_json(x) FROM (SELECT cm.club_id,coalesce(pp.linked_auth_user_id,cm.profile_id) actor FROM public.club_members cm JOIN public.player_profiles pp ON pp.id=coalesce(cm.player_profile_id,cm.profile_id) JOIN public.clubs c ON c.id=cm.club_id WHERE cm.is_active AND pp.is_active AND NOT c.is_deleted AND cm.role IN ('main_admin','sub_admin') AND coalesce(pp.linked_auth_user_id,cm.profile_id) IS NOT NULL ORDER BY cm.id LIMIT 1) x""")
    require(bool(actor),'0045_no_test_actor')
    eid=str(uuid.uuid4())
    def auth(role='authenticated',uid=None):
        uid=uid or actor['actor']
        return 'SET request.jwt.claim.sub='+q(uid)+';SET request.jwt.claims='+q(json.dumps({'sub':uid,'role':role}))+';SET ROLE '+role+';'
    def call(name,args):
        sql='SELECT public.'+name+'('+','.join('NULL' if v is None else q(v if isinstance(v,str) else json.dumps(v)) for v in args)+');'
        raw=target.sql(auth()+sql)
        return json.loads(raw) if raw.strip() else None
    def rejected(sql,states=('P0001','40001','42501','23514')):
        try:target.sql(sql)
        except b.BackupError as e:
            require(str(e).split('/')[-1] in states,'0045_unexpected_test_error')
        else:raise b.BackupError('0045_expected_rejection_missing')
    label='PR191本番動作確認' if production else 'PR191隔離動作確認'
    target.sql('SET ROLE postgres;INSERT INTO public.events(id,name,court_count,event_mode,stats_mode,created_by_auth_user_id) VALUES('+q(eid)+','+q(label)+",2,'team','record_only',"+q(actor['actor'])+');INSERT INTO public.event_team_sides(event_id,side,club_id,team_name) VALUES('+q(eid)+",'team_a',"+q(actor['club_id'])+",'検証A'),("+q(eid)+",'team_b',"+q(actor['club_id'])+",'検証B');"+''.join('INSERT INTO public.event_team_guests(event_id,side,guest_name) VALUES('+q(eid)+','+q(side)+','+q('検証ゲスト'+str(n))+');' for side in ('team_a','team_b') for n in range(5)))
    # 同名でも異なるチームのゲストIDは独立。既存手動カードの得点経路を検証。
    mid=str(uuid.uuid4())
    target.sql(auth()+"INSERT INTO public.event_team_matches(id,event_id,match_order,team_a_player1_guest_name,result) VALUES("+q(mid)+','+q(eid)+",1,'検証ゲスト0','undecided');UPDATE public.event_team_matches SET team_a_score=4,team_b_score=2,result='win' WHERE id="+q(mid)+';')
    require(target.query('SELECT to_json(team_a_score=4 AND team_b_score=2) FROM public.event_team_matches WHERE id='+q(mid)),'0045_manual_score_failed')
    def context():return call('get_friendly_team_round_context',[eid])
    def cards(ctx,mode):
        aa=[p for p in ctx['roster'] if p['source']=='team_a' and p.get('guest_id')]
        bb=[p for p in ctx['roster'] if p['source']=='team_b' and p.get('guest_id')]
        return [{'court':1,'pairs':[[aa[0],bb[0]],[aa[1],bb[1]]] if mode=='mixed' else [[aa[0],aa[1]],[bb[0],bb[1]]]}]
    ctx=context();missing=next(p for p in ctx['roster'] if p['source']=='team_b' and p.get('guest_id'))
    call('set_friendly_team_attendance',[eid,'team_b',None,missing['guest_id'],'absent'])
    rejected(auth()+'SELECT public.create_friendly_team_round('+','.join(map(q,[eid,str(uuid.uuid4()),ctx['revision'],'mixed','2',json.dumps(cards(ctx,'mixed'))]))+');')
    require(not any(p.get('guest_id')==missing['guest_id'] for p in context()['roster']),'0045_absent_in_roster')
    call('set_friendly_team_attendance',[eid,'team_b',None,missing['guest_id'],'active'])
    for mode in ('confrontation','mixed'):
        ctx=context();args=[eid,str(uuid.uuid4()),ctx['revision'],mode,2,cards(ctx,mode)]
        bad=copy.deepcopy(args);bad[1]=str(uuid.uuid4());bad[5][0]['pairs'][1][1]=bad[5][0]['pairs'][0][0]
        rejected(auth()+'SELECT public.create_friendly_team_round('+','.join(q(v if isinstance(v,str) else json.dumps(v)) for v in bad)+');')
        result=call('create_friendly_team_round',args)
        require(call('create_friendly_team_round',args)==result,'0045_retry_duplicate')
        m=target.query('SELECT to_jsonb(m) FROM public.event_team_matches m WHERE round_id='+q(result['round_id']))
        patch={'team_a_score':4,'team_b_score':2,'result':'win'}
        call('update_friendly_team_round_card',[eid,m['id'],m,patch])
        call('update_friendly_team_round_card',[eid,m['id'],m,patch])
        rejected(auth()+'SELECT public.update_friendly_team_round_card('+','.join(q(v if isinstance(v,str) else json.dumps(v)) for v in [eid,m['id'],m,{'team_a_score':5}])+');')
        if mode=='mixed':
            require(target.query("SELECT to_json(team_a_score IS NULL AND team_b_score IS NULL AND result='undecided' AND pair_1_score=4 AND pair_2_score=2) FROM public.event_team_matches WHERE id="+q(m['id'])),'0045_mixed_legacy_score_leak')
    rejected(auth(role='anon')+'SELECT public.get_friendly_team_round_context('+q(eid)+');')
    rejected(auth(uid=str(uuid.uuid4()))+'SELECT public.get_friendly_team_round_context('+q(eid)+');')
    rows=target.query('SELECT json_agg(to_jsonb(m) ORDER BY match_order) FROM public.event_team_matches m WHERE event_id='+q(eid))
    # 集計関数を実DBの専用開催データで実行。実データはstdinのみ、出力は成否だけ。
    code="require('./tests/fixtures/friendly-round-helpers.cjs');require('node:module').registerHooks({resolve(s,c,n){return n(s==='./friendly-team-rounds'?s+'.ts':s,c)}});const f=require('./lib/friendly-team-results.ts').friendlyTeamStats;const r=JSON.parse(require('fs').readFileSync(0,'utf8'));const s=f(r,['A','B'],(source,p,g)=>p||g);require('assert/strict').equal(s.countedMatches,2);require('assert/strict').equal(s.allCountedMatches,3);require('assert/strict').equal(s.teams[0].scored,8);"
    b.run(['node','-e',code],phase='0045_real_data_aggregation_failed',data=json.dumps(rows).encode(),env=b.clean_env(),cwd=ROOT)
    if production:
        target.sql("SET ROLE postgres;UPDATE public.events SET status='closed',is_deleted=true WHERE id="+q(eid)+' AND name='+q(label)+" AND stats_mode='record_only';")
    else:
        target.sql('SET ROLE postgres;DELETE FROM public.events WHERE id='+q(eid)+';')
    return {'dedicated_event_only':True,'manual_score':True,'confrontation_and_mixed':True,'idempotent_retry':True,'stale_score_rejected':True,'absent_duplicate_and_permissions':True,'mixed_team_stats_excluded':True,'test_event_hidden':production}

def statistics_fingerprint(target):
    rows=target.query("SELECT coalesce(json_agg(to_jsonb(m) ORDER BY event_id,match_order,id),'[]'::json) FROM public.event_team_matches m")
    code="require('./tests/fixtures/friendly-round-helpers.cjs');require('node:module').registerHooks({resolve(s,c,n){return n(s==='./friendly-team-rounds'?s+'.ts':s,c)}});const f=require('./lib/friendly-team-results.ts').friendlyTeamStats;const r=JSON.parse(require('fs').readFileSync(0,'utf8'));const events=new Map();for(const m of r){if(!events.has(m.event_id))events.set(m.event_id,[]);events.get(m.event_id).push(m)}const stats=[...events].map(([id,rows])=>[id,f(rows,['A','B'],(source,p,g)=>p||source+':'+g)]);process.stdout.write(require('crypto').createHash('sha256').update(JSON.stringify(stats)).digest('hex'));"
    return b.run(['node','-e',code],phase='0045_existing_statistics_failed',data=json.dumps(rows).encode(),env=b.clean_env(),cwd=ROOT).decode()

def rehearse():
    authority()
    root=b.workdir();files,manifest=b.unpack(root)
    require(0<=(datetime.now(timezone.utc)-datetime.fromisoformat(manifest['captured_at'])).total_seconds()<14400,'0045_backup_not_recent')
    target=b.start_isolated_database(root)
    restored=b.restore_files(target,files,manifest)
    attendance.align_isolated_defaults(target)
    target.sql('SET ROLE postgres;'+(HERE/'01_preflight.sql').read_text())
    before=probes(target,manifest)
    statistics=statistics_fingerprint(target)
    # 最新本番と復元されたカタログをSELECTのみで完全比較。差異時には適用しない。
    common.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+guard(before)+'ROLLBACK;',phase='0045_production_restore_catalog_differs')
    rows=json.loads((files/'rows.json').read_text())
    target.sql('SET ROLE postgres;'+MIGRATION.read_text()+verify_sql()+rows_guard(rows))
    target.sql('SET ROLE postgres;'+(HERE/'02_verify.sql').read_text())
    after=probes(target,manifest);old_catalog_unchanged(before,after)
    require(statistics_fingerprint(target)==statistics,'0045_existing_statistics_changed')
    result=functional(target)
    target.sql('SET ROLE postgres;'+rows_guard(rows))
    # ロールバックは外部ネットワークのない隔離コンテナだけ。
    target.sql('SET ROLE postgres;'+(HERE/'04_rollback_empty.sql').read_text().replace('ROLLBACK;','COMMIT;'))
    target.sql(guard(before))
    target.sql(MIGRATION.read_text()+verify_sql()+rows_guard(rows)+guard(after))
    b.json_file(root/'team191-proof.json',{'head':os.environ['BACKUP_SOURCE_SHA'],'main':MAIN_SHA,'migration':MIGRATION_SHA,'backup':os.environ['BACKUP_SHA256'],'before':before,'after':after,'manifest':manifest,'rows':rows,'statistics':statistics})
    return dict(restored,**result,existing_rows_and_security_unchanged=True,empty_rollback_reapply=True)

def apply():
    require(os.environ.get('PADEL_RELEASE_AUTHORIZED')=='PR191-0045-20261110','0045_production_not_authorized')
    authority();root=b.workdir();proof=json.loads((root/'team191-proof.json').read_text())
    require(proof['head']==os.environ['BACKUP_SOURCE_SHA'] and proof['main']==MAIN_SHA and proof['migration']==MIGRATION_SHA and proof['backup']==os.environ['BACKUP_SHA256'],'0045_proof_changed')
    # 短時間のpublic対象テーブルロック中に、バックアップ後のデータ／権限変化を拒否。
    locks=','.join(b.ident(t['schema'])+'.'+b.ident(t['name']) for t in proof['manifest']['tables'] if t['schema']=='public')
    sql="BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='5s';"+b.SQL_SETTINGS+'LOCK TABLE '+locks+' IN SHARE ROW EXCLUSIVE MODE;'+guard(proof['before'])+common.assert_rows(proof['rows'])+common.body(MIGRATION)+verify_sql()+guard(proof['after'])+rows_guard(proof['rows'])+"SELECT json_build_object('0045_applied',true,'existing_rows_unchanged',true,'catalog_matches_rehearsal',true);COMMIT;"
    result=json.loads(common.source_sql(sql,readonly=False,phase='0045_atomic_apply_failed_or_response_unknown'))
    common.source_sql('BEGIN READ ONLY;'+b.SQL_SETTINGS+verify_sql()+guard(proof['after'])+rows_guard(proof['rows'])+'ROLLBACK;')
    common.source_sql((HERE/'02_verify.sql').read_text())
    require(statistics_fingerprint(Production())==proof['statistics'],'0045_production_statistics_changed')
    authority()
    return result

def main():
    try:
        action=sys.argv[1]
        if action=='select-backup':select_backup();return
        if action=='preflight':preflight();return
        if action=='smoke':
            authority(smoke=True)
            result=functional(Production(),production=True)
        elif action=='rehearse':result=rehearse()
        elif action=='apply':result=apply()
        else:raise b.BackupError('0045_action_invalid')
        print(json.dumps(result,ensure_ascii=False),flush=True)
    except b.BackupError as error:
        print('::error title=PR191安全停止::'+str(error),flush=True);sys.exit(1)
    except Exception:
        print('::error title=PR191安全停止::unexpected_release_error_details_withheld',flush=True);sys.exit(1)

if __name__=='__main__':main()
