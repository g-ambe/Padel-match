const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture,uid,other,pid,request,proof}=require('./fixtures/profile-media-db.cjs');
const club=request(30),otherClub=request(31),viewer=request(12),targetMember=request(40),viewerMember=request(41);
const sql=fs.readFileSync('supabase/maintenance/group-member-avatars/02_group_member_avatar_CANDIDATE.sql','utf8');
async function setup(){
 const f=await fixture();
 await f.db.exec(`create role service_role;create schema group_read_private;revoke all on schema group_read_private from public,anon,authenticated;
 create table clubs(id uuid primary key,is_active boolean,is_deleted boolean,visibility text);
 create table club_members(id uuid primary key,club_id uuid,player_profile_id uuid,profile_id uuid,is_active boolean,role text);`);
 await f.db.exec(`
 create table events(id uuid primary key,club_id uuid,event_mode text,created_at timestamptz,created_by_auth_user_id uuid,is_deleted boolean default false);
 create table event_participants(id uuid primary key,event_id uuid,participant_type text,player_profile_id uuid,profile_id uuid,status text);
 create table match_players(participant_id uuid);
 create table event_team_matches(event_id uuid,team_a_player1_profile_id uuid,team_a_player2_profile_id uuid,team_b_player1_profile_id uuid,team_b_player2_profile_id uuid);
 create table event_team_rounds(event_id uuid,eligible jsonb);
 create table event_team_attendance(event_id uuid,status text,member_id uuid);
 create table event_team_sides(event_id uuid,club_id uuid);
 create table official_events(id uuid primary key,club_id uuid,created_at timestamptz,created_by_auth_user_id uuid,is_deleted boolean default false);
 create table official_opponents(id uuid,official_event_id uuid);
 create table official_matches(official_opponent_id uuid,our_player1_profile_id uuid,our_player2_profile_id uuid);
 `);await f.db.exec(fs.readFileSync('supabase/migrations/0049_profile_avatar_position.sql','utf8'));
 const source=fs.readFileSync('supabase/migrations/0054_group_read_interfaces.sql','utf8');
 await f.db.exec(source.slice(source.indexOf('CREATE FUNCTION group_read_private.member('),source.indexOf('CREATE FUNCTION group_read_private.require_member(')));
 await f.db.exec('revoke all on function group_read_private.member(uuid) from public,anon,authenticated');
 await f.db.query('insert into player_profiles values($1,$2,true)',[viewer,other]);
 await f.db.query("insert into clubs values($1,true,false,'private'),($2,true,false,'public')",[club,otherClub]);
 await f.db.query("insert into club_members values($1,$2,$3,$4,true,'member'),($5,$2,$6,$7,true,'member')",[targetMember,club,pid,uid,viewerMember,viewer,other]);
 await f.as();await f.prepare();await f.commit(100);await f.db.exec('reset role');
 await f.db.exec(sql);
 f.image=async(actor=other,c=club,m=targetMember,p=proof,role='authenticated')=>{await f.as(actor,role);return(await f.db.query('select * from get_group_member_avatar_for_worker($1,$2,$3)',[c,m,p])).rows};
 return f;
}
test('同一グループの一般/管理者のみ、private/public共通、proofなし直呼び・匿名・他グループは拒否',async()=>{
 const f=await setup();try{
 for(const visibility of ['private','public'])for(const role of ['member','main_admin','sub_admin']){
  await f.db.exec('reset role');await f.db.query('update clubs set visibility=$1 where id=$2',[visibility,club]);await f.db.query('update club_members set role=$1 where id=$2',[role,viewerMember]);
  const rows=await f.image();assert.equal(rows.length,1);assert.equal(rows[0].avatar_key,`profiles/${pid}/${request(100)}.webp`);
  assert.deepEqual(Object.keys(rows[0]).sort(),['profile_id','avatar_key','avatar_version','avatar_focus_x','avatar_focus_y','avatar_zoom','avatar_pose_version'].sort());
 }
 for(const actor of [request(3),request(4)])assert.deepEqual(await f.image(actor),[]); // No admin/super exception in the actual member helper.
 assert.deepEqual(await f.image(other,otherClub),[]);assert.deepEqual(await f.image(other,club,request(999)),[]);
 for(const p of [null,'invalid'])await assert.rejects(f.image(other,club,targetMember,p),e=>e.code==='42501');
 await assert.rejects(f.image(null,club,targetMember,proof,'anon'),/permission denied/);
 await assert.rejects(f.image(other,club,targetMember,proof,'service_role'),/permission denied/);
 await f.as(other);await assert.rejects(f.db.query('select * from profile_media_objects'),/permission denied/);assert.deepEqual((await f.db.query('select * from player_profile_private')).rows,[]);
 }finally{await f.db.close()}
});
test('閲覧者/対象の退会・除名、未連携/無効化/owner不一致・object失効を同じ0行で拒否',async()=>{
 const f=await setup();try{
 for(const change of [
  `update club_members set is_active=false where id='${viewerMember}'`,
  `update club_members set is_active=false where id='${targetMember}'`,
  `update player_profiles set is_active=false where id='${viewer}'`,
  `update player_profiles set is_active=false where id='${pid}'`,
  `update player_profiles set linked_auth_user_id=null where id='${pid}'`,
  `update player_profile_private set owner_id='${request(900)}' where profile_id='${pid}'`,
  `update profile_media_objects set state='garbage' where profile_id='${pid}'`,
  `update clubs set is_deleted=true where id='${club}'`,
 ]){await f.db.exec('reset role;begin');await f.db.exec(change);assert.deepEqual(await f.image(),[]);await f.db.exec('reset role;rollback')}
 }finally{await f.db.close()}
});
test('既存画像RPCによる差替え・削除・位置変更を次の読取に反映し、閲覧は変更枠を消費しない',async()=>{
 const f=await setup();try{
 const first=(await f.image())[0];await f.as();await f.call('save_my_avatar_position',[pid,first.avatar_version,first.avatar_pose_version,.3,.7,2,await f.ticket()]);
 const positioned=(await f.image())[0];assert.equal(positioned.avatar_focus_x,.3);assert.equal(positioned.avatar_zoom,2);assert.equal(positioned.avatar_key,first.avatar_key);
 await f.as();await f.prepare(101,1);await f.commit(101);const next=(await f.image())[0];assert.notEqual(next.avatar_key,first.avatar_key);assert.equal(next.avatar_version,2);
 await f.as();await f.prepare(102,2,'delete');await f.commit(102);assert.deepEqual(await f.image(),[]);
 await f.db.exec('reset role');assert.equal((await f.db.query("select count(*)::int n from profile_media_operations where status='committed'")).rows[0].n,3);
 const fn=(await f.db.query("select pg_get_userbyid(proowner) owner,proconfig,prosecdef from pg_proc where oid='get_group_member_avatar_for_worker(uuid,uuid,text)'::regprocedure")).rows[0];assert.equal(fn.owner,'postgres');assert(fn.prosecdef);assert(fn.proconfig.includes('search_path=""'));
 assert.equal((await f.db.query("select has_schema_privilege('authenticated','group_read_private','USAGE') yes")).rows[0].yes,false);
 }finally{await f.db.close()}
});
