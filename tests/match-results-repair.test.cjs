const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixedPairDatabase,id}=require('./fixtures/fixed-pair-db.cjs');
const root='supabase/maintenance/match-result-repair/',read=n=>fs.readFileSync(root+n,'utf8');
const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const input=(batch,p)=>`insert into score_repair_approval values('${batch}',${literal(p.plan)},'${p.sha256}',true);`;
const render=(file,batch,p)=>read(file).replace('-- REVIEWED_INPUT',()=>input(batch,p));
const planQuery=()=>`with p as (${read('plan.sql').trim().replace(/;$/,'')}) select jsonb_build_object('plan',p.coalesce,'sha256',encode(sha256(convert_to(p.coalesce::text,'UTF8')),'hex')) value from p`;
test('重複修復・監査・復旧・一意制約を隔離SQLで検証する',async t=>{
 let client,monitor,Client;const external=process.env.SCORE_REPAIR_PG_URL;
 if(external){const u=new URL(external);assert(['127.0.0.1','localhost'].includes(u.hostname)&&u.pathname==='/score_repair_test');({Client}=require('pg'));client=new Client({connectionString:external});await client.connect();}
 const adapter=client?{query:(q,a)=>client.query(q,a),exec:async q=>{const r=await client.query(q);return Array.isArray(r)?r:[r];}}:undefined;
 const f=await fixedPairDatabase(true,adapter),{db}=f;let sequence=500000;const uuid=()=>id(sequence++),owner=()=>db.exec('reset role');
 const fingerprint=async()=>JSON.stringify((await db.query('select * from match_results order by id')).rows);
 const planned=async()=>(await db.query(planQuery())).rows[0].value;
 async function card(e,court=1){await owner();let rid=(await db.query('select id from rounds where event_id=$1',[e.eid])).rows[0]?.id;if(!rid)rid=(await db.query('insert into rounds(event_id,round_number) values($1,1) returning id',[e.eid])).rows[0].id;const mid=(await db.query('insert into matches(event_id,round_id,court_number,completed) values($1,$2,$3,false) returning id',[e.eid,rid,court])).rows[0].id;for(let i=0;i<4;i++)await db.query('insert into match_players(match_id,participant_id,team) values($1,$2,$3)',[mid,e.participants[i],i<2?'A':'B']);return mid;}
 try{
  const e=await f.event(2200,6),m1=await card(e),m2=await card(e,2),batch=uuid();
  for(const [mid,count]of [[m1,3],[m2,2]])for(let j=0;j<count;j++)await db.query("insert into match_results(id,match_id,score_a,score_b,winner_team,created_at) values($1,$2,4,0,'A',$3)",[uuid(),mid,j===0?'2026-01-01':j===1?'2026-01-02':null]);
  const p=await planned(),before=await fingerprint(),beforeMatches=JSON.stringify((await db.query('select * from matches order by id')).rows),beforePlayers=JSON.stringify((await db.query('select * from match_players order by id')).rows);
  const fail=async(sql,pattern)=>{await assert.rejects(db.exec(sql),pattern);await db.exec('rollback');assert.equal(await fingerprint(),before);};
  await t.test('承認未設定・食い違う得点・期待値変更では全体停止',async()=>{
   await fail(read('02_repair_reviewed.sql'),/未設定/);await db.query('update match_results set score_a=3 where id=$1',[p.plan[0].row.id]);await assert.rejects(db.exec(render('02_repair_reviewed.sql',batch,p)),/食い違う/);await db.exec('rollback');await db.query('update match_results set score_a=4 where id=$1',[p.plan[0].row.id]);
   const other=structuredClone(p);other.plan[0].match.completed=true;other.sha256=(await db.query("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') x",[JSON.stringify(other.plan)])).rows[0].x;await fail(render('02_repair_reviewed.sql',batch,other),/変化/);
  });
  await t.test('外部キー・JSON参照があれば削除しない',async()=>{
   await db.exec('create table public.result_child(result_id uuid references match_results(id))');await fail(render('02_repair_reviewed.sql',batch,p),/外部キー/);await db.exec('drop table result_child');
   const removed=p.plan.find(x=>x.row.id!==x.keeper_id).row.id;await db.exec('create table public.result_json(payload jsonb)');await db.query('insert into result_json values($1)',[JSON.stringify({id:removed})]);await fail(render('02_repair_reviewed.sql',batch,p),/アプリ内参照/);await db.exec('drop table result_json');
  });
  await t.test('途中失敗で削除・監査DDLも全てROLLBACK',async()=>{
   await db.exec("create function public.repair_failure() returns trigger language plpgsql as $$begin raise exception '途中失敗注入';end$$;create trigger repair_failure before delete on match_results for each row execute function public.repair_failure()");await fail(render('02_repair_reviewed.sql',batch,p),/途中失敗注入/);assert.equal((await db.query("select to_regnamespace('score_repair_182') n")).rows[0].n,null);await db.exec('drop trigger repair_failure on match_results;drop function repair_failure()');
  });
  await t.test('最古日時・UUID順で正本を保持、全対象行を監査し再送は無変更',async()=>{
   await db.exec(render('02_repair_reviewed.sql',batch,p));const rows=(await db.query('select * from match_results')).rows;assert.equal(rows.length,2);for(const r of rows)assert.equal(new Date(r.created_at).toISOString().slice(0,10),'2026-01-01');assert.equal((await db.query('select * from score_repair_182.rows')).rows.length,5);assert.equal((await db.query('select removed_rows from score_repair_182.batches')).rows[0].removed_rows,3);
   assert.equal(JSON.stringify((await db.query('select * from matches order by id')).rows),beforeMatches);assert.equal(JSON.stringify((await db.query('select * from match_players order by id')).rows),beforePlayers);
   const after=await fingerprint();await db.exec(render('02_repair_reviewed.sql',batch,p));assert.equal(await fingerprint(),after);
   await f.as();await assert.rejects(db.query('select * from score_repair_182.rows'),/permission denied/);await owner();
  });
  await t.test('0041/42/43適用、手動イベントも一意、既存RLSを維持',async()=>{
   const policies=JSON.stringify((await db.query("select * from pg_policies where tablename in('events','matches','match_players','match_results') order by tablename,policyname")).rows);
   for(const n of ['0041_atomic_round_lineups.sql','0042_round_lineup_safety.sql','0043_match_results_one_per_match.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
   assert.equal(JSON.stringify((await db.query("select * from pg_policies where tablename in('events','matches','match_players','match_results') order by tablename,policyname")).rows),policies);
   const manual=await f.event(2201,4,{mode:'manual'}),mid=await card(manual);await f.as();await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,0,0,'draw')",[mid]);await assert.rejects(db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,0,0,'draw')",[mid]),/unique/);await owner();await db.query('delete from match_results where match_id=$1',[mid]);await db.query('delete from matches where id=$1',[mid]);
  });
  await t.test('復旧プレビューは変更せず、明示復旧は全ID・日時を戻し再実行も無変更',async()=>{
   const after=await fingerprint();await db.exec(render('03_recover_reviewed.sql',batch,p));assert.equal(await fingerprint(),after);
   const recover=render('03_recover_reviewed.sql',batch,p).replace(/rollback;\s*$/i,'commit;');await db.exec(recover);assert.equal(await fingerprint(),before);assert.equal((await db.query("select count(*) n from pg_constraint where conname='match_results_one_per_match'")).rows[0].n,0);await db.exec(recover);assert.equal(await fingerprint(),before);
  });
  await t.test('修復後の正本更新があれば復旧を拒否し、データを上書きしない',async()=>{
   const batch2=uuid();await db.exec(render('02_repair_reviewed.sql',batch2,p));await db.query('update match_results set score_a=5 where match_id=$1',[m1]);const changed=await fingerprint();await assert.rejects(db.exec(render('03_recover_reviewed.sql',batch2,p).replace(/rollback;\s*$/i,'commit;')),/修復後に結果/);await db.exec('rollback');assert.equal(await fingerprint(),changed);await db.query('update match_results set score_a=4 where match_id=$1',[m1]);
  });
  if(client){
   await db.exec(fs.readFileSync('supabase/migrations/0043_match_results_one_per_match.sql','utf8'));
   monitor=new Client({connectionString:external});await monitor.connect();
   const connection=async()=>{const c=new Client({connectionString:external});await c.connect();await c.query("select set_config('request.jwt.claim.sub',$1,false)",[id(3)]);await c.query('set role authenticated');return c;};
   for(const order of ['legacy/legacy','rpc/legacy','legacy/rpc'])await t.test('PostgreSQL複数接続・一意制約: '+order,async()=>{
    const ev=await f.event(sequence++,4,{mode:order==='legacy/legacy'?'manual':'auto'}),mid=await card(ev),players=(await db.query('select participant_id,team from match_players where match_id=$1 order by team,participant_id',[mid])).rows;
    const c1=await connection(),c2=await connection();const call=(c,kind)=>kind==='legacy'?c.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,0,0,'draw')",[mid]):c.query('select save_friendly_match_score($1,$2,0,$3,$4,0,0,$5)',[ev.eid,mid,JSON.stringify(players),JSON.stringify({completed:false,results:[]}),uuid()]);
    try{const[a,b]=order.split('/');await c1.query('begin');await call(c1,a);let done=false;const pending=call(c2,b).then(()=>({ok:true}),err=>({error:err})).finally(()=>done=true);await new Promise(r=>setTimeout(r,100));assert.equal(done,false);await c1.query('commit');const result=await pending;assert(result.error);assert.equal(Number((await db.query('select count(*) n from match_results where match_id=$1',[mid])).rows[0].n),1);}finally{await c1.query('rollback');await c1.end();await c2.end();}
   });
  }
 }finally{if(monitor)await monitor.end();if(client)await client.end();else await db.close();}
});
