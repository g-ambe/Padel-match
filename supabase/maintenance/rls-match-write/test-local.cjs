const {PGlite}=require('../../../.rls-validation/node_modules/@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),ev=JSON.parse(fs.readFileSync(path.join(__dirname,'../rls-delete-batch/preflight-production.json'),'utf8'));
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

 await db.exec(fs.readFileSync(path.join(__dirname,'../rls-delete-batch/apply.sql'),'utf8'));
 const prod=JSON.parse(read('preflight-verification.json'));
 const before=await snapshot();
 assert.deepEqual(before.policies,prod.policies,'Pre-existing policies match production');
 assert.deepEqual(before.acl,prod.acl,'Pre-existing ACL matches production');
 const x=await tree();const allBefore=await rawRows();
 await test('baseline outsider INSERT/UPDATE remains possible before this batch',async()=>{await as(6);await db.query('UPDATE match_results SET score_a=8 WHERE id=$1',[x.match_results]);await db.query('INSERT INTO rounds(event_id,round_number) VALUES($1,9999)',[id(101)]);});
 await db.exec('RESET ROLE');await db.query('UPDATE match_results SET score_a=6 WHERE id=$1',[x.match_results]);
 const rowsBefore=await rawRows();
 await test('apply refuses disabled parent identity guard',async()=>{await db.exec('RESET ROLE; ALTER TABLE events DISABLE TRIGGER guard_event_identity');await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK; ALTER TABLE events ENABLE TRIGGER guard_event_identity');assert.deepEqual(await snapshot(),before);});
 await test('apply refuses policy drift atomically',async()=>{await db.exec('CREATE POLICY unexpected_write ON rounds FOR INSERT WITH CHECK(true)');await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK; DROP POLICY unexpected_write ON rounds');assert.deepEqual(await snapshot(),before);});
 await test('apply refuses unsupported legacy null Round instead of changing data',async()=>{await db.query('UPDATE matches SET round_id=null WHERE id=$1',[x.matches]);await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');await db.query('UPDATE matches SET round_id=$1 WHERE id=$2',[x.rounds,x.matches]);assert.deepEqual(await rawRows(),rowsBefore);});
 await test('apply actual SQL without changing data, grants, or triggers',async()=>{await run('apply.sql');assert.deepEqual(await rawRows(),rowsBefore);const post=await snapshot();assert.deepEqual(post.acl,before.acl);assert.deepEqual(post.triggers,before.triggers);});
 const after=await snapshot();
 fs.writeFileSync(path.join(__dirname,'expected-post.json'),JSON.stringify(after,null,2)+'\n');
 const target=['rounds','matches','match_players','match_results'];
 const updates={rounds:{round_number:777},matches:{completed:true,youtube_url:'https://example.invalid/video'},match_players:{team:'B'},match_results:{score_a:7,score_b:5,winner_team:'A'}};
 async function create(t,event,parent,extra={}){
  const row={...(t==='rounds'?{event_id:id(event),round_number:seq++ +1000000}:t==='matches'?{event_id:id(event),round_id:parent.rounds,court_number:seq++}:t==='match_players'?{match_id:parent.matches,participant_id:id(event+400),team:'A'}:{match_id:parent.matches,score_a:6,score_b:4,winner_team:'A'}),...extra};
  const keys=Object.keys(row);return db.query('INSERT INTO '+t+'('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING id',Object.values(row));
 }
 async function change(t,key,extra={}){
  const row={...updates[t],...(t==='rounds'?{round_number:seq++ +2000000}:{}),...extra},keys=Object.keys(row);
  return db.query('UPDATE '+t+' SET '+keys.map((k,i)=>k+'=$'+(i+1)).join(',')+' WHERE id=$'+(keys.length+1)+' RETURNING id',[...Object.values(row),key]);
 }
 for(const [n,label,event,email]of [[1,'main admin',101],[2,'sub admin legacy',101],[3,'member legacy',101],[4,'member linked',101],[6,'other group in own event',102],[7,'no-group creator',103],[9,'app admin',101],[10,'super-user email',102,'testuser01@example.com']]){
  const parent=await tree(event);
  for(const t of target){
   await test(label+' INSERT '+t,async()=>{await as(n,'authenticated',email);assert.equal((await create(t,event,parent)).rows.length,1);});
   await test(label+' UPDATE '+t,async()=>{await as(n,'authenticated',email);assert.equal((await change(t,parent[t])).rows.length,1);});
  }
 }
 for(const [n,label,event]of [[5,'inactive membership',101],[6,'foreign group only',101],[8,'unaffiliated',101],[3,'foreign no-group event',103],[3,'deleted event',104],[null,'uid missing',101]]){
  const parent=await tree(event);
  for(const t of target){
   await test(label+' INSERT '+t+' denied',async()=>{await as(n);await assert.rejects(create(t,event,parent),e=>e.code==='42501');});
   await test(label+' UPDATE '+t+' returns zero',async()=>{await as(n);assert.equal((await change(t,parent[t])).rows.length,0);});
  }
 }
 for(const t of target){
  const parent=await tree();
  await test('anon INSERT '+t+' denied by grant',async()=>{await as(null,'anon');await assert.rejects(create(t,101,parent),e=>e.code==='42501');});
  await test('anon UPDATE '+t+' denied by grant',async()=>{await as(null,'anon');await assert.rejects(change(t,parent[t]),e=>e.code==='42501');});
 }
 const own=await tree(),foreign=await tree(102),sameOther=await tree(105);
 for(const [label,event,round]of [['foreign Round',101,foreign.rounds],['different own event Round',101,sameOther.rounds],['foreign event and own Round',102,own.rounds],['null Round',101,null],['missing Round',101,id(999999)]]){
  await test('match INSERT rejects '+label,async()=>{await as(3);await assert.rejects(create('matches',event,own,{round_id:round}),e=>e.code==='42501');});
 }
 for(const [label,match,participant]of [['foreign participant',own.matches,id(502)],['different own event participant',own.matches,id(505)],['foreign match',foreign.matches,id(501)],['null participant',own.matches,null],['null match',null,id(501)],['missing match',id(999999),id(501)],['missing participant',own.matches,id(999999)]]){
  await test('player INSERT rejects '+label,async()=>{await as(3);await assert.rejects(create('match_players',101,own,{match_id:match,participant_id:participant}),e=>e.code==='42501');});
 }
 for(const t of ['rounds','matches'])for(const value of [null,id(999999)]){
  await test(t+' rejects invalid event '+value,async()=>{await as(3);await assert.rejects(create(t,101,own,{event_id:value}),e=>e.code==='42501');});
 }
 for(const value of [null,id(999999)]){
  await test('result rejects invalid match '+value,async()=>{await as(3);await assert.rejects(create('match_results',101,own,{match_id:value}),e=>e.code==='42501');});
 }
 for(const [t,field,value]of [['rounds','event_id',id(102)],['matches','event_id',id(102)],['matches','round_id',foreign.rounds],['match_players','match_id',foreign.matches],['match_players','participant_id',id(502)],['match_results','match_id',foreign.matches]]){
  await test('own '+t+' '+field+' cannot be reassigned',async()=>{await as(3);await assert.rejects(change(t,own[t],{[field]:value}),e=>e.code==='42501');});
 }
 await test('closed but undeleted own event keeps score correction and generation',async()=>{const parent=await tree(105);await as(3);for(const t of target){assert.equal((await create(t,105,parent)).rows.length,1);assert.equal((await change(t,parent[t])).rows.length,1);}});
 await test('team-side manager capability preserved',async()=>{await db.exec('RESET ROLE');await db.query("UPDATE events SET event_mode='team' WHERE id=$1",[id(105)]);await db.query('INSERT INTO event_team_sides(event_id,side,club_id) VALUES($1,$2,$3)',[id(105),'team_a',id(302)]);const parent=await tree(105);await as(6);for(const t of target){assert.equal((await create(t,105,parent)).rows.length,1);assert.equal((await change(t,parent[t])).rows.length,1);}});
 await test('current ordinary-member workflow creates round/lineup, saves twice, changes lineup and removes match',async()=>{
  await as(3);const players=[];for(let i=0;i<4;i++)players.push((await db.query("INSERT INTO event_participants(event_id,guest_name,status) VALUES($1,$2,'active') RETURNING id",[id(101),'通し'+i])).rows[0].id);
  const round=(await create('rounds',101,own)).rows[0].id;
  const match=(await create('matches',101,{rounds:round})).rows[0].id;
  for(let i=0;i<4;i++)await create('match_players',101,{matches:match},{participant_id:players[i],team:i<2?'A':'B'});
  const result=(await create('match_results',101,{matches:match})).rows[0].id;
  await change('match_results',result,{score_a:7,score_b:6});await change('matches',match,{completed:true});
  assert.equal((await db.query('SELECT score_a FROM match_results WHERE id=$1',[result])).rows[0].score_a,7);
  await db.query('DELETE FROM match_players WHERE match_id=$1',[match]);
  for(let i=0;i<4;i++)await create('match_players',101,{matches:match},{participant_id:players[i],team:i%2?'A':'B'});
  assert.equal((await db.query('SELECT id FROM match_players WHERE match_id=$1',[match])).rows.length,4);
  await change('rounds',round,{round_number:-100001});await change('rounds',round,{round_number:1});
  await change('matches',match,{youtube_url:null});
  for(const t of ['match_results','match_players'])await db.query('DELETE FROM '+t+' WHERE match_id=$1',[match]);
  await db.query('DELETE FROM matches WHERE id=$1',[match]);await db.query('DELETE FROM rounds WHERE id=$1',[round]);
  assert.equal((await db.query('SELECT id FROM matches WHERE id=$1',[match])).rows.length,0);
 });
 await test('mixed valid/foreign lineup bulk INSERT is atomic',async()=>{await as(3);await assert.rejects(db.query("INSERT INTO match_players(match_id,participant_id,team) VALUES($1,$2,'A'),($1,$3,'B')",[own.matches,id(501),id(502)]),e=>e.code==='42501');assert.equal((await db.query('SELECT id FROM match_players WHERE match_id=$1',[own.matches])).rows.length,1);});
 await test('multirow UPDATE changes own rows and preserves foreign rows',async()=>{const a=await tree(),b=await tree(102);await as(3);assert.equal((await db.query('UPDATE match_results SET score_a=9 WHERE id IN ($1,$2) RETURNING id',[a.match_results,b.match_results])).rows.length,1);await db.exec('RESET ROLE');assert.equal((await db.query('SELECT score_a FROM match_results WHERE id=$1',[b.match_results])).rows[0].score_a,6);});
 await test('service maintenance keeps existing bypass',async()=>{await as(null,'service_role');assert.equal((await create('matches',102,own)).rows.length,1);assert.equal((await change('matches',foreign.matches)).rows.length,1);await db.exec('RESET ROLE');await db.query('DELETE FROM matches WHERE event_id=$1 AND round_id=$2',[id(102),own.rounds]);});
 await test('anonymous shared-style reads unchanged',async()=>{await as(null,'anon');for(const t of target)assert((await db.query('SELECT id FROM '+t+' LIMIT 1')).rows.length>0);});
 await test('foreign DELETE still returns zero',async()=>{await as(3);assert.equal((await db.query('DELETE FROM rounds WHERE id=$1 RETURNING id',[foreign.rounds])).rows.length,0);});
 await test('participant DELETE remains denied',async()=>{await as(3);await assert.rejects(db.query('DELETE FROM event_participants WHERE id=$1',[id(501)]),e=>e.code==='42501');});
 await test('TRUNCATE remains denied',async()=>{await as(3);for(const t of target)await assert.rejects(db.exec('TRUNCATE '+t+' CASCADE'),e=>e.code==='42501');});
 await test('rollback refuses policy drift',async()=>{await db.exec('RESET ROLE; ALTER POLICY rls09_rounds_update ON rounds USING(true)');await assert.rejects(run('rollback.sql'));await db.exec('ROLLBACK');await db.exec('ALTER POLICY rls09_rounds_update ON rounds USING('+after.policies.find(p=>p.policyname==='rls09_rounds_update').qual+')');});
 await test('repeat apply refuses atomically',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.deepEqual(await snapshot(),after);});
 await test('rollback restores exact policies, ACL, triggers and leaves data intact',async()=>{const rows=await rawRows();await run('rollback.sql');assert.deepEqual(await snapshot(),before);assert.deepEqual(await rawRows(),rows);});
 await test('rollback restores original foreign UPDATE',async()=>{await as(6);assert.equal((await change('match_results',own.match_results)).rows.length,1);});
 await test('reapply succeeds',()=>run('apply.sql'));
 fs.writeFileSync(path.join(__dirname,'test-results.json'),JSON.stringify({engine:'PGlite 0.3.14',scope:'synthetic local full migrations through 0039 plus deployed prerequisites',results},null,2)+'\n');console.log(results.length+' PASS');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(db)await db.close();});
