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

 await db.exec(fs.readFileSync(path.join(__dirname,'../rls-match-write/apply.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../rls-events-insert/apply.sql'),'utf8'));
 await db.exec('GRANT UPDATE,INSERT ON events TO authenticated');
 async function pol(){await db.exec('RESET ROLE');return(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' AND tablename='events' ORDER BY policyname")).rows;}
 async function rows(){await db.exec('RESET ROLE');return(await db.query('SELECT * FROM events ORDER BY id')).rows;}
 async function update(event,patch){const ks=Object.keys(patch);return db.query('UPDATE events SET '+ks.map((k,i)=>k+'=$'+(i+1)).join(',')+' WHERE id=$'+(ks.length+1)+' RETURNING id',[...Object.values(patch),id(event)]);}
 const before=await pol(),prod=JSON.parse(read('preflight-production.json'));assert.deepEqual(before,prod.policies);
 await db.query("INSERT INTO events(id,club_id,created_by_auth_user_id,name,court_count,event_mode) VALUES($1,$2,$3,'チーム',1,'team'),($4,null,$5,'個人チーム',1,'team')",[id(106),id(301),id(8),id(107),id(7)]);
 await db.query("INSERT INTO event_team_sides(event_id,side,club_id) VALUES($1,'team_a',$2)",[id(106),id(302)]);
 const beforeRows=await rows();
 await test('baseline foreign event update was allowed',async()=>{await as(6);assert.equal((await update(101,{court_count:2})).rows.length,1);await db.exec('RESET ROLE');await update(101,{court_count:1});});
 await test('apply refuses disabled identity guard atomically',async()=>{await db.exec('RESET ROLE; ALTER TABLE events DISABLE TRIGGER guard_event_identity');await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK; ALTER TABLE events ENABLE TRIGGER guard_event_identity');assert.deepEqual(await pol(),before);});
 await test('apply actual SQL preserves data',async()=>{await run('apply.sql');assert.deepEqual(await rows(),beforeRows);});
 const after=await pol();fs.writeFileSync(path.join(__dirname,'expected-post.json'),JSON.stringify(after,null,2)+'\n');
 for(const [u,label]of [[1,'main linked'],[2,'sub legacy'],[3,'member legacy'],[4,'member linked']]){
  await test(label+' court count close reopen preserved',async()=>{await as(u);assert.equal((await update(101,{court_count:2})).rows.length,1);assert.equal((await update(101,{status:'closed',closed_at:new Date('2026-01-01Z'),stats_mode:'official'})).rows.length,1);assert.equal((await update(101,{status:'active',closed_at:null})).rows.length,1);await update(101,{court_count:1});});
 }
 for(const [u,label]of [[5,'inactive'],[6,'foreign group'],[8,'unaffiliated'],[null,'uid missing']]){
  await test(label+' cannot modify foreign normal event',async()=>{await as(u);assert.equal((await update(101,{court_count:2})).rows.length,0);});
 }
 await test('no-group creator manages own event',async()=>{await as(7);assert.equal((await update(103,{name:'本人名',status:'closed'})).rows.length,1);});
 await test('other account cannot modify no-group event',async()=>{await as(3);assert.equal((await update(103,{court_count:2})).rows.length,0);});
 await test('anon UPDATE remains denied by table grant',async()=>{await as(null,'anon');await assert.rejects(update(101,{court_count:2}),e=>e.code==='42501');});
 for(const field of ['name','description','memo','category','created_at','event_mode','share_enabled','share_token','share_token_updated_at','is_deleted','deleted_at']){
  const values={name:'不正名',description:'説明',memo:'メモ',category:'mixed',created_at:new Date('2025-01-01Z'),event_mode:'manual',share_enabled:true,share_token:'test-token',share_token_updated_at:new Date('2026-01-01Z'),is_deleted:true,deleted_at:new Date('2026-01-01Z')};
  for(const u of [3,4])await test('member '+u+' cannot alter management field '+field,async()=>{await as(u);await assert.rejects(update(101,{[field]:values[field]}),e=>e.code==='42501');});
 }
 await test('member cannot hide protected change in normal update',async()=>{await as(3);await assert.rejects(update(101,{court_count:2,name:'混入'}),e=>e.code==='42501');});
 for(const u of [1,2]){
  await test('group admin '+u+' name and share updates preserved',async()=>{await as(u);assert.equal((await update(101,{name:'管理名',share_enabled:true,share_token:'token-'+u})).rows.length,1);await update(101,{share_enabled:false,share_token:null});});
 }
 await test('main admin logical delete preserved',async()=>{await as(1);assert.equal((await update(105,{is_deleted:true,deleted_at:new Date('2026-01-01Z')})).rows.length,1);});
 await test('normal member cannot update deleted event',async()=>{await as(3);assert.equal((await update(104,{court_count:2})).rows.length,0);});
 await test('team host ordinary member cannot update team event',async()=>{await as(3);assert.equal((await update(106,{status:'closed'})).rows.length,0);});
 await test('team creator can close and logically delete event',async()=>{await as(8);assert.equal((await update(106,{name:'作成者チーム',status:'closed',stats_mode:'record_only'})).rows.length,1);assert.equal((await update(106,{is_deleted:true,deleted_at:new Date('2026-01-01Z'),share_enabled:false,share_token:null})).rows.length,1);});
 await test('team side admin can close share and logically delete event',async()=>{await db.exec('RESET ROLE');await update(106,{is_deleted:false,status:'active'});await as(6);assert.equal((await update(106,{status:'closed',stats_mode:'official',share_enabled:true,share_token:'team-token'})).rows.length,1);assert.equal((await update(106,{is_deleted:true,share_enabled:false,share_token:null})).rows.length,1);});
 await test('no-group team creator may delete event',async()=>{await as(7);assert.equal((await update(107,{is_deleted:true})).rows.length,1);});
 for(const [u,email]of [[9,'normal@example.invalid'],[10,'testuser01@example.com']]){
  await test('super user '+u+' keeps event management',async()=>{await as(u,'authenticated',email);assert.equal((await update(102,{name:'スーパー変更'})).rows.length,1);});
 }
 for(const field of ['id','club_id','created_by_auth_user_id']){
  await test('existing identity guard still rejects '+field,async()=>{await as(1);await assert.rejects(update(101,{[field]:id(999999)}),e=>e.code==='42501');});
 }
 await test('maintenance bypass remains',async()=>{await db.exec('RESET ROLE; GRANT UPDATE,SELECT ON events TO service_role; SET ROLE service_role');assert.equal((await update(101,{name:'保守変更'})).rows.length,1);});
 await test('shared-style SELECT remains for anon',async()=>{await as(null,'anon');assert((await db.query('SELECT id FROM events LIMIT 1')).rows.length>0);});
 await test('helper schema and function unavailable to web roles',async()=>{await db.exec('RESET ROLE');for(const role of ['anon','authenticated'])assert.deepEqual((await db.query("SELECT has_schema_privilege($1,'events_operation_private','USAGE') u,has_schema_privilege($1,'events_operation_private','CREATE') c,has_function_privilege($1,'events_operation_private.guard_member_fields()','EXECUTE') e",[role])).rows[0],{u:false,c:false,e:false});});
 await test('ordinary creator of group event still cannot rename it',async()=>{await db.exec('RESET ROLE');await db.query("INSERT INTO events(id,club_id,created_by_auth_user_id,name,court_count) VALUES($1,$2,$3,'メンバー開催',1)",[id(108),id(301),id(3)]);await as(3);await assert.rejects(update(108,{name:'名称変更'}),e=>e.code==='42501');});
 await test('deleted team event cannot be restored by side admin',async()=>{await as(6);assert.equal((await update(106,{is_deleted:false})).rows.length,0);});
 await test('member workflow handles optimistic court update and close-reopen with score writes',async()=>{await as(3);const result=await db.query("UPDATE events SET court_count=2 WHERE id=$1 AND court_count=1 AND status='active' AND event_mode='auto' AND is_deleted=false RETURNING court_count",[id(101)]);assert.equal(result.rows.length,1);assert.equal((await db.query('UPDATE events SET court_count=3 WHERE id=$1 AND court_count=1 RETURNING id',[id(101)])).rows.length,0);const round=(await db.query('INSERT INTO rounds(event_id,round_number) VALUES($1,900) RETURNING id',[id(101)])).rows[0].id;const match=(await db.query('INSERT INTO matches(event_id,round_id,court_number) VALUES($1,$2,1) RETURNING id',[id(101),round])).rows[0].id;await db.query("INSERT INTO match_results(match_id,score_a,score_b,winner_team) VALUES($1,6,4,'A')",[match]);await db.query('UPDATE matches SET completed=true WHERE id=$1',[match]);await update(101,{status:'closed',closed_at:new Date('2026-01-01Z'),stats_mode:'official'});assert.equal((await db.query('SELECT status FROM events WHERE id=$1',[id(101)])).rows[0].status,'closed');await update(101,{status:'active'});await db.query('UPDATE match_results SET score_a=7 WHERE match_id=$1',[match]);assert.equal((await db.query('SELECT score_a FROM match_results WHERE match_id=$1',[match])).rows[0].score_a,7);await update(101,{court_count:1});});
 await test('rollback refuses policy drift',async()=>{await db.exec('RESET ROLE; ALTER POLICY rls10_events_update_members ON events USING(true)');await assert.rejects(run('rollback.sql'));await db.exec('ROLLBACK');await db.exec('ALTER POLICY rls10_events_update_members ON events USING('+after.find(p=>p.policyname==='rls10_events_update_members').qual+')');});
 await test('repeat apply stops atomically',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.deepEqual(await pol(),after);});
 await test('rollback restores policies and leaves data unchanged',async()=>{const data=await rows();await run('rollback.sql');assert.deepEqual(await pol(),before);assert.deepEqual(await rows(),data);});
 await test('rollback restores foreign UPDATE behavior',async()=>{await as(6);assert.equal((await update(101,{court_count:2})).rows.length,1);});
 await test('reapply works',()=>run('apply.sql'));
 fs.writeFileSync(path.join(__dirname,'test-results.json'),JSON.stringify({engine:'PGlite 0.3.14',scope:'synthetic local migrations and deployed write/delete prerequisites',results},null,2)+'\n');console.log(results.length+' PASS');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(db)await db.close();});
