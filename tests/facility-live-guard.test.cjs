const {test}=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');
const tables=[{schema:'public',name:'events'},{schema:'public',name:'player_profile_private'},{schema:'public',name:'padel_facilities'},{schema:'supabase_migrations',name:'schema_migrations'}];
const sql=JSON.parse(execFileSync('python3',['-B','-c',`import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('live_guard_sql',Path('supabase/maintenance/shared-home-facility/cloud_release.py'))
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
tables=json.loads(sys.argv[1])
print(json.dumps({'capture':s.c.current_rows_sql(tables),'guard':s.live_rows_guard({'manifest':{'tables':tables}}),'master':s.r.facility_guard([{'id':1,'name':'補正済み施設'}])},ensure_ascii=False))
`,JSON.stringify(tables)],{encoding:'utf8',timeout:20000}));
async function setup(){
 const db=new PGlite();await db.exec(`create table events(id integer primary key,name text);insert into events values(1,'バックアップ後の更新');
 create table player_profile_private(id integer primary key,home_court_name text);insert into player_profile_private values(1,'最新の自由入力');
 create table padel_facilities(id integer primary key,name text);insert into padel_facilities values(1,'旧施設');
 create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text);insert into supabase_migrations.schema_migrations values('0050','既存履歴');`);return db;
}
const approved=`alter table player_profile_private add column home_facility_id uuid;update padel_facilities set name='補正済み施設' where id=1;insert into supabase_migrations.schema_migrations values('0051','new'),('0052','new');`;
test('運用中に更新・追加された最新イベント/自由入力も、適用直前直後の全件照合で保持する',async()=>{
 const db=await setup();try{
 await db.exec("insert into events values(2,'新しいイベント')");const events=(await db.query('select * from events order by id')).rows;
 await db.exec('begin;'+sql.capture+approved+sql.guard+sql.master+'commit;');
 assert.deepEqual((await db.query('select * from events order by id')).rows,events);
 assert.equal((await db.query('select home_court_name from player_profile_private')).rows[0].home_court_name,'最新の自由入力');
 assert.equal((await db.query("select count(*)::int n from pg_class where relname='release_rows_before'")).rows[0].n,0);
 }finally{await db.close();}
});
test('イベント・個人ホームコート・既存履歴の想定外変更は一括で拒否しDDLも戻る',async()=>{
 const db=await setup();try{
 for(const mutation of ["update events set name='壊れた結果' where id=1;","update player_profile_private set home_court_name='失われた入力';","update supabase_migrations.schema_migrations set name='書換え' where version='0050';"]){
 await db.exec('begin;'+sql.capture+approved+mutation);await assert.rejects(db.exec(sql.guard),/live_data_changed_by_migration/);await db.exec('rollback');
 assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='player_profile_private' and column_name='home_facility_id'")).rows[0].n,0);
 assert.equal((await db.query('select home_court_name from player_profile_private')).rows[0].home_court_name,'最新の自由入力');
 }
 }finally{await db.close();}
});
test('施設マスターは全行の承認済み差分で別途照合し、不正な補正も拒否する',async()=>{
 const db=await setup();try{
 await db.exec('begin;'+sql.capture+approved+"update padel_facilities set name='未承認の施設' where id=1;"+sql.guard);
 await assert.rejects(db.exec(sql.master),/unexpected_facility_data_or_id_change/);await db.exec('rollback');
 assert.equal((await db.query('select name from padel_facilities')).rows[0].name,'旧施設');
 }finally{await db.close();}
});
