const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture,uid,other,pid,request}=require('./fixtures/profile-media-db.cjs');
async function setup(){const f=await fixture();await f.db.exec(`
 create table events(id uuid primary key,club_id uuid,event_mode text,created_at timestamptz,created_by_auth_user_id uuid,is_deleted boolean default false);
 create table event_participants(id uuid primary key,event_id uuid,participant_type text,player_profile_id uuid,profile_id uuid,status text);
 create table match_players(participant_id uuid);
 create table event_team_matches(event_id uuid,team_a_player1_profile_id uuid,team_a_player2_profile_id uuid,team_b_player1_profile_id uuid,team_b_player2_profile_id uuid);
 create table event_team_rounds(event_id uuid,eligible jsonb);
 create table event_team_attendance(event_id uuid,status text,member_id uuid);
 create table club_members(id uuid,player_profile_id uuid,profile_id uuid);
 create table event_team_sides(event_id uuid,club_id uuid);
 create table official_events(id uuid primary key,club_id uuid,created_at timestamptz,created_by_auth_user_id uuid,is_deleted boolean default false);
 create table official_opponents(id uuid,official_event_id uuid);
 create table official_matches(official_opponent_id uuid,our_player1_profile_id uuid,our_player2_profile_id uuid);
 grant select on all tables in schema public to authenticated;
 alter table events enable row level security;create policy visible_events on events for select to authenticated using(created_by_auth_user_id=auth.uid() or created_by_auth_user_id is null);
 `);await f.db.exec(fs.readFileSync('supabase/migrations/0049_profile_avatar_position.sql','utf8'));f.pose=async(avatar,pose,x=.6,y=.4,zoom=2)=>f.call('save_my_avatar_position',[pid,avatar,pose,x,y,zoom,await f.ticket()]);return f;}
