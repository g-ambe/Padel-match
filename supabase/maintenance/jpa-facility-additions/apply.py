"""ユーザー指示の15施設追加のみ。既存の接続保護を再利用し、テスト/ビルドは実行しない。"""
import hashlib,importlib.util,json,os,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('jpa_addition_connection',ROOT/'supabase/maintenance/event-fixed-pairs/cloud_release.py')
c=importlib.util.module_from_spec(spec);sys.path.insert(0,str(ROOT/'supabase/maintenance/event-fixed-pairs'));spec.loader.exec_module(c)
b=c.b
MIGRATION=ROOT/'supabase/migrations/0053_jpa_add_15_facilities.sql'
SHA='7986357b0cb6842e8a96841d288c52f37da00ec845d0e8657d3934c7cf9042d5'

def apply():
 if os.environ.get('FACILITY_ADDITION_AUTHORIZED')!='JPA15-20261118':raise b.BackupError('0053_not_authorized')
 if hashlib.sha256(MIGRATION.read_bytes()).hexdigest()!=SHA:raise b.BackupError('0053_sql_changed')
 pr=b.api('/pulls/'+str(int(os.environ['FACILITY_PR_NUMBER'])))
 if pr['state']!='open' or pr['head']['repo']['full_name']!=b.REPOSITORY or pr['head']['ref']!='codex/profile-r2-instagram' or pr['head']['sha']!=os.environ['FACILITY_SOURCE_SHA'] or pr['base']['ref']!='main':raise b.BackupError('0053_pr_changed')
 if b.api('/commits/main')['sha']!='e79244b8e9e71d7b3de77518ee404c2d1d162f96':raise b.BackupError('0053_main_changed')
 body=c.body(MIGRATION);q=b.literal
 guard="DO $history$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0053' AND (name IS DISTINCT FROM 'jpa_add_15_facilities' OR statements IS DISTINCT FROM ARRAY["+q(body)+"]::text[])) THEN RAISE EXCEPTION '0053_history_conflict';END IF;END $history$;"
 history="INSERT INTO supabase_migrations.schema_migrations(version,name,statements) SELECT '0053','jpa_add_15_facilities',ARRAY["+q(body)+"]::text[] WHERE NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='0053');"
 result=c.source_sql("BEGIN;SET LOCAL ROLE postgres;"+guard+body+history+'COMMIT;',readonly=False,phase='0053_addition_failed_or_result_unknown_stop')
 print('::notice title=JPA15施設追加結果::'+json.dumps(json.loads(result),ensure_ascii=False),flush=True)

if __name__=='__main__':
 try:apply()
 except b.BackupError as error:print('::error title=施設追加停止::'+str(error));sys.exit(1)
 except Exception as error:print('::error title=施設追加停止::'+type(error).__name__);sys.exit(1)
