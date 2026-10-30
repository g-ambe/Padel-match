const fs=require('node:fs'),path=require('node:path');
module.exports=async({db,context,test,uid,assert})=>{
 const run=async file=>{await db.exec('RESET ROLE');await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));};
 const policies=async()=>{await db.exec('RESET ROLE');return (await db.query("SELECT * FROM pg_policies WHERE tablename='events' ORDER BY policyname")).rows;};
 const before=await policies();
 await test('identity guard applies without policy changes',async()=>{await run('apply.sql');assert.deepEqual(await policies(),before);});
 await db.exec(`RESET ROLE; INSERT INTO events(id,name,club_id,created_by_auth_user_id) VALUES('${uid(2000)}','synthetic',NULL,'${uid(6)}'),('${uid(2001)}','legacy-null',NULL,NULL);`);
 for(const [column,value]of [['club_id',uid(601)],['created_by_auth_user_id',uid(1)],['id',uid(2099)]]){
  await test(`identity blocks changed ${column}`,async()=>{await context(6);await assert.rejects(db.query(`UPDATE events SET ${column}=$1 WHERE id=$2 RETURNING id`,[value,uid(2000)]),e=>e.code==='42501');assert.equal((await db.query('SELECT id FROM events WHERE id=$1',[uid(2000)])).rows.length,1);});
 }
 await test('identity blocks NULL transitions and super-user app changes',async()=>{await context(9);await assert.rejects(db.query('UPDATE events SET created_by_auth_user_id=NULL WHERE id=$1',[uid(2000)]),e=>e.code==='42501');await assert.rejects(db.query('UPDATE events SET created_by_auth_user_id=$1 WHERE id=$2',[uid(9),uid(2001)]),e=>e.code==='42501');});
 await test('identity preserves close/reopen/name/court/share/soft-delete updates',async()=>{await context(6);for(const patch of ["status='closed'","status='active'","name='renamed'","court_count=3","share_enabled=true,share_token='synthetic-share'","is_deleted=true","is_deleted=false"]){assert.equal((await db.query(`UPDATE events SET ${patch} WHERE id=$1 RETURNING id`,[uid(2000)])).rows.length,1);}});
 await test('identity preserves unchanged keys and legacy NULL rows',async()=>{await context(6);assert.equal((await db.query('UPDATE events SET club_id=club_id,created_by_auth_user_id=created_by_auth_user_id WHERE id=$1 RETURNING id',[uid(2000)])).rows.length,1);assert.equal((await db.query("UPDATE events SET name='legacy-renamed' WHERE id=$1 RETURNING id",[uid(2001)])).rows.length,1);});
 await test('identity and INSERT together close create-then-move route',async()=>{await context(6);await assert.rejects(db.query("INSERT INTO events(id,name,club_id,created_by_auth_user_id) VALUES($1,'blocked',$2,$3)",[uid(2010),uid(601),uid(6)]),e=>e.code==='42501');await db.query("INSERT INTO events(id,name,created_by_auth_user_id) VALUES($1,'self',$2)",[uid(2011),uid(6)]);await assert.rejects(db.query('UPDATE events SET club_id=$1,created_by_auth_user_id=$2 WHERE id=$3',[uid(601),uid(1),uid(2011)]),e=>e.code==='42501');});
 await test('identity maintenance owner can still migrate a synthetic row',async()=>{await db.exec('RESET ROLE');assert.equal((await db.query('UPDATE events SET club_id=$1 WHERE id=$2 RETURNING id',[uid(601),uid(2000)])).rows.length,1);});
 await test('identity repeated apply refuses without damaging existing trigger',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');await context(6);await assert.rejects(db.query('UPDATE events SET club_id=NULL WHERE id=$1',[uid(2000)]),e=>e.code==='42501');});
 await test('identity rollback leaves policy protections unchanged',async()=>{await run('rollback.sql');assert.deepEqual(await policies(),before);await context(6);assert.equal((await db.query('UPDATE events SET club_id=NULL WHERE id=$1 RETURNING id',[uid(2000)])).rows.length,1);});
 await test('identity reapply restores protection',async()=>{await run('apply.sql');await context(6);await assert.rejects(db.query('UPDATE events SET club_id=$1 WHERE id=$2',[uid(601),uid(2000)]),e=>e.code==='42501');});
 await test('identity-first then INSERT restriction matches planned rollout',async()=>{
  await run('../rls-events-insert/rollback.sql');await context(6);
  await db.query("INSERT INTO events(id,name,club_id,created_by_auth_user_id) VALUES($1,'still-broad-until-step2',$2,$3)",[uid(2020),uid(601),uid(1)]);
  await assert.rejects(db.query('UPDATE events SET club_id=$1 WHERE id=$2',[uid(602),uid(2020)]),e=>e.code==='42501');
  await run('../rls-events-insert/apply.sql');await context(6);
  await assert.rejects(db.query("INSERT INTO events(id,name,club_id,created_by_auth_user_id) VALUES($1,'now-blocked',$2,$3)",[uid(2021),uid(601),uid(6)]),e=>e.code==='42501');
  await assert.rejects(db.query('UPDATE events SET club_id=$1 WHERE id=$2',[uid(602),uid(2020)]),e=>e.code==='42501');
 });
};
