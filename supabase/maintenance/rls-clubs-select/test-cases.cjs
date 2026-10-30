const fs=require('node:fs'),path=require('node:path');
module.exports=async({db,context,test,policies,uid,assert})=>{
 const run=async file=>{await db.exec('RESET ROLE');await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));};
 await db.exec(`RESET ROLE; CREATE TABLE official_events(id uuid PRIMARY KEY,club_id uuid,status text,share_enabled boolean,share_token text,is_deleted boolean);
 ALTER TABLE official_events ENABLE ROW LEVEL SECURITY;
 GRANT SELECT ON official_events TO anon,authenticated;
 CREATE POLICY shared_official ON official_events FOR SELECT TO anon USING(status='closed' AND share_enabled AND NOT is_deleted);
 INSERT INTO clubs(id,name,owner_id,visibility) VALUES
 ('${uid(601)}','private-A','${uid(1)}','private'),('${uid(602)}','private-B','${uid(2)}','private'),
 ('${uid(603)}','public-C','${uid(2)}','public'),('${uid(604)}','public-hidden','${uid(2)}','public');
 UPDATE clubs SET is_active=false WHERE id='${uid(604)}';
 INSERT INTO club_members(id,club_id,profile_id,role,is_active) VALUES
 ('${uid(610)}','${uid(601)}','${uid(4)}','member',true),('${uid(611)}','${uid(601)}','${uid(3)}','sub_admin',true),
 ('${uid(612)}','${uid(601)}','${uid(5)}','main_admin',false);
 INSERT INTO player_profiles VALUES('${uid(620)}','${uid(7)}',true);
 INSERT INTO club_members(id,club_id,player_profile_id,role,is_active) VALUES('${uid(613)}','${uid(601)}','${uid(620)}','member',true);
 INSERT INTO official_events VALUES
 ('${uid(630)}','${uid(601)}','closed',true,'valid-private',false),
 ('${uid(631)}','${uid(601)}','closed',false,'disabled',false),
 ('${uid(632)}','${uid(601)}','active',true,'active-event',false),
 ('${uid(633)}','${uid(601)}','closed',true,'deleted-event',true),
 ('${uid(634)}',null,'closed',true,'no-club',false);`);
 const before=await policies();
 await test('SELECT stops when shared-name prerequisite is missing',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.deepEqual(await policies(),before);});
 await test('shared-name actual prerequisite SQL applies',()=>run('shared-name/apply.sql'));
 await test('SELECT applies actual SQL',()=>run('apply.sql'));
 const after=await policies();assert.deepEqual(after.filter(p=>p.cmd!=='SELECT'),before.filter(p=>p.cmd!=='SELECT'));
 const visible=async id=>(await db.query('SELECT id FROM clubs WHERE id=$1',[uid(id)])).rows.length;
 for(const [n,label,expected] of [[1,'owner',1],[3,'sub member',1],[4,'ordinary member',1],[7,'linked member',1],[5,'inactive membership',0],[6,'outsider',0],[2,'other-group owner',0],[9,'super',1]]){
  await test(`private SELECT ${label}`,async()=>{await context(n);assert.equal(await visible(601),expected);});
 }
 await test('anonymous cannot read private club or list clubs',async()=>{await context(null,'anon');assert.equal(await visible(601),0);assert.equal((await db.query('SELECT * FROM clubs')).rows.length,0);});
 await test('public discovery remains visible only for active public clubs',async()=>{await context(6);assert.equal(await visible(603),1);assert.equal(await visible(604),0);});
 await test('new private INSERT RETURNING works before membership',async()=>{await context(6);assert.equal((await db.query("INSERT INTO clubs(id,name,owner_id,visibility) VALUES($1,'new-private',$2,'private') RETURNING id",[uid(640),uid(6)])).rows.length,1);});
 await test('bootstrap membership and logical deletion still work',async()=>{
  await db.exec('RESET ROLE');await db.query('INSERT INTO player_profiles VALUES($1,$2,true)',[uid(641),uid(6)]);
  await context(6);await db.query("INSERT INTO club_members(id,club_id,profile_id,player_profile_id,role,is_active) VALUES($1,$2,$3,$4,'main_admin',true)",[uid(642),uid(640),uid(6),uid(641)]);
  assert.equal((await db.query('UPDATE clubs SET is_active=false WHERE id=$1 RETURNING id',[uid(640)])).rows.length,1);
 });
 for(const [n,role] of [[null,'anon'],[6,'authenticated']]){
  await test(`shared private name only: ${role}`,async()=>{await context(n,role);assert.equal(await visible(601),0);assert.equal((await db.query("SELECT public.get_shared_official_club_name('valid-private') name")).rows[0].name,'private-A');});
 }
 for(const token of ['invalid','disabled','active-event','deleted-event','no-club','',null]){
  await test(`shared-name invalid capability ${String(token)}`,async()=>{await context(null,'anon');assert.equal((await db.query('SELECT public.get_shared_official_club_name($1) name',[token])).rows[0].name,null);});
 }
 await test('token rotation immediately invalidates old token',async()=>{await db.exec("RESET ROLE; UPDATE official_events SET share_token='rotated' WHERE share_token='valid-private'");await context(null,'anon');assert.equal((await db.query("SELECT public.get_shared_official_club_name('valid-private') name")).rows[0].name,null);assert.equal((await db.query("SELECT public.get_shared_official_club_name('rotated') name")).rows[0].name,'private-A');});
 await test('public wrapper is invoker and private schema cannot be modified',async()=>{
  await db.exec('RESET ROLE');assert.equal((await db.query("SELECT prosecdef FROM pg_proc WHERE oid='public.get_shared_official_club_name(text)'::regprocedure")).rows[0].prosecdef,false);
  await db.exec('SET ROLE anon');await assert.rejects(db.exec('CREATE TABLE shared_read_private.bad(id int)'),e=>e.code==='42501');
 });
 await test('SELECT refuses repeated application',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.deepEqual(await policies(),after);});
 await test('SELECT rollback refuses extra permissive SELECT',async()=>{await db.exec('RESET ROLE; CREATE POLICY extra_select ON clubs FOR SELECT TO authenticated USING(true)');await assert.rejects(run('rollback.sql'));await db.exec('ROLLBACK');await db.exec('DROP POLICY extra_select ON clubs');assert.deepEqual(await policies(),after);});
 await test('SELECT rollback restores exact pre-step policies',async()=>{await run('rollback.sql');assert.deepEqual(await policies(),before);});
 await test('SELECT apply refuses an extra ALL policy',async()=>{await db.exec('CREATE POLICY extra_select_all ON clubs FOR ALL TO authenticated USING(true) WITH CHECK(true)');await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');await db.exec('DROP POLICY extra_select_all ON clubs');assert.deepEqual(await policies(),before);});
 await test('shared-name rollback removes only new objects',async()=>{await run('shared-name/rollback.sql');assert.equal((await db.query("SELECT to_regprocedure('public.get_shared_official_club_name(text)') p")).rows[0].p,null);assert.deepEqual(await policies(),before);});
 await test('shared-name and SELECT reapply',async()=>{await run('shared-name/apply.sql');await run('apply.sql');assert.deepEqual(await policies(),after);});
};
