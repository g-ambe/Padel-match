// Candidate 03 only. Requires a NEW, empty disposable local PostgreSQL database.
// Simulated Auth claims; no hosted Auth/PostgREST, production data or release.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Client}=require('pg');
const {memberPublicDatabase}=require('./fixtures/member-public-choice-db.cjs');
const url=process.env.MEMBER_PUBLIC_TEST_DB_URL;
if(!url)throw Error('Set MEMBER_PUBLIC_TEST_DB_URL to an empty disposable local database');
const target=new URL(url);
if(target.hostname!=='127.0.0.1'||target.pathname!=='/member_public_review')throw Error('Disposable local DB required');
const directory=path.join(__dirname,'../supabase/maintenance/group-member-public-choice');
const original=fs.readFileSync(path.join(directory,'01_chatgpt_candidate.sql'),'utf8');
const corrected=fs.readFileSync(path.join(directory,'03_lock_order_candidate.sql'),'utf8');
const advisory='SELECT profile_link_private.serialize_operations();';
function withoutComments(sql){return sql.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n').replaceAll(advisory,'').trim();}
assert.equal(withoutComments(corrected).replace(/\n\s*\n/g,'\n'),withoutComments(original).replace(/\n\s*\n/g,'\n'));
assert.equal(corrected.split(advisory).length-1,1);
assert(corrected.indexOf(advisory)<corrected.indexOf('ALTER TABLE'));
console.log('01 -> 03: executable SQL identical except moving the single advisory-lock acquisition before DDL PASS');
const quote=name=>'"'+name.replaceAll('"','""')+'"';
(async()=>{
 const observer=new Client({connectionString:url}),a=new Client({connectionString:url}),b=new Client({connectionString:url});
 await Promise.all([observer.connect(),a.connect(),b.connect()]);
 try{
  assert.equal((await observer.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n,0,'Database must be empty');
  const fixture=await memberPublicDatabase(false,{exec:sql=>observer.query(sql),query:(sql,args)=>observer.query(sql,args),close:async()=>{}}),id=fixture.id;
  async function fingerprint(){
   const schemas="('public','auth','profile_link_private','group_read_private','supabase_migrations','security_private')";
   const queries={
    relations:`select c.oid::text,n.nspname,c.relname,c.relkind,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} order by c.oid`,
    columns:`select a.attrelid::text,a.attname,a.attnum,a.atttypid::text,a.attnotnull,a.atthasdef,a.attgenerated from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and a.attnum>0 and not a.attisdropped order by a.attrelid,a.attnum`,
    functions:`select p.oid::text,p.proowner::text,p.proacl::text,p.prosecdef,p.proconfig,md5(p.prosrc) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ${schemas} order by p.oid`,
    constraints:`select c.oid::text,c.conname,pg_get_constraintdef(c.oid) definition from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ${schemas} order by c.oid`,
    triggers:`select t.oid::text,t.tgenabled,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} order by t.oid`,
    policies:'select * from pg_policies order by schemaname,tablename,policyname',
   };
   const result={};for(const [name,query]of Object.entries(queries))result[name]=(await observer.query(query)).rows;
   result.rows={};for(const {tablename}of(await observer.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows){result.rows[tablename]=(await observer.query(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) digest from public.${quote(tablename)} t`)).rows[0].digest;}
   return result;
  }
  async function waitForLock(){
   for(let n=0;n<160;n++){
    const row=(await observer.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[b.processID])).rows[0];
    if(row?.wait_event_type==='Lock')return row;
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   throw Error('Candidate did not enter the expected lock wait');
  }
  const runCandidate=()=>b.query(corrected).then(()=>({ok:true}),error=>({ok:false,code:error.code,message:error.message}));
  async function assertNoCandidateObjects(){
   const state=(await observer.query("select count(*)::int n from information_schema.columns where table_schema='public' and column_name='club_name_public_choice' and table_name in ('club_members','join_requests','player_profile_link_requests')")).rows[0];
   assert.equal(state.n,0);
   assert.equal((await observer.query("select to_regprocedure('public.save_club_member_field_v2(uuid,uuid,text,text,boolean,text,text,boolean,text)')::text endpoint,to_regprocedure('group_read_private.guard_member_public_choice()')::text guard")).rows[0].endpoint,null);
  }
  // 1. Advisory contention must time out BEFORE any candidate DDL has run.
  let before=await fingerprint();
  await a.query('begin;select profile_link_private.serialize_operations()');
  let pending=runCandidate();let wait=await waitForLock();assert.equal(wait.wait_event,'advisory');
  assert.equal((await observer.query("select count(*)::int n from pg_locks where pid=$1 and mode='AccessExclusiveLock' and granted",[b.processID])).rows[0].n,0);
  await a.query('select id from club_members limit 1');
  let result=await pending;assert.equal(result.ok,false);assert.equal(result.code,'55P03');assert.match(result.message,/lock timeout/);
  await b.query('rollback');await a.query('rollback');await assertNoCandidateObjects();assert.deepEqual(await fingerprint(),before);
  console.log('03 advisory lock_timeout (original 5s): 55P03 before DDL; complete catalog/data fingerprint unchanged after ROLLBACK PASS');
  // 2. Non-cooperating readers can still block a later DDL. Prior DDL must roll back too.
  before=await fingerprint();await a.query('begin;lock table public.join_requests in access share mode');
  pending=runCandidate();wait=await waitForLock();assert.equal(wait.wait_event,'relation');
  const locks=(await observer.query("select relation::regclass::text relation,mode,granted from pg_locks where pid=$1 and mode='AccessExclusiveLock'",[b.processID])).rows;
  assert(locks.some(lock=>lock.relation==='club_members'&&lock.granted),'Prior club_members DDL must actually have run');
  assert(locks.some(lock=>lock.relation==='join_requests'&&!lock.granted));
  result=await pending;assert.equal(result.code,'55P03');assert.match(result.message,/lock timeout/);
  await b.query('rollback');await a.query('rollback');await assertNoCandidateObjects();assert.deepEqual(await fingerprint(),before);
  console.log('03 later-table lock_timeout (original 5s): prior DDL actually executed, then 55P03; catalog/data/ACL/RLS fingerprints restored by ROLLBACK PASS');
  // 3. The original reversed-lock cycle: 03 waits without taking DDL locks, so the old operation finishes.
  await a.query('begin;select profile_link_private.serialize_operations()');
  pending=runCandidate();wait=await waitForLock();assert.equal(wait.wait_event,'advisory');
  assert.equal((await observer.query("select count(*)::int n from pg_locks where pid=$1 and mode='AccessExclusiveLock' and granted",[b.processID])).rows[0].n,0);
  const member=(await a.query('select * from club_members where club_id=$1 and player_profile_id=$2',[id(600),id(103)])).rows[0];
  await a.query("set local statement_timeout='3s'");
  await a.query("select set_config('request.jwt.claim.sub',$1,true)",[id(3)]);
  await a.query('select save_club_member_display_name($1,$2,$3,$4,$5)',[id(600),member.id,'先行操作が保存した名前',member.club_display_name,false]);
  assert.equal((await observer.query('select wait_event from pg_stat_activity where pid=$1',[b.processID])).rows[0].wait_event,'advisory');
  await a.query('commit');result=await pending;assert.deepEqual(result,{ok:true});
  assert.equal((await observer.query('select club_display_name from club_members where id=$1',[member.id])).rows[0].club_display_name,'先行操作が保存した名前');
  assert.equal((await observer.query("select count(*)::int n from information_schema.columns where table_schema='public' and column_name='club_name_public_choice' and table_name in ('club_members','join_requests','player_profile_link_requests')")).rows[0].n,3);
  console.log('03 actual unmodified apply: DDL-before-lock cycle eliminated; legacy read/write finishes, COMMIT releases lock, candidate COMMIT preserves the result without 40P01 PASS');
  // Focused positive/negative requests on the database which ACTUALLY applied 03.
  await observer.query("update clubs set visibility='public' where id=$1",[id(600)]);
  const row=(await observer.query('select * from club_members where id=$1',[member.id])).rows[0];
  await b.query('set role authenticated');await b.query("select set_config('request.jwt.claim.sub',$1,false)",[id(3)]);
  const args=[id(600),row.id,'public',null,false,row.club_display_name,row.club_name_public_choice,false,'public'];
  const off=(await b.query('select save_club_member_field_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) value',args)).rows[0].value;
  assert.equal(off.public_name_choice,'off');assert.equal(off.public_name_enabled,false);
  await assert.rejects(()=>b.query('select save_club_member_field_v2($1,$2,$3,$4,$5,$6,$7,$8,$9)',args),e=>e.code==='PT409');
  await b.query("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
  await assert.rejects(()=>b.query('select save_club_member_field_v2($1,$2,$3,$4,$5,$6,$7,$8,$9)',args),e=>e.code==='42501');
  await b.query('set role anon');await assert.rejects(()=>b.query('select save_club_member_field_v2($1,$2,$3,$4,$5,$6,$7,$8,$9)',args),e=>e.code==='42501');
  await b.query('reset role');assert.equal((await observer.query('select club_name_public_choice from club_members where id=$1',[row.id])).rows[0].club_name_public_choice,'off');
  await assert.rejects(()=>b.query(corrected),/Baseline changed|already exists/);await b.query('rollback');
  assert.equal((await observer.query('select club_name_public_choice from club_members where id=$1',[row.id])).rows[0].club_name_public_choice,'off');
  console.log('03 actual PostgreSQL RPC: self OFF success, stale CAS PT409, other member/anon rejection, second-apply refusal and committed OFF preservation PASS');
 }finally{
  await Promise.allSettled([a.query('rollback'),b.query('rollback')]);
  await Promise.all([a.end(),b.end(),observer.end()]);
 }
})().catch(error=>{console.error(error.message);process.exitCode=1});
