// Dedicated loopback PostgreSQL only; real locks, synthetic SQL Auth claims (not GoTrue).
const assert=require('node:assert/strict'),{Client}=require('pg');
const {lineupFixture}=require('../fixtures/lineup-home-court-candidates.cjs');
const address=process.env.PR269_PG_URL||'postgresql://postgres:pr269-local-only@127.0.0.1:55439/lineup_test';
const parsed=new URL(address);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.port,'55439');assert.equal(parsed.pathname,'/lineup_test');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const a=new Client({connectionString:address,application_name:'pr269-a'}),b=new Client({connectionString:address,application_name:'pr269-b'}),monitor=new Client({connectionString:address,application_name:'pr269-monitor'});
 await a.connect();await b.connect();await monitor.connect();
 try{
  assert.equal((await a.query('select current_database() db,current_user who,current_setting(\'server_version_num\')::int/10000 major')).rows[0].major,17);
  assert.equal((await a.query("select to_regclass('public.events') is null fresh")).rows[0].fresh,true);
  const f=await lineupFixture(true,{exec:s=>a.query(s),query:(s,args)=>a.query(s,args)});
  await b.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[f.id(3),JSON.stringify({sub:f.id(3),email:'user3@example.invalid'})]);await b.query('set role authenticated');
  const editArgs=(e,s,cards,req)=>[e.eid,e.rid,JSON.stringify(s),JSON.stringify(cards),req];
  const query='select public.replace_friendly_round_lineup($1,$2,$3,$4,$5) result';
  async function blocked(){for(let i=0;i<100;i++){const r=await monitor.query("select wait_event_type='Lock' blocked from pg_stat_activity where application_name='pr269-b'");if(r.rows[0]?.blocked)return;await sleep(10);}throw Error('Second connection did not wait on a database lock');}
  for(const sameRequest of [false,true]){
   const e=await f.seed(9,[[0,1]]),s=await f.snap(e),cards=f.cards(s);const p=cards[0].players.find(p=>p.participant_id===e.participants[2]);p.participant_id=e.participants[8];const req=f.req(),args=editArgs(e,s,cards,req);
   await a.query('begin');const first=(await a.query(query,args)).rows[0].result;
   const pending=b.query(query,sameRequest?args:editArgs(e,s,cards,f.req())).then(r=>({result:r.rows[0].result}),e=>({code:e.code}));await blocked();await a.query('commit');const second=await pending;
   if(sameRequest){assert.deepEqual(second.result,first);assert.equal((await monitor.query('select count(*)::int n from friendly_match_operations where request_id=$1',[req])).rows[0].n,1);}
   else assert.equal(second.code,'40001');
   console.log('PASS: PostgreSQL concurrent '+(sameRequest?'same operation idempotency':'different operation CAS rejection'));
  }
  const e=await f.seed(9,[[0,1]]),s=await f.snap(e),cards=f.cards(s);cards[0].players.find(p=>p.participant_id===e.participants[2]).participant_id=e.participants[8];
  await a.query('begin');await a.query(query,editArgs(e,s,cards,f.req()));const pending=b.query("update event_participants set status='resting' where id=$1",[e.participants[8]]).then(r=>r.rowCount);await blocked();await a.query('commit');assert.equal(await pending,1);const after=await f.snap(e);assert(!after.eligible.includes(e.participants[8]));assert.deepEqual(after.audit.played_ids,cards.flatMap(c=>c.players.map(p=>p.participant_id)).sort());console.log('PASS: PostgreSQL participant status change serialized after lineup');
 }finally{await a.query('rollback').catch(()=>{});await Promise.all([a.end(),b.end(),monitor.end()]);}
})().catch(e=>{console.error('Local PostgreSQL candidate check failed:',e.code||e.message);process.exitCode=1;});
