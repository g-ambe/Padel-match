const fs=require('node:fs'),path=require('node:path');
module.exports=async({db,context,test,uid,assert,evidence})=>{
 const live=JSON.parse(fs.readFileSync(path.join(__dirname,'preflight-production.json'),'utf8'));
 const run=async file=>{await db.exec('RESET ROLE');await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));};
 const snapshot=async()=>{await db.exec('RESET ROLE');return (await db.query("SELECT policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='events' ORDER BY policyname")).rows;};
 await db.exec(`RESET ROLE;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_user::text$$;
 CREATE TABLE events(id uuid PRIMARY KEY,club_id uuid REFERENCES clubs(id),name text,status text DEFAULT 'active',event_mode text DEFAULT 'auto',stats_mode text DEFAULT 'official',is_deleted boolean DEFAULT false,created_by_auth_user_id uuid,share_enabled boolean DEFAULT false,share_token text,court_count integer DEFAULT 2,category text DEFAULT 'club');
 CREATE TABLE event_team_sides(id uuid PRIMARY KEY,event_id uuid REFERENCES events(id),club_id uuid,side text,team_name text);
 CREATE TABLE event_participants(id uuid PRIMARY KEY,event_id uuid REFERENCES events(id),player_profile_id uuid,profile_id uuid,status text,participant_type text,guest_name text);
 ALTER TABLE events ENABLE ROW LEVEL SECURITY; ALTER TABLE event_team_sides ENABLE ROW LEVEL SECURITY; ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;
 GRANT SELECT ON events,event_team_sides,event_participants TO anon,authenticated;
 GRANT INSERT,UPDATE,DELETE ON events,event_team_sides,event_participants TO authenticated;
 INSERT INTO club_members(id,club_id,profile_id,role,is_active) VALUES('${uid(720)}','${uid(601)}','${uid(1)}','main_admin',true);`);
 for(const f of evidence.functions.filter(f=>f.proname.includes('friendly_team_event')))await db.exec(f.definition);
 const create=p=>`CREATE POLICY "${p.policyname}" ON public.${p.tablename||'events'} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.slice(1,-1)} ${p.qual?`USING (${p.qual})`:''} ${p.with_check?`WITH CHECK (${p.with_check})`:''}`;
 for(const p of live.policies)await db.exec(create(p));
 for(const p of evidence.full_policies.filter(p=>['event_team_sides','event_participants'].includes(p.tablename)))await db.exec(create(p));
 const trigger=evidence.triggers.find(t=>t.relname==='event_participants');await db.exec(trigger.definition);
 const before=await snapshot();let sequence=800;
 const insert=async(club,creator,mode='auto')=>{const id=uid(++sequence);return {id,result:await db.query('INSERT INTO events(id,name,club_id,created_by_auth_user_id,event_mode,stats_mode) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[id,'synthetic',club===null?null:uid(club),creator===null?null:uid(creator),mode,mode==='auto'?'official':'undecided'])};};
 await test('events baseline allows outsider and spoofed creator',async()=>{await context(6);assert.equal((await insert(601,1)).result.rows.length,1);});
 await test('events INSERT actual SQL applies',()=>run('apply.sql'));
 const after=await snapshot();assert.deepEqual(after.filter(p=>!p.policyname.startsWith('rls05_')),before.filter(p=>p.policyname!=='dev_all_events'));
 for(const [n,label]of [[1,'main'],[3,'sub'],[4,'legacy member'],[7,'linked member']]){
  await test(`events own-group auto+manual create: ${label}`,async()=>{await context(n);for(const mode of ['auto','manual'])assert.equal((await insert(601,n,mode)).result.rows.length,1);});
 }
 await test('events groupless creation by unaffiliated user',async()=>{await context(6);assert.equal((await insert(null,6)).result.rows.length,1);});
 for(const [n,club,creator,label] of [[6,601,6,'outsider'],[4,602,4,'other group'],[5,601,5,'inactive membership'],[4,601,1,'spoofed creator'],[4,601,null,'null creator'],[6,null,1,'groupless spoof'],[9,601,1,'super spoof']]){
  await test(`events INSERT denied: ${label}`,async()=>{await context(n);const count=(await db.query('SELECT count(*) n FROM events')).rows[0].n;await assert.rejects(insert(club,creator),e=>e.code==='42501');assert.equal((await db.query('SELECT count(*) n FROM events')).rows[0].n,count);});
 }
 await test('events anonymous INSERT denied',async()=>{await context(null,'anon');await assert.rejects(insert(601,1),e=>e.code==='42501');});
 await test('events app_admin can create across groups as self',async()=>{await context(9);assert.equal((await insert(602,9)).result.rows.length,1);});
 await test('events email-only super has no additional INSERT exception',async()=>{await context(6,'authenticated','testuser01@example.com');await assert.rejects(insert(601,6),e=>e.code==='42501');});
 await test('events creation then member participant insertion',async()=>{await context(4);const {id}=await insert(601,4);assert.equal((await db.query("INSERT INTO event_participants(id,event_id,player_profile_id,status,participant_type) VALUES($1,$2,$3,'active','member') RETURNING id",[uid(950),id,uid(620)])).rows.length,1);});
 await test('events groupless creator participant insertion',async()=>{await context(6);const {id}=await insert(null,6);assert.equal((await db.query("INSERT INTO event_participants(id,event_id,player_profile_id,status,participant_type) VALUES($1,$2,$3,'active','member') RETURNING id",[uid(951),id,uid(641)])).rows.length,1);});
 for(const [club,n,label] of [[601,3,'group-side team'],[null,6,'both-free team']]){
  await test(`events team creation and side setup: ${label}`,async()=>{await context(n);const {id}=await insert(club,n,'team');for(const side of ['team_a','team_b'])assert.equal((await db.query('INSERT INTO event_team_sides(id,event_id,club_id,side,team_name) VALUES($1,$2,$3,$4,$5) RETURNING id',[uid(++sequence),id,club?uid(club):null,side,side])).rows.length,1);});
 }
 await test('events SELECT UPDATE DELETE remain compatible',async()=>{await context(4);const {id}=await insert(601,4);await context(6);assert.equal((await db.query('SELECT id FROM events WHERE id=$1',[id])).rows.length,1);assert.equal((await db.query("UPDATE events SET status='closed' WHERE id=$1 RETURNING id",[id])).rows.length,1);assert.equal((await db.query('DELETE FROM events WHERE id=$1 RETURNING id',[id])).rows.length,1);});
 await test('events repeated apply refuses',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.deepEqual(await snapshot(),after);});
 await test('events rollback refuses unrelated policy drift',async()=>{await db.exec('CREATE POLICY extra_events ON events FOR INSERT TO authenticated WITH CHECK(true)');await assert.rejects(run('rollback.sql'));await db.exec('ROLLBACK');await db.exec('DROP POLICY extra_events ON events');assert.deepEqual(await snapshot(),after);});
 await test('events rollback restores exact baseline',async()=>{await run('rollback.sql');assert.deepEqual(await snapshot(),before);});
 await test('events rollback restores broad INSERT',async()=>{await context(6);assert.equal((await insert(601,1)).result.rows.length,1);});
 await test('events reapply and verification',async()=>{await run('apply.sql');assert.deepEqual(await snapshot(),after);await run('verify.sql');});
};
