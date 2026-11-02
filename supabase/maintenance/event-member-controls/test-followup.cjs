const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async function ({db, context, id}) {
 const results=[];
 const test=async(name,fn)=>{await fn();results.push({name,status:'PASS'});console.log('FOLLOWUP PASS '+name);};
 const sql=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
 const guard=async()=>{await db.exec('RESET ROLE');return (await db.query("SELECT pg_get_functiondef('events_operation_private.guard_member_fields()'::regprocedure) f")).rows[0].f;};
 const snapshot=async()=>{await db.exec('RESET ROLE');return {
  policies:(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows,
  privileges:(await db.query("SELECT c.relname,c.relacl::text FROM pg_class c WHERE c.relnamespace='public'::regnamespace ORDER BY c.relname")).rows,
  functionAcl:(await db.query("SELECT p.proacl::text,p.prosecdef,p.proconfig,p.proowner FROM pg_proc p WHERE p.oid='events_operation_private.guard_member_fields()'::regprocedure")).rows,
  triggers:(await db.query("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.events'::regclass AND NOT tgisinternal ORDER BY tgname")).rows,
  columns:(await db.query("SELECT attname,attacl::text FROM pg_attribute WHERE attrelid='public.events'::regclass AND attnum>0 ORDER BY attnum")).rows
 };};
 const update=(n,fields)=>{const names=Object.keys(fields);return db.query('UPDATE events SET '+names.map((k,i)=>k+'=$'+(i+1)).join(',')+' WHERE id=$'+(names.length+1)+' AND is_deleted=false RETURNING id,name,court_count,status,stats_mode',[...Object.values(fields),id(n)]);};
 const before=await guard(),meta=await snapshot();
 await test('production guard reproduced before fix',async()=>{await context(3);await assert.rejects(update(101,{name:'変更前拒否'}),e=>e.code==='42501');});
 await test('apply changes guard only, not rows or policies or ACL',async()=>{await db.exec('RESET ROLE');const rows=(await db.query('SELECT * FROM events ORDER BY id')).rows;await db.exec(sql('apply.sql'));assert.deepEqual((await db.query('SELECT * FROM events ORDER BY id')).rows,rows);assert.deepEqual(await snapshot(),meta);});
 const after=await guard();
 for(const u of [3,4])for(const mode of ['auto','manual']){
  await test('active member '+u+' '+mode+' rename/courts/close/reopen with exact page payload and reload',async()=>{
   await db.exec('RESET ROLE');await db.query("UPDATE events SET event_mode=$1,status='active',is_deleted=false WHERE id=$2",[mode,id(101)]);
   await context(u);assert.equal((await update(101,{name:'一般'+u,updated_at:new Date('2026-11-02Z')})).rows.length,1);
   if(mode==='auto')assert.equal((await update(101,{court_count:3})).rows[0].court_count,3);
   assert.equal((await update(101,{status:'closed',closed_at:new Date('2026-11-02Z'),stats_mode:'official'})).rows[0].status,'closed');
   assert.equal((await db.query('SELECT status,name FROM events WHERE id=$1',[id(101)])).rows[0].name,'一般'+u);
   assert.equal((await update(101,{status:'active',stats_mode:mode==='manual'?'undecided':'official'})).rows[0].status,'active');
  });
 }
 for(const u of [5,6])await test('inactive/foreign '+u+' cannot rename or close',async()=>{await context(u);for(const fields of [{name:'不正'},{status:'closed'}])assert.equal((await update(101,fields)).rows.length,0);});
 await test('anonymous cannot write',async()=>{await context(null,'anon');await assert.rejects(update(101,{name:'匿名'}),e=>e.code==='42501');});
 for(const field of ['share_enabled','is_deleted','club_id','created_by_auth_user_id','description'])await test('member still cannot alter '+field,async()=>{
  await context(3);const values={share_enabled:true,is_deleted:true,club_id:id(302),created_by_auth_user_id:id(6),description:'内部'};
  await assert.rejects(update(101,{name:'混入',[field]:values[field]}),e=>e.code==='42501');
 });
 await test('team host ordinary member remains unable to rename team event',async()=>{await context(4);assert.equal((await update(111,{name:'不正チーム'})).rows.length,0);});
 await test('no-group creator and administrators retain rename',async()=>{for(const [u,n] of [[7,103],[1,101],[2,101],[9,102]]){await context(u);assert.equal((await update(n,{name:'正当変更'})).rows.length,1);}});
 await test('deleted event remains unavailable to member update',async()=>{await context(3);assert.equal((await update(104,{name:'削除済み'})).rows.length,0);});
 await test('repeat apply detects drift',async()=>{await db.exec('RESET ROLE');await assert.rejects(db.exec(sql('apply.sql')));await db.exec('ROLLBACK');assert.equal(await guard(),after);});
 await test('rollback restores guard without changing rows/metadata',async()=>{await db.exec('RESET ROLE');const rows=(await db.query('SELECT * FROM events ORDER BY id')).rows;await db.exec(sql('rollback.sql'));assert.equal(await guard(),before);assert.deepEqual(await snapshot(),meta);assert.deepEqual((await db.query('SELECT * FROM events ORDER BY id')).rows,rows);});
 await test('rollback rejects member rename but preserves existing close/reopen',async()=>{await context(3);await assert.rejects(update(101,{name:'再拒否'}),e=>e.code==='42501');assert.equal((await update(101,{status:'closed'})).rows.length,1);assert.equal((await update(101,{status:'active'})).rows.length,1);});
 await test('reapply succeeds',async()=>{await db.exec('RESET ROLE');await db.exec(sql('apply.sql'));assert.equal(await guard(),after);});
 fs.writeFileSync(path.join(__dirname,'test-results.json'),JSON.stringify({engine:'PGlite 0.3.14',scope:'current SELECT policies plus actual page update payloads; synthetic data only',results},null,2)+'\n');
 console.log(results.length+' FOLLOWUP PASS');
};
