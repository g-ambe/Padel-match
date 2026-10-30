// These are demonstrations of residual risks in an isolated synthetic DB, not acceptance assertions.
module.exports=async({db,context,test,uid,assert})=>{
 await test('review: INSERT denial can still be bypassed by later broad UPDATE',async()=>{
  await context(6);
  await assert.rejects(db.query("INSERT INTO events(id,name,club_id,created_by_auth_user_id) VALUES($1,'blocked',$2,$3)",[uid(1800),uid(601),uid(6)]),e=>e.code==='42501');
  await db.query("INSERT INTO events(id,name,club_id,created_by_auth_user_id) VALUES($1,'own-null-club',NULL,$2)",[uid(1801),uid(6)]);
  const moved=await db.query('UPDATE events SET club_id=$1,created_by_auth_user_id=$2 WHERE id=$3 RETURNING club_id,created_by_auth_user_id',[uid(601),uid(1),uid(1801)]);
  assert.equal(moved.rows[0].club_id,uid(601));assert.equal(moved.rows[0].created_by_auth_user_id,uid(1));
 });
 await db.exec(`RESET ROLE; CREATE TABLE permission_review_probe(id integer);
 ALTER TABLE permission_review_probe ENABLE ROW LEVEL SECURITY;
 CREATE POLICY deny_delete ON permission_review_probe FOR DELETE TO authenticated USING(false);
 GRANT SELECT,TRUNCATE ON permission_review_probe TO anon,authenticated;
 GRANT DELETE ON permission_review_probe TO authenticated;`);
 for(const role of ['anon','authenticated']){
  await test(`review: ${role} TRUNCATE bypasses row policies on synthetic table`,async()=>{
   await db.exec('RESET ROLE; INSERT INTO permission_review_probe VALUES(1),(2)');
   await context(role==='anon'?null:6,role);
   assert.equal((await db.query('SELECT * FROM permission_review_probe')).rows.length,0);
   if(role==='authenticated')assert.equal((await db.query('DELETE FROM permission_review_probe RETURNING id')).rows.length,0);
   await db.exec('TRUNCATE permission_review_probe');
   await db.exec('RESET ROLE');assert.equal((await db.query('SELECT count(*)::int n FROM permission_review_probe')).rows[0].n,0);
  });
 }
 await test('review: local TRUNCATE revocation prevents the operation',async()=>{
  await db.exec('RESET ROLE; REVOKE TRUNCATE ON permission_review_probe FROM anon,authenticated');
  for(const role of ['anon','authenticated']){await context(role==='anon'?null:6,role);await assert.rejects(db.exec('TRUNCATE permission_review_probe'),e=>e.code==='42501');}
 });
};
