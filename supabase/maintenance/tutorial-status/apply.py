"""PR193の承認済み0046のみ。user_preferencesに限定し、実データを出力しない。"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'supabase/maintenance/event-fixed-pairs'))
import cloud_backup as b
spec=importlib.util.spec_from_file_location('release_connection',ROOT/'supabase/maintenance/event-fixed-pairs/cloud_release.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
SQL=ROOT/'supabase/migrations/0046_user_preferences_tutorial_status.sql'
SHA='97f7c9d297511a2c0c48c75668a0141b043454134c2452091525b5fcb9a28a45'
MAIN='078082d953b2f0f5a52730a2833e47382bb167b5'
# このテーブルの既存列・CHECK/FK・RLS・ACL・トリガーだけを比較する。
CATALOG="""SELECT jsonb_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text,
'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attacl::text) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'tutorial_status'),
'constraints',(SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid AND conname<>'user_preferences_tutorial_status_check'),
'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='user_preferences'),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid),md5(pg_get_functiondef(t.tgfoid))) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) FROM pg_class c WHERE c.oid='public.user_preferences'::regclass"""
ROWS="SELECT md5(coalesce(jsonb_agg(to_jsonb(p)-'tutorial_status' ORDER BY auth_user_id),'[]'::jsonb)::text) FROM public.user_preferences p"

def authority():
 if os.environ.get('PADEL_TUTORIAL_SCHEMA_AUTHORIZED')!='PR193-0046':raise b.BackupError('0046_not_authorized')
 if hashlib.sha256(SQL.read_bytes()).hexdigest()!=SHA:raise b.BackupError('0046_reviewed_sql_changed')
 pr=b.api('/pulls/193')
 if pr['state']!='open' or pr['head']['repo']['full_name']!=b.REPOSITORY or pr['head']['ref']!='codex/tutorial-manual-menu' or pr['head']['sha']!=os.environ['TUTORIAL_SOURCE_SHA']:raise b.BackupError('0046_pr_head_changed')
 if b.api('/commits/main')['sha']!=MAIN:raise b.BackupError('0046_main_changed')

def apply():
 authority()
 # 読取り専用の対象確認。秘密情報・UID・実際の設定値は返さない。
 pre="""BEGIN READ ONLY;SELECT json_build_object('preferences_present',to_regclass('public.user_preferences') IS NOT NULL,'0045_present',to_regclass('public.event_team_rounds') IS NOT NULL,'0046_absent',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_preferences' AND column_name='tutorial_status'));ROLLBACK;"""
 result=json.loads(c.source_sql(pre))
 if not all(result.values()):raise b.BackupError('0046_target_or_migration_state_differs')
 print('::notice title=0046対象確認::target_and_previous_migration_PASS',flush=True)
 sql="""BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';SET LOCAL search_path='';SET LOCAL timezone='UTC';
 LOCK TABLE public.user_preferences IN SHARE ROW EXCLUSIVE MODE;
 DO $apply$ DECLARE before_catalog jsonb; before_rows text; after_rows text; actor uuid; prior_theme text; n integer;
 BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='user_preferences')<>4
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_preferences' AND column_name='auth_user_id' AND data_type='uuid')
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_preferences' AND column_name='theme_mode' AND data_type='text' AND is_nullable='NO' AND column_default='''dark''::text')
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.user_preferences'::regclass)
 OR NOT has_table_privilege('authenticated','public.user_preferences','SELECT')
 OR NOT has_table_privilege('authenticated','public.user_preferences','INSERT')
 OR NOT has_table_privilege('authenticated','public.user_preferences','UPDATE')
 THEN RAISE EXCEPTION '0046_preferences_structure_differs'; END IF;
 SELECT value INTO before_catalog FROM (CATALOG_QUERY) x(value);
 SELECT value INTO before_rows FROM (ROWS_QUERY) x(value);
 EXECUTE MIGRATION_LITERAL;
 IF (SELECT value FROM (CATALOG_QUERY) x(value)) IS DISTINCT FROM before_catalog
 THEN RAISE EXCEPTION '0046_existing_security_or_columns_changed'; END IF;
 SELECT value INTO after_rows FROM (ROWS_QUERY) x(value);
 IF after_rows IS DISTINCT FROM before_rows OR EXISTS(SELECT 1 FROM public.user_preferences WHERE tutorial_status<>'unseen')
 THEN RAISE EXCEPTION '0046_existing_data_changed'; END IF;
 -- 書込み可能性の確認は本人RLSの下でstatusだけを変更し、必ず内部ROLLBACKする。
 BEGIN
  SELECT auth_user_id,theme_mode INTO actor,prior_theme FROM public.user_preferences ORDER BY auth_user_id LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION '0046_no_preference_row_for_reversible_probe'; END IF;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF EXISTS(SELECT 1 FROM public.user_preferences WHERE auth_user_id<>actor) THEN RAISE EXCEPTION '0046_owner_scope_failed'; END IF;
  UPDATE public.user_preferences SET tutorial_status='dismissed' WHERE auth_user_id=actor;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION '0046_status_update_failed'; END IF;
  UPDATE public.user_preferences SET tutorial_status='completed' WHERE auth_user_id=actor;
  IF NOT EXISTS(SELECT 1 FROM public.user_preferences WHERE auth_user_id=actor AND tutorial_status='completed' AND theme_mode=prior_theme) THEN RAISE EXCEPTION '0046_status_read_or_theme_preservation_failed'; END IF;
  EXECUTE 'RESET ROLE';
  RAISE SQLSTATE 'PZ046';
 EXCEPTION WHEN SQLSTATE 'PZ046' THEN NULL;
 END;
 IF (SELECT value FROM (ROWS_QUERY) x(value)) IS DISTINCT FROM before_rows OR EXISTS(SELECT 1 FROM public.user_preferences WHERE tutorial_status<>'unseen')
 THEN RAISE EXCEPTION '0046_probe_not_rolled_back'; END IF;
 END $apply$;
 SELECT json_build_object('0046_applied',true,'existing_preferences_and_security_unchanged',true,'owner_status_read_write',true,'probe_rolled_back',true);COMMIT;"""
 sql=sql.replace('CATALOG_QUERY',CATALOG).replace('ROWS_QUERY',ROWS).replace('MIGRATION_LITERAL',b.literal(c.body(SQL)))
 result=json.loads(c.source_sql(sql,readonly=False,phase='0046_atomic_apply_failed_or_response_unknown'))
 post=json.loads(c.source_sql("""BEGIN READ ONLY;SELECT json_build_object('column_ready',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_preferences' AND column_name='tutorial_status' AND data_type='text' AND is_nullable='NO' AND column_default='''unseen''::text'),'check_ready',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.user_preferences'::regclass AND conname='user_preferences_tutorial_status_check' AND convalidated),'own_update_allowed',has_column_privilege('authenticated','public.user_preferences','tutorial_status','UPDATE'));ROLLBACK;"""))
 if not all(post.values()):raise b.BackupError('0046_postcommit_check_failed_preserve_database')
 authority()
 print('::notice title=0046適用結果::'+json.dumps(dict(result,**post)),flush=True)

if __name__=='__main__':
 try:apply()
 except b.BackupError as e:print('::error title=0046安全停止::'+str(e),flush=True);sys.exit(1)
 except Exception:print('::error title=0046安全停止::unexpected_error_details_withheld',flush=True);sys.exit(1)
