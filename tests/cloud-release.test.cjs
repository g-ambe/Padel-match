const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {fixedPairDatabase}=require('./fixtures/fixed-pair-db.cjs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
function python(expression,input){
 return execFileSync('python3',['-B','-c',`import sys,json;sys.path.insert(0,'supabase/maintenance/event-fixed-pairs');import cloud_release as r;data=json.load(sys.stdin);${expression}`],{cwd:root,input:JSON.stringify(input),encoding:'utf8'}).trim();
}
test('承認済みリリースはバックアップ差分・後検証失敗を全体ROLLBACKし、成功時も既存行を維持する',async t=>{
 const {db,event}=await fixedPairDatabase(false);
 try{
  const e=await event(810,6),backup='event_fixed_pair_backup_r123_a1';
  const sql=python("print('BEGIN;'+r.body(r.SQL_ROOT/'02_backup.sql').replace('event_fixed_pair_backup_20261102',data)+'COMMIT;')",backup);
  await db.exec(sql);
  const tables=(await db.query("select n.nspname as schema,c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname not like 'pg_%' and n.nspname<>'information_schema' order by 1,2")).rows;
  const queries=JSON.parse(python("print(json.dumps([r.row_expression(r.b.ident(t['schema'])+'.'+r.b.ident(t['name'])) for t in data]))",tables));
  const rows=[];for(let i=0;i<tables.length;i++)rows.push({...tables[i],...(await db.query('select '+queries[i]+' value')).rows[0].value});
  const manifest={tables,release:{backup_schema:backup}};
  const apply=python('print(r.application_sql(data[0],data[1]))',[manifest,rows]);
  const present=async()=>Boolean((await db.query("select to_regnamespace('fixed_pair_private') is not null value")).rows[0].value);
  await t.test('バックアップ後の対象行変更ではDDL前に停止する',async()=>{
   await db.query("update events set name='変更後' where id=$1",[e.eid]);
   await assert.rejects(db.exec(apply),/バックアップ後に対象データ/);await db.exec('rollback');assert.equal(await present(),false);
   await db.query('update events set name=$1 where id=$2',['合成開催810',e.eid]);
  });
  await t.test('DDL後の検査が失敗しても追加表・ガードを残さない',async()=>{
   const failure=apply.replace("SELECT json_build_object('migration_applied'", ()=>"DO $$ BEGIN RAISE EXCEPTION '合成試験の停止'; END $$;SELECT json_build_object('migration_applied'");
   await assert.rejects(db.exec(failure),/合成試験の停止/);await db.exec('rollback');assert.equal(await present(),false);
  });
  await t.test('正常適用では既存全表の行データ・権限を維持する',async()=>{
   await db.exec(apply);assert.equal(await present(),true);
   for(let i=0;i<tables.length;i++)assert.deepEqual((await db.query('select '+queries[i]+' value')).rows[0].value,{rows:rows[i].rows,sha256:rows[i].sha256});
   for(const name of ['event_fixed_pairs','event_fixed_pair_state','event_fixed_pair_rounds'])assert.equal((await db.query(`select count(*) n from public.${name}`)).rows[0].n,0);
  });
  await t.test('二重適用は拒否し、適用済みオブジェクトを上書きしない',async()=>{
   await assert.rejects(db.exec(apply),/既存オブジェクト/);await db.exec('rollback');assert.equal(await present(),true);
  });
 }finally{await db.close();}
});
