// Run from repository root after installing @electric-sql/pglite@0.3.14 in .rls-validation.
const { PGlite } = require('../../../.rls-validation/node_modules/@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'docs/rls-phase0-evidence.json'), 'utf8'));
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const q = s => "'" + s.replaceAll("'", "''") + "'";
const results = [];
(async () => {
 const db = new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE SCHEMA auth; CREATE SCHEMA profile_link_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated;
 CREATE TABLE public.clubs (id uuid PRIMARY KEY, name text NOT NULL, owner_id uuid, is_active boolean NOT NULL DEFAULT true, description text, visibility text DEFAULT 'private', main_facility_id uuid, image_url text);
 CREATE TABLE public.club_members(id uuid PRIMARY KEY,club_id uuid,profile_id uuid,player_profile_id uuid,role text,is_active boolean);
 CREATE TABLE public.player_profiles(id uuid PRIMARY KEY,linked_auth_user_id uuid,is_active boolean);
 CREATE TABLE public.app_admins(profile_id uuid,is_active boolean);
 ALTER TABLE clubs ENABLE ROW LEVEL SECURITY; ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;
 ALTER TABLE player_profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;
 GRANT SELECT ON clubs,club_members,player_profiles,app_admins TO anon,authenticated;
 GRANT INSERT,UPDATE,DELETE ON clubs TO authenticated;`);
 await db.exec(evidence.functions.find(x=>x.proname==='is_super_user').definition);
 for (const p of evidence.full_policies.filter(p=>p.tablename==='clubs' || (['club_members','player_profiles','app_admins'].includes(p.tablename)&&p.cmd==='SELECT'))) {
   await db.exec(`CREATE POLICY "${p.policyname}" ON public.${p.tablename} FOR ${p.cmd} TO ${p.roles.slice(1,-1)} ${p.qual ? `USING (${p.qual})`:''} ${p.with_check ? `WITH CHECK (${p.with_check})`:''};`);
 }
 const trigger=evidence.triggers.find(x=>x.relname==='clubs');
 await db.exec(trigger.function_definition); await db.exec(trigger.definition);
 await db.exec(`INSERT INTO clubs(id,name,owner_id) VALUES ('${uid(101)}','A','${uid(1)}'),('${uid(102)}','B','${uid(8)}');
 INSERT INTO player_profiles VALUES ('${uid(201)}','${uid(1)}',true);
 INSERT INTO club_members VALUES
 ('${uid(301)}','${uid(101)}',null,'${uid(201)}','main_admin',true),
 ('${uid(302)}','${uid(101)}','${uid(2)}',null,'main_admin',true),
 ('${uid(303)}','${uid(101)}','${uid(3)}',null,'sub_admin',true),
 ('${uid(304)}','${uid(101)}','${uid(4)}',null,'member',true),
 ('${uid(305)}','${uid(101)}','${uid(5)}',null,'main_admin',false);
 INSERT INTO app_admins VALUES ('${uid(9)}',true);`);
 async function context(n, role='authenticated', email='ordinary@example.invalid') {
   await db.exec('RESET ROLE');
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[n?uid(n):'', JSON.stringify({email})]);
   await db.exec(`SET ROLE ${role}`);
   assert.equal((await db.query('SELECT current_user u')).rows[0].u,role);
 }
 async function test(name, fn) {await fn(); results.push({name,status:'PASS'}); console.log('PASS '+name);}
 async function policies(){await db.exec('RESET ROLE'); return (await db.query("SELECT policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE tablename='clubs' ORDER BY policyname")).rows;}
 async function runFile(name){await db.exec('RESET ROLE');await db.exec(fs.readFileSync(path.join(__dirname,name),'utf8'));}
 const before=await policies();
 await test('baseline broad UPDATE permits outsider',async()=>{await context(6);assert.equal((await db.query("UPDATE clubs SET description='baseline' WHERE id=$1 RETURNING id",[uid(101)])).rows.length,1);});
 await test('apply actual SQL',()=>runFile('apply.sql'));
 const after=await policies(); assert.equal(after.length,6);
 for(const [n,label,count] of [[1,'linked main admin',1],[2,'legacy main admin',1],[3,'sub admin',0],[4,'member',0],[5,'inactive admin',0],[6,'outsider',0],[8,'owner of other group',0],[9,'super admin',1]]){
  await test(label,async()=>{await context(n);const value='test-'+n;assert.equal((await db.query('UPDATE clubs SET description=$1 WHERE id=$2 RETURNING id',[value,uid(101)])).rows.length,count); if(count)assert.equal((await db.query('SELECT description FROM clubs WHERE id=$1',[uid(101)])).rows[0].description,value);});
 }
 await test('other group stays unchanged',async()=>{await context(1);const b=(await db.query('SELECT * FROM clubs WHERE id=$1',[uid(102)])).rows;assert.equal((await db.query("UPDATE clubs SET name='bad' WHERE id=$1 RETURNING id",[uid(102)])).rows.length,0);assert.deepEqual((await db.query('SELECT * FROM clubs WHERE id=$1',[uid(102)])).rows,b);});
 await test('anonymous denied',async()=>{await context(null,'anon');await assert.rejects(db.query("UPDATE clubs SET name='bad'"),e=>e.code==='42501');});
 await test('logical deletion allowed to main admin',async()=>{await context(1);assert.equal((await db.query('UPDATE clubs SET is_active=false WHERE id=$1 RETURNING id',[uid(101)])).rows.length,1);assert.equal((await db.query('SELECT is_active FROM clubs WHERE id=$1',[uid(101)])).rows[0].is_active,false);await db.query('UPDATE clubs SET is_active=true WHERE id=$1',[uid(101)]);});
 await test('owner change blocked by existing trigger',async()=>{await context(1);await assert.rejects(db.query('UPDATE clubs SET owner_id=$1 WHERE id=$2',[uid(6),uid(101)]));});
 await test('WITH CHECK rejects id reassignment',async()=>{await context(1);await assert.rejects(db.query('UPDATE clubs SET id=$1 WHERE id=$2',[uid(999),uid(101)]),e=>e.code==='42501');assert.equal((await db.query('SELECT id FROM clubs WHERE id=$1',[uid(101)])).rows.length,1);});
 await test('SELECT remains broad',async()=>{await context(null,'anon');assert.equal((await db.query('SELECT id FROM clubs')).rows.length,2);});
 await test('INSERT and DELETE remain compatible',async()=>{await context(6);await db.query('INSERT INTO clubs(id,name,owner_id) VALUES($1,$2,$3)',[uid(103),'C',uid(6)]);assert.equal((await db.query('DELETE FROM clubs WHERE id=$1 RETURNING id',[uid(103)])).rows.length,1);});
 await test('reapply guard refuses without partial changes',async()=>{await assert.rejects(runFile('apply.sql'));await db.exec('ROLLBACK');assert.deepEqual(await policies(),after);});
 await test('rollback exact baseline policies',async()=>{await runFile('rollback.sql');assert.deepEqual(await policies(),before);});
 await test('apply drift guard rejects extra policy',async()=>{await db.exec('CREATE POLICY unexpected_test ON clubs FOR SELECT TO authenticated USING (true)');await assert.rejects(runFile('apply.sql'));await db.exec('ROLLBACK');await db.exec('DROP POLICY unexpected_test ON clubs');assert.deepEqual(await policies(),before);});
 await test('rollback restores prior broad access',async()=>{await context(6);assert.equal((await db.query("UPDATE clubs SET description='rollback' WHERE id=$1 RETURNING id",[uid(101)])).rows.length,1);});
 await test('apply after rollback',async()=>{await runFile('apply.sql');assert.deepEqual(await policies(),after);});
 await test('rollback drift guard rejects extra policy',async()=>{await db.exec('CREATE POLICY unexpected_test ON clubs FOR SELECT TO authenticated USING (true)');await assert.rejects(runFile('rollback.sql'));await db.exec('ROLLBACK');await db.exec('DROP POLICY unexpected_test ON clubs');assert.deepEqual(await policies(),after);});
 await test('owner only has no UPDATE authority',async()=>{await db.exec('RESET ROLE');await db.query('UPDATE clubs SET owner_id=$1 WHERE id=$2',[uid(7),uid(102)]);await context(7);assert.equal((await db.query("UPDATE clubs SET description='owner-only' WHERE id=$1 RETURNING id",[uid(102)])).rows.length,0);});
 await test('existing JWT email super-user branch preserved',async()=>{await context(6,'authenticated','testuser01@example.com');assert.equal((await db.query("UPDATE clubs SET description='email-super' WHERE id=$1 RETURNING id",[uid(102)])).rows.length,1);});
 await test('verify SQL executes',()=>runFile('verify.sql'));
 await db.exec('RESET ROLE');
 const version=(await db.query('SELECT version() v')).rows[0].v;
 fs.writeFileSync(path.join(__dirname,'test-results.json'), JSON.stringify({engine:'@electric-sql/pglite@0.3.14',version,scope:'local synthetic data only; no Supabase API/Auth/production DML',results},null,2)+'\n');
 await db.close(); console.log(`Completed: ${results.length} PASS`);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
