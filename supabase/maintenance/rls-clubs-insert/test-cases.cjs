const fs=require('node:fs'),path=require('node:path');
module.exports=async({db,context,test,policies,uid,assert,evidence})=>{
 const run=async file=>{await db.exec('RESET ROLE');await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));};
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'dependency-fixture.json'),'utf8'));
 await db.exec(`RESET ROLE; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
 ALTER TABLE club_members ADD COLUMN status text NOT NULL DEFAULT 'active';
 GRANT INSERT ON club_members TO authenticated;`);
 for(const f of fixture.functions)await db.exec(f);
 for(const t of fixture.triggers){await db.exec(t.function);await db.exec(t.definition);}
 const member=evidence.full_policies.find(p=>p.tablename==='club_members'&&p.cmd==='INSERT');
 await db.exec(`CREATE POLICY club_members_insert ON club_members FOR INSERT TO authenticated WITH CHECK (${member.with_check})`);
 const before=await policies();
 const insert=async(id,owner)=>db.query('INSERT INTO clubs(id,name,owner_id) VALUES($1,$2,$3) RETURNING id',[uid(id),'new',owner]);
 await test('INSERT baseline already rejects other owner via trigger',async()=>{await context(6);await assert.rejects(insert(401,uid(1)));});
 await test('INSERT actual SQL applies',()=>run('apply.sql'));
 const after=await policies();assert.deepEqual(after.filter(p=>p.cmd!=='INSERT'),before.filter(p=>p.cmd!=='INSERT'));
 for(const [n,label] of [[6,'unaffiliated'],[4,'ordinary member'],[3,'sub admin'],[1,'main admin'],[9,'super admin']]){
  await test(`INSERT self succeeds: ${label}`,async()=>{await context(n);const id=410+n;assert.equal((await insert(id,uid(n))).rows[0].id,uid(id));assert.equal((await db.query('SELECT owner_id FROM clubs WHERE id=$1',[uid(id)])).rows[0].owner_id,uid(n));});
 }
 await test('INSERT to membership bootstrap to UPDATE succeeds',async()=>{
  await db.exec('RESET ROLE');await db.query('INSERT INTO player_profiles VALUES($1,$2,true)',[uid(220),uid(6)]);
  await context(6);await insert(430,uid(6));
  assert.equal((await db.query("INSERT INTO club_members(id,club_id,profile_id,player_profile_id,role,is_active) VALUES($1,$2,$3,$4,'main_admin',true) RETURNING id",[uid(431),uid(430),uid(6),uid(220)])).rows.length,1);
  assert.equal((await db.query("UPDATE clubs SET description='bootstrap-ok' WHERE id=$1 RETURNING id",[uid(430)])).rows.length,1);
 });
 for(const [label,n,owner,role] of [['other owner',6,uid(1),'authenticated'],['null owner',6,null,'authenticated'],['missing uid',null,null,'authenticated'],['anon',null,uid(1),'anon'],['super other owner',9,uid(1),'authenticated']]){
  await test(`INSERT denied: ${label}`,async()=>{await context(n,role);await assert.rejects(insert(440,owner));assert.equal((await db.query('SELECT id FROM clubs WHERE id=$1',[uid(440)])).rows.length,0);});
 }
 await test('INSERT policy independently rejects other owner',async()=>{
  await db.exec('RESET ROLE; ALTER TABLE clubs DISABLE TRIGGER profile_link_club_owner');
  try{await context(6);await assert.rejects(insert(450,uid(1)),e=>e.code==='42501');}
  finally{await db.exec('RESET ROLE; ALTER TABLE clubs ENABLE TRIGGER profile_link_club_owner');}
 });
 await test('previous DELETE denial retained',async()=>{await context(6);assert.equal((await db.query('DELETE FROM clubs WHERE id=$1 RETURNING id',[uid(430)])).rows.length,0);});
 await test('INSERT reapply rejected',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.deepEqual(await policies(),after);});
 await test('INSERT rollback rejects extra INSERT policy',async()=>{await db.exec('CREATE POLICY extra_insert ON clubs FOR INSERT TO authenticated WITH CHECK(true)');await assert.rejects(run('rollback.sql'));await db.exec('ROLLBACK');await db.exec('DROP POLICY extra_insert ON clubs');assert.deepEqual(await policies(),after);});
 await test('INSERT rollback exact previous policies',async()=>{await run('rollback.sql');assert.deepEqual(await policies(),before);});
 await test('INSERT rollback leaves owner trigger effective',async()=>{await context(6);await assert.rejects(insert(451,uid(1)));});
 await test('INSERT apply rejects extra ALL policy',async()=>{await db.exec('RESET ROLE; CREATE POLICY extra_all ON clubs FOR ALL TO authenticated USING(true) WITH CHECK(true)');await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');await db.exec('DROP POLICY extra_all ON clubs');assert.deepEqual(await policies(),before);});
 await test('INSERT reapply and verify succeed',async()=>{await run('apply.sql');assert.deepEqual(await policies(),after);await run('verify.sql');});
};
