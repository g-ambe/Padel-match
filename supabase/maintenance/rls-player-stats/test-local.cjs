const {PGlite}=require('../../../.rls-validation/node_modules/@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const results=[];
(async()=>{
 const db=new PGlite();
 const run=async f=>{await db.exec('RESET ROLE');await db.exec(fs.readFileSync(path.join(__dirname,f),'utf8'));};
 const test=async(name,fn)=>{await fn();results.push({name,status:'PASS'});console.log('PASS '+name);};
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE player_stats(id int PRIMARY KEY,profile_id uuid,match_count int);
 ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
 CREATE POLICY dev_all_player_stats ON player_stats FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
 GRANT SELECT,TRUNCATE ON player_stats TO anon;
 GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON player_stats TO authenticated,service_role;
 INSERT INTO player_stats VALUES(1,'00000000-0000-0000-0000-000000000001',42);
 CREATE FUNCTION stats_integrity_probe() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT count(*) FROM public.player_stats $$;
 GRANT EXECUTE ON FUNCTION stats_integrity_probe() TO authenticated;`);
 const before=(await db.query('SELECT * FROM player_stats')).rows;
 await test('stats apply refuses partial privilege drift',async()=>{await db.exec('REVOKE UPDATE ON player_stats FROM authenticated');await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.equal((await db.query("SELECT count(*)::int n FROM pg_policies WHERE tablename='player_stats'")).rows[0].n,1);await db.exec('GRANT UPDATE ON player_stats TO authenticated');});
 await test('stats closure applies actual SQL',()=>run('apply.sql'));
 for(const role of ['anon','authenticated'])for(const [label,sql]of Object.entries({SELECT:'SELECT * FROM player_stats',INSERT:'INSERT INTO player_stats VALUES(2,NULL,0)',UPDATE:'UPDATE player_stats SET match_count=0',DELETE:'DELETE FROM player_stats',TRUNCATE:'TRUNCATE player_stats'})){
  await test(`direct ${role} ${label} denied`,async()=>{await db.exec(`RESET ROLE; SET ROLE ${role}`);await assert.rejects(db.exec(sql),e=>e.code==='42501');});
 }
 await test('data remains unchanged',async()=>{await db.exec('RESET ROLE');assert.deepEqual((await db.query('SELECT * FROM player_stats')).rows,before);});
 await test('service_role maintenance access remains',async()=>{await db.exec('SET ROLE service_role');assert.deepEqual((await db.query('SELECT * FROM player_stats')).rows,before);});
 await test('SECURITY DEFINER integrity lookup still reads stats',async()=>{await db.exec('RESET ROLE; SET ROLE authenticated');assert.equal(Number((await db.query('SELECT stats_integrity_probe() n')).rows[0].n),1);});
 await test('repeat apply refuses',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');});
 await test('rollback restores original policy and grants',async()=>{await run('rollback.sql');assert.equal((await db.query("SELECT count(*)::int n FROM pg_policies WHERE tablename='player_stats' AND policyname='dev_all_player_stats'")).rows[0].n,1);for(const role of ['anon','authenticated']){await db.exec(`RESET ROLE; SET ROLE ${role}`);assert.deepEqual((await db.query('SELECT * FROM player_stats')).rows,before);}});
 await test('reapply succeeds',()=>run('apply.sql'));
 fs.writeFileSync(path.join(__dirname,'test-results.json'),JSON.stringify({engine:'PGlite 0.3.14',scope:'local synthetic data only',results},null,2)+'\n');await db.close();console.log(results.length+' PASS');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
