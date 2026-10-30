const {PGlite}=require('../../../.rls-validation/node_modules/@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),ev=JSON.parse(fs.readFileSync(path.join(__dirname,'preflight-production.json'),'utf8'));
const tables=['event_participants','rounds','matches','match_players','match_results'],results=[];
const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');let db,seq=1000;
async function test(name,fn){await fn();results.push({name,status:'PASS'});console.log('PASS '+name);}
async function as(n,role='authenticated',email='test@example.invalid'){
 await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[n?id(n):'',JSON.stringify({email})]);await db.exec('SET ROLE '+role);
}
async function snapshot(){await db.exec('RESET ROLE');const policy=(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname",[tables])).rows;
 const acl=(await db.query("SELECT c.relname as \"table\",CASE WHEN grantee=0 THEN 'PUBLIC' ELSE grantee::regrole::text END grantee,grantor::regrole::text grantor,privilege_type privilege,is_grantable grantable FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname,aclexplode.grantee,privilege_type",[tables])).rows;
 const triggers=(await db.query("SELECT pg_get_triggerdef(oid) def FROM pg_trigger WHERE tgrelid IN ('rounds'::regclass,'matches'::regclass,'match_players'::regclass,'match_results'::regclass) AND NOT tgisinternal ORDER BY tgrelid,tgname")).rows;
 return {policies:policy,acl,triggers};
}
async function run(f){await db.exec('RESET ROLE');await db.exec(read(f));}
async function tree(event=101,hasRound=true){
 await db.exec('RESET ROLE');const r=id(seq++),m=id(seq++),mp=id(seq++),mr=id(seq++);
 if(hasRound)await db.query('INSERT INTO rounds(id,event_id,round_number) VALUES($1,$2,$3)',[r,id(event),seq]);
 await db.query('INSERT INTO matches(id,event_id,round_id,court_number) VALUES($1,$2,$3,1)',[m,id(event),hasRound?r:null]);
 await db.query("INSERT INTO match_players(id,match_id,participant_id,team) VALUES($1,$2,$3,'A')",[mp,m,id(event+400)]);
 await db.query("INSERT INTO match_results(id,match_id,score_a,score_b,winner_team) VALUES($1,$2,6,4,'A')",[mr,m]);return{rounds:r,matches:m,match_players:mp,match_results:mr};
}
async function rowCounts(){await db.exec('RESET ROLE');const o={};for(const t of tables)o[t]=Number((await db.query('SELECT count(*) n FROM '+t)).rows[0].n);return o;}
async function rawRows(){await db.exec('RESET ROLE');const o={};for(const t of tables)o[t]=(await db.query('SELECT * FROM '+t+' ORDER BY id')).rows;return o;}
(async()=>{
 db=new PGlite();await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
 "create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;"+
 "create function auth.role() returns text language sql stable as $$select current_user::text$$;"+
 "grant usage on schema auth,public to anon,authenticated,service_role; create function public.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;");
 const dir=path.join(root,'supabase/migrations');
 for(const file of fs.readdirSync(dir).sort())if(file.endsWith('.sql')&&file<'0040')await db.exec(fs.readFileSync(path.join(dir,file),'utf8').replace(/create extension if not exists (?:"uuid-ossp"|pgcrypto);/g,''));
 await db.exec('grant select on all tables in schema public to anon,authenticated');
 for(const t of tables)await db.exec('REVOKE ALL ON '+t+' FROM anon,authenticated,service_role');
 for(const a of ev.acl)await db.exec('GRANT '+a.privilege+' ON '+a.table+' TO '+a.grantee+(a.grantable?' WITH GRANT OPTION':''));
 // Recreate prerequisite participant policies, identity guard and privileges before the new batch.
 await db.exec('GRANT DELETE,TRUNCATE ON event_participants TO authenticated; GRANT TRUNCATE ON event_participants TO anon');
 await db.exec(fs.readFileSync(path.join(root,'supabase/maintenance/rls-participants-write/apply.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/maintenance/rls-events-identity/apply.sql'),'utf8'));
 for(let n=1;n<=10;n++){
  await db.query('INSERT INTO auth.users VALUES($1,$2,now())',[id(n),'u'+n+'@example.invalid']);
  await db.query('INSERT INTO profiles(id,display_name,email) VALUES($1,$2,$3)',[id(n),'選手'+n,'u'+n+'@example.invalid']);
  await db.query('INSERT INTO player_profiles(id,linked_auth_user_id,display_name) VALUES($1,$2,$3)',[id(200+n),id(n),'選手'+n]);
 }
 await db.query("INSERT INTO clubs(id,name,owner_id) VALUES($1,'A',$2),($3,'B',$4)",[id(301),id(1),id(302),id(6)]);
 for(const [n,role,club,active,linked]of [[1,'main_admin',301,true,true],[2,'sub_admin',301,true,false],[3,'member',301,true,false],[4,'member',301,true,true],[5,'member',301,false,false],[6,'main_admin',302,true,true]]){
  await db.query('INSERT INTO club_members(club_id,profile_id,player_profile_id,role,is_active) VALUES($1,$2,$3,$4,$5)',[id(club),linked?null:id(n),id(200+n),role,active]);
 }
 await db.query("INSERT INTO app_admins(profile_id,is_active) VALUES($1,true)",[id(9)]);
 for(const [n,club,creator,deleted,status]of [[101,301,1,false,'active'],[102,302,6,false,'active'],[103,null,7,false,'active'],[104,301,1,true,'closed'],[105,301,1,false,'closed']]){
  await db.query('INSERT INTO events(id,club_id,created_by_auth_user_id,name,court_count,is_deleted,status) VALUES($1,$2,$3,$4,1,$5,$6)',[id(n),club?id(club):null,id(creator),'開催'+n,deleted,status]);
  await db.query("INSERT INTO event_participants(id,event_id,guest_name,status) VALUES($1,$2,'ゲスト','active')",[id(n+400),id(n)]);
 }
 const before=await snapshot();assert.deepEqual(before.policies,ev.policies,'Production policy fixture mismatch');
 assert.deepEqual(before.acl,ev.acl,'Production ACL fixture mismatch');
 await tree();const originalRows=await rawRows();
 await test('apply actual SQL and preserve rows',async()=>{await run('apply.sql');assert.deepEqual(await rawRows(),originalRows);});
 const after=await snapshot();
 fs.writeFileSync(path.join(__dirname,'expected-post.json'),JSON.stringify(after,null,2)+'\n');
 for(const [n,label,event]of [[1,'main',101],[2,'sub',101],[3,'member',101],[4,'linked member',101],[7,'no-group creator',103],[9,'app admin',101]]){
  for(const table of tables.slice(1))await test(label+' DELETE '+table,async()=>{const x=await tree(event);await as(n);const r=await db.query('DELETE FROM '+table+' WHERE id=$1 RETURNING id',[x[table]]);assert.equal(r.rows.length,1);});
 }
 for(const [n,label,event]of [[5,'inactive member',101],[6,'other-group admin',101],[8,'unaffiliated',101],[3,'other creator',103],[3,'deleted event',104],[null,'uid missing',101]]){
  const x=await tree(event);
  for(const table of tables.slice(1))await test(label+' denied '+table,async()=>{await as(n);assert.equal((await db.query('DELETE FROM '+table+' WHERE id=$1 RETURNING id',[x[table]])).rows.length,0);});
 }
 for(const role of ['anon','authenticated'])await test(role+' participant physical DELETE denied',async()=>{await as(role==='anon'?null:3,role);await assert.rejects(db.query('DELETE FROM event_participants WHERE id=$1',[id(501)]),e=>e.code==='42501');});
 for(const table of tables.slice(1))await test('anon DELETE '+table+' denied by grant',async()=>{await as(null,'anon');await assert.rejects(db.exec('DELETE FROM '+table),e=>e.code==='42501');});
 for(const role of ['anon','authenticated'])for(const table of tables.slice(1))await test(role+' TRUNCATE '+table+' denied',async()=>{await as(role==='anon'?null:3,role);await assert.rejects(db.exec('TRUNCATE '+table+' CASCADE'),e=>e.code==='42501');});
 for(const [table,cols]of Object.entries({rounds:['id','event_id'],matches:['id','event_id','round_id'],match_players:['id','match_id','participant_id'],match_results:['id','match_id']})){
  const x=await tree(102);
  for(const col of cols)await test('foreign '+table+' '+col+' reassignment denied',async()=>{await as(3);await assert.rejects(db.query('UPDATE '+table+' SET '+col+'=$1 WHERE id=$2',[id(999999),x[table]]),e=>e.code==='42501');});
 }
 await test('foreign participant reassignment changes zero rows',async()=>{await as(3);assert.equal((await db.query('UPDATE event_participants SET event_id=$1 WHERE id=$2 RETURNING id',[id(101),id(502)])).rows.length,0);});
 await test('own participant reassignment still denied',async()=>{await as(3);await assert.rejects(db.query('UPDATE event_participants SET event_id=$1 WHERE id=$2',[id(102),id(501)]),e=>e.code==='42501');});
 await test('parent event reassignment still denied',async()=>{await as(3);await assert.rejects(db.query('UPDATE events SET club_id=$1 WHERE id=$2',[id(301),id(102)]),e=>e.code==='42501');});
 await test('own round cascade removes match, result and player rows',async()=>{const x=await tree();await as(3);await db.query('DELETE FROM rounds WHERE id=$1',[x.rounds]);await db.exec('RESET ROLE');for(const table of tables.slice(1))assert.equal((await db.query('SELECT id FROM '+table+' WHERE id=$1',[x[table]])).rows.length,0);});
 await test('foreign round cascade rejected; all child rows retained',async()=>{const x=await tree(102);await as(3);assert.equal((await db.query('DELETE FROM rounds WHERE id=$1 RETURNING id',[x.rounds])).rows.length,0);await db.exec('RESET ROLE');for(const table of tables.slice(1))assert.equal((await db.query('SELECT id FROM '+table+' WHERE id=$1',[x[table]])).rows.length,1);});
 await test('selection edit DELETE then INSERT works',async()=>{const x=await tree();await as(3);await db.query('DELETE FROM match_players WHERE match_id=$1',[x.matches]);await db.query("INSERT INTO match_players(match_id,participant_id,team) VALUES($1,$2,'B')",[x.matches,id(501)]);assert.equal((await db.query('SELECT team FROM match_players WHERE match_id=$1',[x.matches])).rows[0].team,'B');});
 await test('UI result -> players -> match -> empty round flow works',async()=>{const x=await tree();await as(3);for(const table of ['match_results','match_players'])await db.query('DELETE FROM '+table+' WHERE match_id=$1',[x.matches]);await db.query('DELETE FROM matches WHERE id=$1',[x.matches]);await db.query('DELETE FROM rounds WHERE id=$1',[x.rounds]);});
 await test('round renumber and score/video updates stay usable',async()=>{const x=await tree();await as(3);await db.query('UPDATE rounds SET round_number=-100001 WHERE id=$1',[x.rounds]);await db.query('UPDATE rounds SET round_number=1 WHERE id=$1',[x.rounds]);await db.query("UPDATE matches SET youtube_url='https://example.invalid',completed=true WHERE id=$1",[x.matches]);await db.query('UPDATE match_results SET score_a=7 WHERE id=$1',[x.match_results]);});
 await test('closed own event deletion preserved',async()=>{const x=await tree(105);await as(3);assert.equal((await db.query('DELETE FROM matches WHERE id=$1 RETURNING id',[x.matches])).rows.length,1);});
 await test('legacy match without round can be deleted',async()=>{const x=await tree(101,false);await as(3);assert.equal((await db.query('DELETE FROM matches WHERE id=$1 RETURNING id',[x.matches])).rows.length,1);});
 await test('super-user email existing access preserved',async()=>{const x=await tree(102);await as(10,'authenticated','testuser01@example.com');assert.equal((await db.query('DELETE FROM rounds WHERE id=$1 RETURNING id',[x.rounds])).rows.length,1);});
 await test('maintenance role can change identities and delete participant',async()=>{const x=await tree();await as(null,'service_role');await db.query('UPDATE matches SET round_id=null WHERE id=$1',[x.matches]);await db.query('INSERT INTO event_participants(event_id,guest_name,status) VALUES($1,$2,$3) RETURNING id',[id(101),'管理用','active']).then(async r=>{await db.query('DELETE FROM event_participants WHERE id=$1',[r.rows[0].id]);});});
 await test('anon share-style read remains',async()=>{await as(null,'anon');for(const t of tables)assert((await db.query('SELECT id FROM '+t+' LIMIT 1')).rows.length>0);});
 await test('general member generates, saves scores, edits lineup and deletes a full match',async()=>{
  await as(3);
  const ps=[];for(let i=0;i<4;i++)ps.push((await db.query("INSERT INTO event_participants(event_id,guest_name,status) VALUES($1,$2,'active') RETURNING id",[id(101),'通し確認'+i])).rows[0].id);
  const r=(await db.query('INSERT INTO rounds(event_id,round_number) VALUES($1,700) RETURNING id',[id(101)])).rows[0].id;
  const m=(await db.query('INSERT INTO matches(event_id,round_id,court_number) VALUES($1,$2,1) RETURNING id',[id(101),r])).rows[0].id;
  for(let i=0;i<4;i++)await db.query('INSERT INTO match_players(match_id,participant_id,team) VALUES($1,$2,$3)',[m,ps[i],i<2?'A':'B']);
  const score=(await db.query("INSERT INTO match_results(match_id,score_a,score_b,winner_team) VALUES($1,6,4,'A') RETURNING id",[m])).rows[0].id;
  await db.query('UPDATE matches SET completed=true WHERE id=$1',[m]);
  await db.query('UPDATE match_results SET score_a=7 WHERE id=$1',[score]);
  assert.equal((await db.query('SELECT score_a FROM match_results WHERE id=$1',[score])).rows[0].score_a,7);
  await db.query('DELETE FROM match_players WHERE match_id=$1',[m]);
  for(let i=0;i<4;i++)await db.query('INSERT INTO match_players(match_id,participant_id,team) VALUES($1,$2,$3)',[m,ps[i],i%2?'A':'B']);
  assert.equal((await db.query('SELECT id FROM match_players WHERE match_id=$1',[m])).rows.length,4);
  for(const t of ['match_results','match_players'])await db.query('DELETE FROM '+t+' WHERE match_id=$1',[m]);
  await db.query('DELETE FROM matches WHERE id=$1',[m]);await db.query('DELETE FROM rounds WHERE id=$1',[r]);
  assert.equal((await db.query('SELECT id FROM matches WHERE id=$1',[m])).rows.length,0);
 });
 await test('private identity helper cannot be invoked or changed by web roles',async()=>{await db.exec('RESET ROLE');for(const role of ['anon','authenticated']){const row=(await db.query("SELECT has_schema_privilege($1,'match_identity_private','USAGE') u,has_schema_privilege($1,'match_identity_private','CREATE') c,has_function_privilege($1,'match_identity_private.guard_identity()','EXECUTE') e",[role])).rows[0];assert.deepEqual(row,{u:false,c:false,e:false});}});
 await test('rollback refuses policy drift',async()=>{await db.exec('RESET ROLE; ALTER POLICY rls08_rounds_delete ON rounds USING(true)');await assert.rejects(run('rollback.sql'));await db.exec('ROLLBACK');await db.exec('ALTER POLICY rls08_rounds_delete ON rounds USING('+after.policies.find(p=>p.policyname==='rls08_rounds_delete').qual+')');});
 await test('repeat apply refuses atomically',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.deepEqual(await snapshot(),after);});
 await test('rollback restores exact policies, ACL and triggers',async()=>{const rows=await rawRows();await run('rollback.sql');assert.deepEqual(await snapshot(),before);assert.deepEqual(await rawRows(),rows);});
 await test('rollback restores foreign deletion',async()=>{const x=await tree(102);await as(3);assert.equal((await db.query('DELETE FROM rounds WHERE id=$1 RETURNING id',[x.rounds])).rows.length,1);});
 await test('reapply works',()=>run('apply.sql'));
 fs.writeFileSync(path.join(__dirname,'test-results.json'),JSON.stringify({engine:'PGlite 0.3.14',scope:'synthetic local full migrations through 0039 plus prerequisites',results},null,2)+'\n');console.log(results.length+' PASS');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(db)await db.close();});
