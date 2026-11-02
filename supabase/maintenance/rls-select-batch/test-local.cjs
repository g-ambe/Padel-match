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

 await db.exec(fs.readFileSync(path.join(__dirname,'../rls-events-update/apply.sql'),'utf8'));
 const prod=JSON.parse(read('preflight-production.json')),frags=JSON.parse(read('query-fragments.json'));
 const allTables=['events',...tables];
 for(const t of allTables)await db.exec('REVOKE ALL ON '+t+' FROM anon,authenticated,service_role');
 for(const a of prod.acl)await db.exec('GRANT '+a.privilege+' ON '+a.table+' TO '+a.grantee);
 async function state(){
  await db.exec('RESET ROLE');
  return{policies:(await db.query(frags.policies)).rows[0].coalesce,
   acl:(await db.query(frags.acl)).rows[0].jsonb_agg,
   column_acl:(await db.query(frags.column_acl)).rows[0].coalesce,
   helper:(await db.query("SELECT pg_get_functiondef('public.can_view_friendly_team_event_by_sides(uuid,uuid)'::regprocedure) f")).rows[0].f.replaceAll('\r','')};
 }
 async function context(n,role='authenticated',token='',email='test@example.invalid'){
  await as(n,role,email);await db.query("SELECT set_config('request.headers',$1,false)",[JSON.stringify(token?{'x-padel-share-token':token}:{})]);
 }
 async function eventRows(){await db.exec('RESET ROLE');const o={};for(const t of [...allTables,'event_team_sides','event_team_matches'])o[t]=(await db.query('SELECT * FROM '+t+' ORDER BY id')).rows;return o;}
 for(const [n,club,creator,deleted,status,shared,token,mode]of [
  [106,302,6,false,'closed',true,'shared-B','auto'],[107,301,1,false,'closed',true,'shared-A','auto'],
  [108,302,6,false,'active',true,'active-B','auto'],[109,302,6,true,'closed',true,'deleted-B','auto'],
  [110,302,6,false,'closed',false,'stopped-B','auto'],[111,301,8,false,'closed',true,'shared-team','team'],
  [112,null,8,false,'closed',false,null,'team'],[114,301,3,false,'closed',false,null,'team'],
  [115,301,1,false,'active',false,null,'team'],[116,302,6,false,'active',false,null,'team'],[117,301,1,false,'active',false,null,'team']]){
  await db.query('INSERT INTO events(id,club_id,created_by_auth_user_id,name,court_count,is_deleted,status,share_enabled,share_token,event_mode,description,memo) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11)',[id(n),club?id(club):null,id(creator),'開催'+n,deleted,status,shared,token,mode,'内部説明','内部メモ']);
  await db.query("INSERT INTO event_participants(id,event_id,guest_name,status) VALUES($1,$2,'共有ゲスト','active')",[id(n+400),id(n)]);
 }
 for(const n of [111,112,114])await db.query("INSERT INTO event_team_sides(event_id,side,club_id,team_name) VALUES($1,'team_b',$2,'相手チーム')",[id(n),id(302)]);
 await db.query("INSERT INTO event_team_sides(event_id,side,club_id) VALUES($1,'team_a',$2)",[id(114),id(301)]);
 const ownSide=(await db.query("INSERT INTO event_team_sides(event_id,side,club_id) VALUES($1,'team_a',$2) RETURNING id",[id(115),id(301)])).rows[0].id;
 await db.query("INSERT INTO event_team_sides(event_id,side,club_id) VALUES($1,'team_b',$2)",[id(115),id(302)]);
 const ownCard=(await db.query('INSERT INTO event_team_matches(event_id,match_order) VALUES($1,1) RETURNING id',[id(115)])).rows[0].id;
 await db.query("INSERT INTO event_team_matches(event_id,match_order,team_a_score,team_b_score,result) VALUES($1,1,6,4,'win')",[id(111)]);
 await db.query("INSERT INTO event_team_guests(event_id,side,guest_name) VALUES($1,'team_b','チームゲスト')",[id(111)]);
 await db.query("INSERT INTO event_video_links(event_id,title,video_url) VALUES($1,'共有動画','https://example.invalid/video')",[id(111)]);
 const paths={};
 for(const n of [101,102,103,104,105,106,107,108,109,110,111,112,114])paths[n]={events:id(n),event_participants:id(n+400),...await tree(n)};
 await db.query("INSERT INTO event_participants(id,event_id,profile_id,player_profile_id,status,participant_type) VALUES($1,$2,$3,$4,'active','member')",[id(610),id(105),id(5),id(205)]);
 await db.query("INSERT INTO match_players(match_id,participant_id,team) VALUES($1,$2,'B')",[paths[105].matches,id(610)]);
 const before=await state();
 assert.deepEqual(before.policies,prod.policies);assert.deepEqual(before.acl,prod.acl);assert.deepEqual(before.column_acl,[]);
 await test('baseline anonymous and foreign account could enumerate events',async()=>{await context(null,'anon');assert((await db.query('SELECT id FROM events')).rows.length>1);await context(6);assert.equal((await db.query('SELECT id FROM events WHERE id=$1',[id(101)])).rows.length,1);});
 const dataBefore=await eventRows();
 await test('apply refuses unexpected column privileges atomically',async()=>{await db.exec('GRANT SELECT(memo) ON events TO anon');await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK; REVOKE SELECT(memo) ON events FROM anon');assert.deepEqual(await state(),before);});
 await test('apply refuses supplementary team policy drift',async()=>{await db.exec('ALTER POLICY event_team_sides_manage ON event_team_sides WITH CHECK(false)');await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');await db.exec('ALTER POLICY event_team_sides_manage ON event_team_sides WITH CHECK('+prod.policies.find(p=>p.policyname==='event_team_sides_manage').with_check+')');assert.deepEqual(await state(),before);});
 await test('apply SQL does not change any row',async()=>{await run('apply.sql');assert.deepEqual(await eventRows(),dataBefore);});
 const after=await state();fs.writeFileSync(path.join(__dirname,'expected-post.json'),JSON.stringify(after,null,2)+'\n');
 for(const [u,label,n,email]of [[1,'main linked',101],[2,'sub legacy',101],[3,'member legacy',101],[4,'member linked',101],[6,'own other group',102],[7,'no-group creator',103],[8,'no-group team creator',112],[9,'super admin',102],[10,'super email',101,'testuser01@example.com'],[6,'team-side member',111]]){
  for(const t of allTables)await test(label+' SELECT '+t,async()=>{await context(u,'authenticated','',email);assert.equal((await db.query('SELECT id FROM '+t+' WHERE id=$1',[paths[n][t]])).rows.length,1);});
 }
 for(const [u,label,n]of [[5,'departed',105],[6,'foreign group',101],[8,'unaffiliated',101],[3,'foreign no-group event',103],[8,'departed team creator',111],[null,'no uid',101]]){
  for(const t of allTables)await test(label+' cannot SELECT '+t,async()=>{await context(u);assert.equal((await db.query('SELECT id FROM '+t+' WHERE id=$1',[paths[n][t]])).rows.length,0);});
 }
 for(const [token,label]of [['','no token'],['wrong','wrong token'],['active-B','active event'],['deleted-B','deleted event'],['stopped-B','stopped sharing']]){
  for(const t of allTables)await test('anon '+label+' sees no '+t,async()=>{await context(null,'anon',token);assert.equal((await db.query('SELECT id FROM '+t)).rows.length,0);});
 }
 for(const n of [106,107,111]){
  const token={106:'shared-B',107:'shared-A',111:'shared-team'}[n];
  for(const t of allTables)await test('correct token '+n+' reads only '+t,async()=>{await context(null,'anon',token);const rows=(await db.query('SELECT id FROM '+t)).rows;assert.deepEqual(rows.map(r=>r.id),[paths[n][t]]);});
 }
 await test('sharing header does not grant authenticated outsiders access',async()=>{await context(6,'authenticated','shared-A');assert.equal((await db.query('SELECT id FROM events WHERE id=$1',[id(107)])).rows.length,0);});
 await test('empty request headers setting safely denies anonymous reads',async()=>{await context(null,'anon');await db.query("SELECT set_config('request.headers','',false)");assert.equal((await db.query('SELECT id FROM events')).rows.length,0);});
 await test('private columns and SELECT star are denied to anonymous even with correct token',async()=>{await context(null,'anon','shared-B');for(const field of ['memo','description','created_by_auth_user_id','*'])await assert.rejects(db.query('SELECT '+field+' FROM events WHERE id=$1',[id(106)]),e=>e.code==='42501');});
 await test('shared-page event lookup and participant fields remain accessible',async()=>{await context(null,'anon','shared-B');assert.equal((await db.query("SELECT id,name,created_at,status,is_deleted,share_enabled,club_id,event_mode FROM events WHERE share_token=$1 AND share_enabled=true AND status='closed' AND NOT is_deleted",['shared-B'])).rows.length,1);assert.equal((await db.query('SELECT id,guest_name,participant_type,player_profile_id,profile_id FROM event_participants WHERE event_id=$1',[id(106)])).rows.length,1);});
 await test('shared embedded Round/players/results query survives column grants',async()=>{await context(null,'anon','shared-B');const r=await db.query("SELECT m.id,m.court_number,m.completed,m.youtube_url,(SELECT jsonb_build_object('round_number',r.round_number) FROM rounds r WHERE r.id=m.round_id) rounds,(SELECT jsonb_agg(jsonb_build_object('participant_id',p.participant_id,'team',p.team)) FROM match_players p WHERE p.match_id=m.id) players,(SELECT jsonb_agg(jsonb_build_object('score_a',r.score_a,'score_b',r.score_b,'winner_team',r.winner_team)) FROM match_results r WHERE r.match_id=m.id) results FROM matches m WHERE m.event_id=$1 ORDER BY m.created_at DESC",[id(106)]);assert.equal(r.rows.length,1);assert.equal(r.rows[0].players.length,1);assert.equal(r.rows[0].results[0].score_a,6);assert(r.rows[0].rounds.round_number>0);});
 await test('team shared sides/cards/guests and video policies inherit token scope',async()=>{await context(null,'anon','shared-team');for(const t of ['event_team_sides','event_team_matches','event_team_guests','event_video_links'])assert((await db.query('SELECT * FROM '+t+' WHERE event_id=$1',[id(111)])).rows.length>0);await context(null,'anon');for(const t of ['event_team_sides','event_team_matches','event_team_guests','event_video_links'])assert.equal((await db.query('SELECT * FROM '+t+' WHERE event_id=$1',[id(111)])).rows.length,0);});
 await test('departed personal-history participant and actual match do not bypass membership',async()=>{await context(5);assert.equal((await db.query('SELECT id,event_id FROM event_participants WHERE profile_id=$1',[id(5)])).rows.length,0);assert.equal((await db.query('SELECT id FROM matches WHERE id=$1',[paths[105].matches])).rows.length,0);});
 await test('deactivation hides and reactivation restores normal and team history',async()=>{await db.exec('RESET ROLE');await db.query('UPDATE club_members SET is_active=false WHERE profile_id=$1',[id(3)]);await context(3);for(const n of [101,105,114])assert.equal((await db.query('SELECT id FROM events WHERE id=$1',[id(n)])).rows.length,0);await db.exec('RESET ROLE');await db.query('UPDATE club_members SET is_active=true WHERE profile_id=$1',[id(3)]);await context(3);for(const n of [101,105,114])assert.equal((await db.query('SELECT id FROM events WHERE id=$1',[id(n)])).rows.length,1);});
 await test('shared link rotation stops the old token for all six tables',async()=>{await db.exec('RESET ROLE');await db.query("UPDATE events SET share_token='rotated-B' WHERE id=$1",[id(106)]);await context(null,'anon','shared-B');for(const t of allTables)assert.equal((await db.query('SELECT id FROM '+t)).rows.length,0);await context(null,'anon','rotated-B');for(const t of allTables)assert.equal((await db.query('SELECT id FROM '+t)).rows.length,1);await db.exec('RESET ROLE');await db.query("UPDATE events SET share_token='shared-B' WHERE id=$1",[id(106)]);});
 await test('reopening shared event immediately hides anonymous results',async()=>{await db.exec('RESET ROLE');await db.query("UPDATE events SET status='active' WHERE id=$1",[id(106)]);await context(null,'anon','shared-B');for(const t of allTables)assert.equal((await db.query('SELECT id FROM '+t)).rows.length,0);await db.exec('RESET ROLE');await db.query("UPDATE events SET status='closed' WHERE id=$1",[id(106)]);});
 await test('general member generation/save/correction/lineup/deletion still works under SELECT',async()=>{await context(3);const ps=[];for(let i=0;i<4;i++)ps.push((await db.query("INSERT INTO event_participants(event_id,guest_name,status) VALUES($1,$2,'active') RETURNING id",[id(101),'通し'+i])).rows[0].id);const round=(await db.query('INSERT INTO rounds(event_id,round_number) VALUES($1,990) RETURNING id',[id(101)])).rows[0].id;const match=(await db.query('INSERT INTO matches(event_id,round_id,court_number) VALUES($1,$2,1) RETURNING id',[id(101),round])).rows[0].id;for(let i=0;i<4;i++)await db.query('INSERT INTO match_players(match_id,participant_id,team) VALUES($1,$2,$3)',[match,ps[i],i<2?'A':'B']);const result=(await db.query("INSERT INTO match_results(match_id,score_a,score_b,winner_team) VALUES($1,6,4,'A') RETURNING id",[match])).rows[0].id;await db.query('UPDATE match_results SET score_a=7 WHERE id=$1',[result]);await db.query('UPDATE matches SET completed=true WHERE id=$1',[match]);await db.query('DELETE FROM match_players WHERE match_id=$1',[match]);for(let i=0;i<4;i++)await db.query('INSERT INTO match_players(match_id,participant_id,team) VALUES($1,$2,$3)',[match,ps[i],i%2?'A':'B']);assert.equal((await db.query('SELECT id FROM match_players WHERE match_id=$1',[match])).rows.length,4);await db.query('UPDATE events SET court_count=2 WHERE id=$1',[id(101)]);await db.query("UPDATE events SET status='closed',stats_mode='official' WHERE id=$1",[id(101)]);await db.query("UPDATE events SET status='active' WHERE id=$1",[id(101)]);for(const t of ['match_results','match_players'])await db.query('DELETE FROM '+t+' WHERE match_id=$1',[match]);await db.query('DELETE FROM matches WHERE id=$1',[match]);await db.query('DELETE FROM rounds WHERE id=$1',[round]);});
 await test('main admin logical delete with RETURNING remains possible',async()=>{await context(1);assert.equal((await db.query('UPDATE events SET is_deleted=true WHERE id=$1 RETURNING id',[id(105)])).rows.length,1);await db.exec('RESET ROLE');await db.query('UPDATE events SET is_deleted=false WHERE id=$1',[id(105)]);});
 await test('team side manager close and delete using exact count remains possible',async()=>{await db.exec('RESET ROLE');await db.query("UPDATE events SET status='active' WHERE id=$1",[id(111)]);await context(6);assert.equal((await db.query("UPDATE events SET status='closed',stats_mode='record_only' WHERE id=$1 RETURNING id",[id(111)])).rows.length,1);const r=await db.query('UPDATE events SET is_deleted=true,share_enabled=false,share_token=null WHERE id=$1 AND NOT is_deleted',[id(111)]);assert.equal(r.affectedRows,1);await db.exec('RESET ROLE');await db.query("UPDATE events SET is_deleted=false,share_enabled=true,share_token='shared-team' WHERE id=$1",[id(111)]);});
 await test('foreign side INSERT without RETURNING cannot manufacture membership',async()=>{await context(3);await assert.rejects(db.query("INSERT INTO event_team_sides(event_id,side,club_id) VALUES($1,'team_a',$2)",[id(116),id(301)]),e=>e.code==='42501');assert.equal((await db.query('SELECT id FROM events WHERE id=$1',[id(116)])).rows.length,0);});
 await test('foreign team card INSERT without RETURNING denied',async()=>{await context(3);await assert.rejects(db.query('INSERT INTO event_team_matches(event_id,match_order) VALUES($1,99)',[id(116)]),e=>e.code==='42501');});
 await test('own ordinary team viewer cannot add management side or card',async()=>{await context(3);await assert.rejects(db.query("INSERT INTO event_team_sides(event_id,side,club_id) VALUES($1,'team_a',$2)",[id(115),id(301)]),e=>e.code==='42501');await assert.rejects(db.query('INSERT INTO event_team_matches(event_id,match_order) VALUES($1,99)',[id(115)]),e=>e.code==='42501');});
 await test('team creator initializes both sides and opposing side admin adds a card',async()=>{await context(1);await db.query("INSERT INTO event_team_sides(event_id,side,club_id) VALUES($1,'team_a',$2),($1,'team_b',$3)",[id(117),id(301),id(302)]);await context(6);assert.equal((await db.query('INSERT INTO event_team_matches(event_id,match_order) VALUES($1,1) RETURNING id',[id(117)])).rows.length,1);});
 await test('authorized team records cannot be moved to foreign event',async()=>{await context(1);await assert.rejects(db.query('UPDATE event_team_sides SET event_id=$1 WHERE id=$2',[id(116),ownSide]),e=>e.code==='42501');await assert.rejects(db.query('UPDATE event_team_matches SET event_id=$1 WHERE id=$2',[id(116),ownCard]),e=>e.code==='42501');});
 await test('existing authorized host manager edits team fields',async()=>{await context(1);assert.equal((await db.query("UPDATE event_team_sides SET team_name='変更後' WHERE id=$1 RETURNING id",[ownSide])).rows.length,1);assert.equal((await db.query("UPDATE event_team_matches SET team_a_score=6,team_b_score=4,result='win' WHERE id=$1 RETURNING id",[ownCard])).rows.length,1);});
 await test('local adversarial proof: leaving permissive side CHECK would bypass SELECT',async()=>{await db.exec('RESET ROLE; ALTER POLICY event_team_sides_manage ON event_team_sides WITH CHECK(true)');await context(3);await db.query("INSERT INTO event_team_sides(event_id,side,club_id) VALUES($1,'team_a',$2)",[id(116),id(301)]);assert.equal((await db.query('SELECT id FROM events WHERE id=$1',[id(116)])).rows.length,1);await db.exec('RESET ROLE');await db.query('DELETE FROM event_team_sides WHERE event_id=$1',[id(116)]);await db.exec('ALTER POLICY event_team_sides_manage ON event_team_sides WITH CHECK('+after.policies.find(p=>p.policyname==='event_team_sides_manage').with_check+')');await context(3);assert.equal((await db.query('SELECT id FROM events WHERE id=$1',[id(116)])).rows.length,0);});
 await test('group stats aggregate matches unrestricted own-group baseline',async()=>{await db.exec('RESET ROLE');const sql="SELECT count(distinct m.id)::int matches,coalesce(sum(r.score_a),0)::int score FROM events e JOIN matches m ON m.event_id=e.id JOIN match_results r ON r.match_id=m.id WHERE e.club_id=$1 AND e.status='closed' AND NOT e.is_deleted AND e.stats_mode='official'";const expected=(await db.query(sql,[id(301)])).rows;await context(3);assert.deepEqual((await db.query(sql,[id(301)])).rows,expected);assert.equal((await db.query(sql,[id(302)])).rows[0].matches,0);});
 await test('foreign writes remain denied rather than exposing parent through write conditions',async()=>{await context(6);assert.equal((await db.query('UPDATE match_results SET score_a=0 WHERE id=$1 RETURNING id',[paths[101].match_results])).rows.length,0);await assert.rejects(db.query('INSERT INTO rounds(event_id,round_number) VALUES($1,999)',[id(101)]),e=>e.code==='42501');});
 await test('service maintenance still sees every target table',async()=>{await context(null,'service_role');for(const t of allTables)assert((await db.query('SELECT id FROM '+t)).rows.length>1);});
 await test('rollback refuses SELECT policy drift',async()=>{await db.exec('RESET ROLE; ALTER POLICY rls11_matches_select ON matches USING(true)');await assert.rejects(run('rollback.sql'));await db.exec('ROLLBACK');await db.exec('ALTER POLICY rls11_matches_select ON matches USING('+after.policies.find(p=>p.policyname==='rls11_matches_select').qual+')');});
 await test('repeat apply refuses atomically',async()=>{await assert.rejects(run('apply.sql'));await db.exec('ROLLBACK');assert.deepEqual(await state(),after);});
 await test('rollback restores policies, effective ACL and helper without modifying rows',async()=>{const rows=await eventRows();await run('rollback.sql');assert.deepEqual(await state(),before);assert.deepEqual(await eventRows(),rows);});
 await test('rollback restores broad anonymous read',async()=>{await context(null,'anon');assert((await db.query('SELECT memo FROM events')).rows.length>1);});
 await test('reapply succeeds after removing column grants',()=>run('apply.sql'));
 fs.writeFileSync(path.join(__dirname,'test-results.json'),JSON.stringify({engine:'PGlite 0.3.14',scope:'synthetic local actual migrations and all deployed write/delete prerequisites',results},null,2)+'\n');console.log(results.length+' PASS');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(db)await db.close();});
