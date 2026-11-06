const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const {fixedPairDatabase}=require('./fixtures/fixed-pair-db.cjs');
test('クラウド適用SQLは0041・0042を一括確定し、途中失敗・定義変更・バックアップ後の更新を拒否する',async()=>{
 let client;const url=process.env.LINEUP_RELEASE_PG_URL;
 if(url){const u=new URL(url);assert(['127.0.0.1','localhost'].includes(u.hostname)&&u.pathname==='/lineup_release_test');const {Client}=require('pg');client=new Client({connectionString:url});await client.connect();}
 const adapter=client?{query:(s,a)=>client.query(s,a),exec:async s=>{const r=await client.query(s);return Array.isArray(r)?r:[r];}}:undefined;
 const f=await fixedPairDatabase(true,adapter),{db}=f,read=n=>fs.readFileSync('supabase/maintenance/round-lineups/'+n,'utf8');
 try{
  const diagnostic=await db.exec(read('07_readonly_diagnostics.sql'));assert.equal(diagnostic.find(r=>r.rows?.length).rows[0].jsonb_build_object.duplicate_matches,0);
  await f.event(1900,5);await db.exec(read('02_backup.sql').replaceAll('round_lineup_backup_0041','round_lineup_backup_0041_r123_a1'));
  const query=async()=> (await db.exec(read('01_preflight.sql'))).find(r=>r.rows?.[0]?.round_lineup_preflight).rows[0].round_lineup_preflight;
  const preflight=await query();delete preflight.captured_at;delete preflight.version;
  const tables=(await db.query("select table_schema schema,table_name name from information_schema.tables where table_type='BASE TABLE' and table_schema in('public','auth') order by table_schema,table_name")).rows;
  const rows=[];for(const t of tables){const rel='"'+t.schema+'"."'+t.name+'"';const value=(await db.query(`select count(*) rows,encode(sha256(convert_to(coalesce(string_agg(h,'' order by h collate "C"),''),'UTF8')),'hex') sha256 from(select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h from ${rel} t) vals`)).rows[0];rows.push({...t,rows:Number(value.rows),sha256:value.sha256});}
  const manifest={tables,release:{backup_schema:'round_lineup_backup_0041_r123_a1',source_sha:'a'.repeat(40),migrations:JSON.parse(read('reviewed-release.json')).migrations,preflight}};
  const python="import importlib.util,json,sys;from pathlib import Path;p=Path('supabase/maintenance/round-lineups/cloud_release.py');s=importlib.util.spec_from_file_location('lineup_release',p);r=importlib.util.module_from_spec(s);s.loader.exec_module(r);v=json.load(sys.stdin);print(r.application_sql(v['manifest'],v['rows']))";
  const result=spawnSync('python3',['-B','-c',python],{input:JSON.stringify({manifest,rows}),encoding:'utf8',env:{PATH:process.env.PATH,PADEL_RELEASE_AUTHORIZED:'PR182-0041-0042-20261106',BACKUP_SOURCE_SHA:'a'.repeat(40)}});assert.equal(result.status,0,result.stderr);const sql=result.stdout;
  await assert.rejects(db.exec(sql.replace('alter table public.friendly_match_operations drop constraint',()=>"do $$begin raise exception '0042途中失敗';end$$;alter table public.friendly_match_operations drop constraint")),/0042途中失敗/);await db.exec('rollback');assert.equal((await query())['0041_present'],false);
  await db.exec("update events set name='別端末更新' where id='30000000-0000-4000-8000-000000001900'");await assert.rejects(db.exec(sql),/バックアップ後に対象データ/);await db.exec('rollback');await db.exec("update events set name='合成開催1900' where id='30000000-0000-4000-8000-000000001900'");
  await db.exec('grant delete on public.events to anon');await assert.rejects(db.exec(sql),/DB定義/);await db.exec('rollback');await db.exec('revoke delete on public.events from anon');
  await db.exec(sql);assert.equal((await db.query('select editing_enabled from lineup_private.release_control')).rows[0].editing_enabled,false);assert.equal((await query())['0042_present'],true);assert.equal((await db.query('select * from friendly_match_operations')).rows.length,0);
 }finally{if(client)await client.end();else await db.close();}
});

test('読み取り診断は同一得点と食い違う結果を区別し、終了・論理削除を含めて集計する',async()=>{
 const f=await fixedPairDatabase(),{db}=f;
 try{
  for(let i=0;i<4;i++){
   const e=await f.event(1950+i,4,{status:i===1?'closed':'active',deleted:i===2,mode:i===3?'manual':'auto'});
   const rid=(await db.query('insert into rounds(event_id,round_number) values($1,1) returning id',[e.eid])).rows[0].id;
   const mid=(await db.query('insert into matches(event_id,round_id,court_number,completed) values($1,$2,1,true) returning id',[e.eid,rid])).rows[0].id;
   for(let j=0;j<(i===1?3:2);j++)await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,$2,0,'A')",[mid,i===1?j:4]);
  }
  const before=(await db.query('select count(*) n from match_results')).rows[0].n;
  const result=await db.exec(fs.readFileSync('supabase/maintenance/round-lineups/07_readonly_diagnostics.sql','utf8'));
  assert.deepEqual(result.find(r=>r.rows?.length).rows[0].jsonb_build_object,{duplicate_matches:3,extra_result_rows:4,max_results_per_match:3,identical_results:2,conflicting_results:1,active_events:1,closed_events:1,deleted_events:1,completed_matches:3});
  assert.equal((await db.query('select count(*) n from match_results')).rows[0].n,before);
 }finally{await db.close();}
});
