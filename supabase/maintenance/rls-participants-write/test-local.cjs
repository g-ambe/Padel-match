// PostgreSQL tests with synthetic data only; no network or production writes.
const {PGlite}=require('../../../.rls-validation/node_modules/@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const evidence=JSON.parse(fs.readFileSync(path.join(__dirname,'preflight-production.json'),'utf8'));
const uid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const results=[];let db;
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
async function run(n){await db.exec('RESET ROLE');await db.exec(read(n));}
async function as(n,role='authenticated',email='test@example.invalid'){
 await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[n?uid(n):'',JSON.stringify({email})]);await db.exec('SET ROLE '+role);
}
async function test(name,fn){await fn();results.push({name,status:'PASS'});console.log('PASS '+name);}
async function policies(){await db.exec('RESET ROLE');return(await db.query("SELECT * FROM pg_policies WHERE schemaname='public' AND tablename='event_participants' ORDER BY policyname")).rows;}
async function insert(event=101,extra={}){
 const row={event_id:uid(event),guest_name:'追加ゲスト',status:'active',...extra};
 const keys=Object.keys(row);return db.query('INSERT INTO event_participants('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING id',Object.values(row));
}
async function update(id=501,patch={status:'resting'}){
 const keys=Object.keys(patch);return db.query('UPDATE event_participants SET '+keys.map((k,i)=>k+'=$'+(i+1)).join(',')+' WHERE id=$'+(keys.length+1)+' RETURNING id',[...Object.values(patch),uid(id)]);
}
(async()=>{
 db=new PGlite();
 await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE SCHEMA profile_link_private;"+
 "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
 "CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;"+
 "GRANT USAGE ON SCHEMA auth TO anon,authenticated;"+
 "CREATE TABLE profiles(id uuid PRIMARY KEY);"+
 "CREATE TABLE player_profiles(id uuid PRIMARY KEY,linked_auth_user_id uuid,is_active boolean DEFAULT true);"+
 "CREATE TABLE club_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,profile_id uuid,player_profile_id uuid,role text,is_active boolean DEFAULT true);"+
 "CREATE TABLE app_admins(profile_id uuid,is_active boolean);"+
 "CREATE TABLE events(id uuid PRIMARY KEY,club_id uuid,created_by_auth_user_id uuid,event_mode text DEFAULT 'auto',is_deleted boolean DEFAULT false,status text DEFAULT 'active');"+
 "CREATE TABLE event_team_sides(event_id uuid,club_id uuid);"+
 "CREATE TABLE event_participants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,profile_id uuid,player_profile_id uuid,guest_name text,status text NOT NULL,participant_type text NOT NULL DEFAULT 'guest',created_at timestamptz DEFAULT now());");
 for(const constraint of evidence.constraints.filter(x=>x!=='PRIMARY KEY (id)'))await db.exec('ALTER TABLE event_participants ADD '+constraint);
 for(const f of evidence.functions)await db.exec(f.definition);
 for(const t of evidence.triggers)await db.exec(t);
 for(const table of ['events','event_participants','club_members','player_profiles','app_admins'])await db.exec('ALTER TABLE '+table+' ENABLE ROW LEVEL SECURITY');
 for(const p of evidence.policies.filter(p=>p.cmd==='SELECT'||p.tablename==='event_participants')){
  await db.exec('CREATE POLICY "'+p.policyname+'" ON public.'+p.tablename+' FOR '+p.cmd+' TO '+p.roles.join(',')+(p.qual?' USING ('+p.qual+')':'')+(p.with_check?' WITH CHECK ('+p.with_check+')':''));
 }
 await db.exec("CREATE POLICY event_read_compat ON events FOR SELECT TO anon,authenticated USING(true);"+
 "GRANT SELECT ON events,club_members,player_profiles,app_admins,event_participants TO anon,authenticated;"+
 "GRANT UPDATE ON events TO authenticated; CREATE POLICY event_update_compat ON events FOR UPDATE TO authenticated USING(true) WITH CHECK(true);"+
 "GRANT INSERT,UPDATE,DELETE,TRUNCATE ON event_participants TO authenticated; GRANT TRUNCATE ON event_participants TO anon; GRANT ALL ON event_participants TO service_role;");
 // Current production prerequisite prevents an attacker moving the parent event first.
 await db.exec(fs.readFileSync(path.join(__dirname,'../rls-events-identity/apply.sql'),'utf8'));
 for(let n=1;n<=12;n++)await db.query('INSERT INTO profiles VALUES ($1)',[uid(n)]);
 for(const [n,user,active]of [[201,1,true],[202,2,true],[203,3,true],[204,4,true],[205,5,true],[206,6,true],[207,7,true],[208,null,true],[209,null,true]]){
  await db.query('INSERT INTO player_profiles VALUES($1,$2,$3)',[uid(n),user?uid(user):null,active]);
 }
 for(const [club,user,pp,role,active]of [[301,null,201,'main_admin',true],[301,2,null,'sub_admin',true],[301,3,null,'member',true],[301,null,204,'member',true],[301,5,null,'member',false],[302,6,null,'main_admin',true],[301,null,208,'member',true],[301,null,209,'member',true]]){
  await db.query('INSERT INTO club_members(club_id,profile_id,player_profile_id,role,is_active) VALUES($1,$2,$3,$4,$5)',[uid(club),user?uid(user):null,pp?uid(pp):null,role,active]);
 }
 await db.query("INSERT INTO app_admins VALUES($1,true)",[uid(9)]);
 for(const [id,club,creator,mode,deleted,status] of [[101,301,1,'auto',false,'active'],[102,302,6,'auto',false,'active'],[103,null,7,'manual',false,'active'],[104,301,1,'auto',true,'closed'],[105,301,1,'auto',false,'closed'],[106,301,1,'team',false,'active']]){
  await db.query('INSERT INTO events VALUES($1,$2,$3,$4,$5,$6)',[uid(id),club?uid(club):null,uid(creator),mode,deleted,status]);
 }
 await db.query('INSERT INTO event_team_sides VALUES($1,$2)',[uid(106),uid(302)]);
 for(const [n,event,type,pp]of [[501,101,'guest',null],[502,102,'guest',null],[503,103,'member',207],[504,104,'guest',null],[505,105,'member',209]]){
  await db.query("INSERT INTO event_participants(id,event_id,guest_name,status,participant_type,player_profile_id) VALUES($1,$2,'既存','active',$3,$4)",[uid(n),uid(event),type,pp?uid(pp):null]);
 }
 await db.query('UPDATE player_profiles SET is_active=false WHERE id=$1',[uid(209)]);
 const before=await policies();
 await test('baseline outsider could add and update',async()=>{await as(6);const r=await insert();await update();await db.query('DELETE FROM event_participants WHERE id=$1',[r.rows[0].id]);await as(1);await update(501,{status:'active'});});
 await test('apply refuses policy drift atomically',async()=>{await db.exec('RESET ROLE; CREATE POLICY unexpected ON event_participants FOR SELECT USING(true)');await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK; DROP POLICY unexpected ON event_participants');assert.equal((await policies()).length,2);});
 await db.exec('RESET ROLE');
 const rowsBeforeApply=(await db.query('SELECT * FROM event_participants ORDER BY id')).rows;
 await test('apply actual SQL',()=>run('apply.sql'));
 await test('apply preserves all existing participant data',async()=>assert.deepEqual((await db.query('SELECT * FROM event_participants ORDER BY id')).rows,rowsBeforeApply));
 await test('repeat apply refuses without partial changes',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.equal((await policies()).length,5);});
 const after=await policies();
 fs.writeFileSync(path.join(__dirname,'expected-post-policies.json'),JSON.stringify(after,null,2)+'\n');
 assert(!read('rollback.sql').includes('-- EXPECTED_POST_SNAPSHOT_GUARD'));
 for(const [n,label]of [[1,'linked main admin'],[2,'legacy sub admin'],[3,'legacy member'],[4,'linked member'],[9,'app admin']]){
  await test(label+' guest add, rename, rest and restore',async()=>{await as(n);const r=await insert();assert.equal(r.rows.length,1);assert.equal((await update(501,{guest_name:'変更'})).rows.length,1);assert.equal((await update()).rows.length,1);assert.equal((await update(501,{status:'active'})).rows.length,1);});
 }
 await test('existing email-based super-user capability preserved',async()=>{await as(10,'authenticated','testuser01@example.com');assert.equal((await insert()).rows.length,1);assert.equal((await update()).rows.length,1);});
 for(const [n,label]of [[5,'inactive membership'],[6,'other group admin'],[8,'unaffiliated user']]){
  await test(label+' cannot add or update foreign event',async()=>{await as(n);await assert.rejects(insert(),e=>e.code==='42501');assert.equal((await update()).rows.length,0);});
 }
 await test('authenticated role without uid denied',async()=>{await as(null);await assert.rejects(insert(),e=>e.code==='42501');assert.equal((await update()).rows.length,0);});
 await test('anon INSERT and UPDATE denied by grants',async()=>{await as(null,'anon');await assert.rejects(insert(),e=>e.code==='42501');await assert.rejects(update(),e=>e.code==='42501');});
 await test('no-group creator can add self, guest and change state',async()=>{await as(7);assert.equal((await insert(103,{participant_type:'member',player_profile_id:uid(207)})).rows.length,1);assert.equal((await insert(103)).rows.length,1);assert.equal((await update(503,{status:'resting'})).rows.length,1);});
 await test('no-group outsider denied even if belongs elsewhere',async()=>{await as(3);await assert.rejects(insert(103),e=>e.code==='42501');assert.equal((await update(503)).rows.length,0);});
 await test('no-group legacy creator self profile accepted',async()=>{await db.exec('RESET ROLE');await db.query('UPDATE events SET created_by_auth_user_id=$1 WHERE id=$2',[uid(8),uid(103)]);await as(8);assert.equal((await insert(103,{participant_type:'member',profile_id:uid(8)})).rows.length,1);});
 await test('no-group cannot attach foreign member',async()=>{await as(8);await assert.rejects(insert(103,{participant_type:'member',player_profile_id:uid(201)}),e=>e.code==='42501');});
 await test('guest cannot smuggle player reference',async()=>{await as(3);await assert.rejects(insert(101,{player_profile_id:uid(208)}),e=>e.code==='42501');});
 await test('roster bulk inserts linked, provisional and legacy members',async()=>{await as(3);const r=await db.query("INSERT INTO event_participants(event_id,participant_type,player_profile_id,guest_name,status) VALUES ($1,'member',$2,'連携','active'),($1,'member',$3,'仮','active') RETURNING id",[uid(101),uid(201),uid(208)]);assert.equal(r.rows.length,2);assert.equal((await insert(101,{participant_type:'member',profile_id:uid(3)})).rows.length,1);});
 await test('legacy roster profile-id fallback accepted',async()=>{await db.exec('RESET ROLE');await db.query('INSERT INTO player_profiles VALUES($1,$1,true)',[uid(3)]);await as(3);assert.equal((await insert(101,{participant_type:'member',player_profile_id:uid(3)})).rows.length,1);});
 await test('foreign roster player denied',async()=>{await as(3);await assert.rejects(insert(101,{participant_type:'member',player_profile_id:uid(206)}),e=>e.code==='42501');});
 await test('invalid player remains rejected by existing trigger',async()=>{await as(3);await assert.rejects(insert(101,{participant_type:'member',player_profile_id:uid(209)}),/無効化・統合済み/);});
 await test('mismatched legacy account remains rejected',async()=>{await as(3);await assert.rejects(insert(101,{participant_type:'member',player_profile_id:uid(201),profile_id:uid(2)}),/連携アカウント/);});
 await test('closed event roster auto-sync and historic inactive player status remain',async()=>{await as(3);assert.equal((await insert(105,{participant_type:'member',player_profile_id:uid(208)})).rows.length,1);assert.equal((await update(505,{status:'resting'})).rows.length,1);});
 await test('deleted event insert and update denied',async()=>{await as(3);await assert.rejects(insert(104),e=>e.code==='42501');assert.equal((await update(504)).rows.length,0);});
 await test('null and missing event cannot receive participants',async()=>{await as(3);await assert.rejects(insert(101,{event_id:null}),e=>e.code==='42501');await assert.rejects(insert(999),e=>e.code==='42501');});
 await test('team side manager existing capability preserved',async()=>{await as(6);assert.equal((await insert(106)).rows.length,1);});
 for(const [field,value]of [['id',uid(999)],['event_id',uid(102)],['event_id',uid(105)],['profile_id',uid(1)],['player_profile_id',uid(201)],['participant_type','member']]){
  await test('identity guard blocks '+field+'='+value,async()=>{await as(3);await assert.rejects(update(501,{[field]:value}),e=>e.code==='42501');});
 }
 await test('parent event cannot be moved to evade participant checks',async()=>{await as(3);await assert.rejects(db.query('UPDATE events SET club_id=$1 WHERE id=$2',[uid(301),uid(102)]),e=>e.code==='42501');});
 await test('service maintenance can change references',async()=>{await db.exec('RESET ROLE; SET ROLE service_role');assert.equal((await update(501,{event_id:uid(105)})).rows.length,1);assert.equal((await update(501,{event_id:uid(101)})).rows.length,1);});
 await test('definer linking-style updates bypass identity guard',async()=>{await db.exec("RESET ROLE; CREATE FUNCTION profile_link_private.synthetic_relink() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$UPDATE public.event_participants SET player_profile_id='"+uid(208)+"' WHERE id='"+uid(503)+"'$$; GRANT USAGE ON SCHEMA profile_link_private TO authenticated; GRANT EXECUTE ON FUNCTION profile_link_private.synthetic_relink() TO authenticated;");await as(7);await db.exec('SELECT profile_link_private.synthetic_relink()');});
 await test('anon shared-style read unchanged',async()=>{await as(null,'anon');assert((await db.query('SELECT id FROM event_participants WHERE event_id=$1',[uid(101)])).rows.length>0);});
 await test('DELETE compatibility intentionally unchanged',async()=>{await as(6);const r=await db.query('DELETE FROM event_participants WHERE event_id=$1 RETURNING id',[uid(106)]);assert.equal(r.rows.length,1);});
 for(const role of ['anon','authenticated'])await test(role+' TRUNCATE denied',async()=>{await as(role==='anon'?null:3,role);await assert.rejects(db.exec('TRUNCATE event_participants'),e=>e.code==='42501');});
 await test('rollback refuses policy drift',async()=>{await db.exec('RESET ROLE; ALTER POLICY rls07_participants_update ON event_participants USING(false)');await assert.rejects(run('rollback.sql'));await db.exec('ROLLBACK');await db.exec('ALTER POLICY rls07_participants_update ON event_participants USING('+JSON.parse(fs.readFileSync(path.join(__dirname,'expected-post-policies.json'),'utf8')).find(p=>p.policyname==='rls07_participants_update').qual+')');});
 await test('rollback restores original policies and truncate grants',async()=>{await run('rollback.sql');assert.deepEqual(await policies(),before);for(const role of ['anon','authenticated'])assert((await db.query("SELECT has_table_privilege($1,'public.event_participants','TRUNCATE') ok",[role])).rows[0].ok);});
 await test('rollback restores original outsider writes',async()=>{await as(6);assert.equal((await insert()).rows.length,1);assert.equal((await update()).rows.length,1);});
 await test('reapply succeeds',()=>run('apply.sql'));
 fs.writeFileSync(path.join(__dirname,'test-results.json'),JSON.stringify({engine:'PGlite 0.3.14',scope:'synthetic local only',results},null,2)+'\n');console.log(results.length+' PASS');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(db)await db.close();});