test('位置保存は画像/R2参照・成功枠を変更せず、CAS・権限・削除/差替えの中央リセットを強制',async()=>{
 const f=await setup();try{await f.as();await f.prepare(100,0);let m=await f.commit(100);assert.equal(m.avatar_pose_version,1);
 const before=(await f.db.query('select avatar_key,avatar_version from player_profile_private')).rows[0];
 m=await f.pose(1,1);assert.equal(m.avatar_pose_version,2);assert.equal(m.avatar_zoom,2);assert.deepEqual((await f.db.query('select avatar_key,avatar_version from player_profile_private')).rows[0],before);
 await assert.rejects(f.pose(1,1),/変更されています/);await assert.rejects(f.pose(0,2),/変更されています/);
 assert.equal((await f.commit(100)).avatar_zoom,2,'画像確定の再試行は位置を消さない');
 await f.prepare(101,1);await f.pose(1,2,.4,.6,3);m=await f.commit(101);assert.equal(m.avatar_zoom,1);assert.equal(m.avatar_focus_x,.5);await assert.rejects(f.pose(1,3),/変更されています/);
 await f.prepare(102,2);m=await f.commit(102);await assert.rejects(f.prepare(103,3),/上限/);
 // 成功上限でも位置だけの保存は可能。試行制限は別途継続。
 await f.db.exec('reset role;delete from profile_media_attempts');await f.as();m=await f.pose(3,m.avatar_pose_version);assert.equal(m.avatar_zoom,2);
 await f.db.exec('reset role');assert.equal((await f.db.query("select count(*)::int n from profile_media_operations where status='committed'")).rows[0].n,3);assert.equal((await f.db.query('select count(*)::int n from profile_media_objects')).rows[0].n,3);
 await f.as(other);await assert.rejects(f.pose(3,m.avatar_pose_version),/本人/);await f.as(null,'anon');await assert.rejects(f.pose(3,m.avatar_pose_version),/permission denied/);
 await f.db.exec('reset role');await f.db.query('update player_profiles set linked_auth_user_id=$1 where id=$2',[other,pid]);await f.as(other);m=(await f.db.query('select * from player_profile_private')).rows[0];assert.equal(m.avatar_key,null);assert.equal(m.avatar_zoom,1);await assert.rejects(f.pose(m.avatar_version,m.avatar_pose_version),/変更されています/);
 }finally{await f.db.close();}
});
test('NaN/Infinity/不正座標をDBでも拒否し、失敗時は位置と成功回数が不変',async()=>{
 const f=await setup();try{await f.as();await f.prepare();const m=await f.commit(100);
 for(const [x,y,z] of [[NaN,.5,1],[Infinity,.5,1],[.5,-Infinity,1],[.5,.5,NaN],[-.1,.5,1],[.5,1.1,1],[.5,.5,4.1]])await assert.rejects(f.pose(1,m.avatar_pose_version,x,y,z),/表示設定/);
 await f.db.exec('reset role;delete from profile_media_attempts');await f.as();assert.equal((await f.db.query('select avatar_zoom from player_profile_private')).rows[0].avatar_zoom,1);await assert.rejects(f.db.exec('update player_profile_private set avatar_zoom=2'),/permission denied/);
 await f.prepare(101,1,'delete');const removed=await f.commit(101);assert.equal(removed.avatar_zoom,1);await assert.rejects(f.pose(removed.avatar_version,removed.avatar_pose_version),/変更されています/);
 }finally{await f.db.close();}
});
test('利用履歴は本人・90日・非削除・両グループを判定し、同一イベントを重複計上しない',async()=>{
 const f=await setup();try{const group=request(1001),second=request(1002),event=request(2001),absent=request(2011);
 await f.db.query("insert into events values($1,$2,'team',now(),$3,false)",[event,group,uid]);
 await f.db.query('insert into event_team_sides values($1,$2),($1,$2),($1,$3)',[event,group,second]);
 await f.db.query("insert into event_participants values($1,$2,'member',$3,$4,'active')",[request(3001),event,pid,uid]);
 await f.db.query("insert into events values($1,$2,'auto',now(),null,false)",[absent,group]);await f.db.query("insert into event_participants values($1,$2,'member',$3,$4,'absent')",[request(3002),absent,pid,uid]);
 await f.db.query("insert into events values($1,$2,'auto',now()-interval '91 days',$3,false),($4,$2,'auto',now(),$3,true),($5,$2,'auto',now(),$6,false)",[request(2002),group,uid,request(2003),request(2004),other]);
 await f.db.query("insert into official_events values($1,$2,now(),$3,false)",[event,group,uid]);await f.as();let rows=(await f.db.query('select * from get_my_profile_group_usage() order by club_id')).rows;assert.equal(Number(rows.find(r=>r.club_id===group).event_count),2);assert.equal(Number(rows.find(r=>r.club_id===second).event_count),1);
 await f.db.exec('reset role');await f.db.query('insert into match_players values($1)',[request(3002)]);await f.as();rows=(await f.db.query('select * from get_my_profile_group_usage()')).rows;assert.equal(Number(rows.find(r=>r.club_id===group).event_count),3);
 await f.as(other);rows=(await f.db.query('select * from get_my_profile_group_usage()')).rows;assert.equal(Number(rows[0].event_count),1);await f.as(null,'anon');await assert.rejects(f.call('get_my_profile_group_usage'),/permission denied/);
 }finally{await f.db.close();}
});
test('0049事後検証・専用プロフィール試験は全書込みをROLLBACKし既存データを維持',async()=>{
 const f=await setup();try{await f.db.exec(fs.readFileSync('supabase/maintenance/profile-avatar-position/02_verify.sql','utf8'));await f.db.exec("alter table player_profiles add column display_name text not null default 'synthetic'");const before=(await f.db.query('select * from player_profiles order by id')).rows;await f.db.exec(fs.readFileSync('supabase/maintenance/profile-avatar-position/03_smoke.sql','utf8'));assert.deepEqual((await f.db.query('select * from player_profiles order by id')).rows,before);assert.equal((await f.db.query('select count(*)::int n from profile_media_operations')).rows[0].n,0);}finally{await f.db.close();}
});
