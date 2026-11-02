const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({db,context,test,policies,uid,assert}) => {
 const run = async file => { await db.exec('RESET ROLE'); await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8')); };
 const before = await policies();
 await db.exec('ALTER TABLE clubs ADD COLUMN is_deleted boolean NOT NULL DEFAULT false, ADD COLUMN deleted_at timestamptz');
 // Synthetic FK child verifies that a blocked parent DELETE cannot cascade.
 await db.exec(`CREATE TABLE delete_test_child(id int PRIMARY KEY,club_id uuid REFERENCES clubs(id) ON DELETE CASCADE);
 INSERT INTO delete_test_child VALUES (1,'${uid(101)}'),(2,'${uid(102)}');`);
 await test('DELETE step applies actual SQL',()=>run('apply.sql'));
 const after=await policies();
 assert.deepEqual(after.filter(p=>p.cmd!=='DELETE'),before.filter(p=>p.cmd!=='DELETE'));
 for (const [n,label] of [[1,'linked main'],[2,'legacy main'],[3,'sub'],[4,'member'],[5,'inactive'],[6,'outsider'],[7,'owner only'],[9,'super']]) {
  await test(`DELETE denied: ${label}`,async()=>{await context(n);assert.equal((await db.query('DELETE FROM clubs RETURNING id')).rows.length,0);assert.equal((await db.query('SELECT id FROM clubs')).rows.length,2);});
 }
 await test('DELETE denied: email super',async()=>{await context(6,'authenticated','testuser01@example.com');assert.equal((await db.query('DELETE FROM clubs RETURNING id')).rows.length,0);});
 await test('DELETE denied: anon',async()=>{await context(null,'anon');await assert.rejects(db.query('DELETE FROM clubs'),e=>e.code==='42501');});
 await test('cascade children remain intact',async()=>{await db.exec('RESET ROLE');assert.equal((await db.query('SELECT * FROM delete_test_child')).rows.length,2);});
 await test('main admin logical deletion and setting update still work',async()=>{await context(1);assert.equal((await db.query("UPDATE clubs SET is_active=false,description='delete-step' WHERE id=$1 RETURNING id",[uid(101)])).rows.length,1);assert.equal((await db.query('SELECT is_active FROM clubs WHERE id=$1',[uid(101)])).rows[0].is_active,false);});
 await test('INSERT and SELECT preserved',async()=>{await context(6);await db.query('INSERT INTO clubs(id,name,owner_id) VALUES($1,$2,$3)',[uid(103),'C',uid(6)]);assert.equal((await db.query('SELECT id FROM clubs WHERE id=$1',[uid(103)])).rows.length,1);await db.exec('RESET ROLE');await db.query('DELETE FROM clubs WHERE id=$1',[uid(103)]);});
 await test('super admin UI logical deletion preserved',async()=>{await context(9);assert.equal((await db.query('UPDATE clubs SET is_deleted=true,deleted_at=now() WHERE id=$1 RETURNING id',[uid(102)])).rows.length,1);assert.equal((await db.query('SELECT is_deleted FROM clubs WHERE id=$1',[uid(102)])).rows[0].is_deleted,true);});
 await test('DELETE apply reexecution refuses',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.deepEqual(await policies(),after);});
 await test('DELETE rollback refuses extra permissive policy',async()=>{await db.exec('CREATE POLICY unexpected_delete ON clubs FOR DELETE TO authenticated USING(true)');await assert.rejects(run('rollback.sql'));await db.exec('ROLLBACK');await db.exec('DROP POLICY unexpected_delete ON clubs');assert.deepEqual(await policies(),after);});
 await test('DELETE rollback restores only DELETE step',async()=>{await run('rollback.sql');assert.deepEqual(await policies(),before);});
 await test('DELETE restored by rollback cascades synthetic child',async()=>{await context(6);assert.equal((await db.query('DELETE FROM clubs WHERE id=$1 RETURNING id',[uid(102)])).rows.length,1);await db.exec('RESET ROLE');assert.equal((await db.query('SELECT * FROM delete_test_child WHERE id=2')).rows.length,0);});
 await test('DELETE apply refuses extra ALL policy',async()=>{await db.exec('CREATE POLICY unexpected_all ON clubs FOR ALL TO authenticated USING(true) WITH CHECK(true)');await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');await db.exec('DROP POLICY unexpected_all ON clubs');assert.deepEqual(await policies(),before);});
 await test('DELETE reapply and verify',async()=>{await run('apply.sql');assert.deepEqual(await policies(),after);await run('verify.sql');});
};
