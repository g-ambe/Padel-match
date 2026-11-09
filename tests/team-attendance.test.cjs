const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {fixedPairDatabase,id}=require('./fixtures/fixed-pair-db.cjs');
test('退会後に閲覧権限を失った作成者は出欠RPCも更新できない',async()=>{
 const {db,as,event,rpc}=await fixedPairDatabase(false);
 try{
  await db.exec(fs.readFileSync('supabase/migrations/0044_friendly_team_attendance.sql','utf8'));
  const a=await event(951,0,{mode:'team'});
  await db.query('update events set created_by_auth_user_id=$1 where id=$2',[id(3),a.eid]);
  await db.query("insert into event_team_sides(event_id,side,club_id,team_name) values($1,'team_a',$2,'相手側')",[a.eid,id(601)]);
  const cm=(await db.query('select id from club_members where player_profile_id=$1',[id(104)])).rows[0].id;
  await db.query('update club_members set is_active=false where player_profile_id=$1',[id(103)]);
  await as(3);
  assert.equal((await db.query('select id from events where id=$1',[a.eid])).rows.length,0);
  await assert.rejects(()=>rpc('set_friendly_team_attendance',[a.eid,'team_a',cm,null,'absent']),/権限/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from event_team_attendance')).rows[0].n,0);
 }finally{await db.close();}
});
test('チーム戦の出欠は所属IDで保持し、欠席・未完了カード・権限・過去スコアをDBで保護する',async()=>{
 const {db,as,event,rpc}=await fixedPairDatabase(false);
 try{
 await db.exec(fs.readFileSync('supabase/migrations/0044_friendly_team_attendance.sql','utf8'));
 await db.exec('select profile_link_private.check_reference_schema()'); // プロフィール統合の許可済みFK一覧を壊さない。
 const a=await event(950,0,{mode:'team'});
 await db.query("insert into event_team_sides(event_id,side,club_id,team_name) values($1,'team_a',$2,'A'),($1,'team_b',$3,'B')",[a.eid,id(600),id(601)]);
 const cm=(await db.query('select id from club_members where player_profile_id=$1',[id(103)])).rows[0].id;
 const set=async(status,side='team_a')=>rpc('set_friendly_team_attendance',[a.eid,side,cm,null,status]);
 await as(3);await assert.rejects(()=>set('absent'),/権限/);
 await as(1);await assert.rejects(()=>set('absent','team_b'),/メンバー/);
 await assert.rejects(()=>db.query("update event_team_sides set club_id=$1 where event_id=$2 and side='team_a'",[id(601),a.eid]),/所属グループ/);
 await db.query("update event_team_sides set team_name='名前変更' where event_id=$1 and side='team_a'",[a.eid]);
 await set('absent');
 await assert.rejects(()=>db.query("insert into event_team_matches(event_id,match_order,team_a_player1_profile_id) values($1,1,$2)",[a.eid,id(103)]),/欠席者/);
 await assert.rejects(()=>db.exec("update event_team_attendance set status='active'"),/permission denied/);
 await set('active');
 const card=(await db.query("insert into event_team_matches(event_id,match_order,team_a_player1_profile_id) values($1,1,$2) returning id",[a.eid,id(103)])).rows[0].id;
 await assert.rejects(()=>set('absent'),/未完了カード/);
 assert.equal((await db.query('select status from event_team_attendance')).rows[0].status,'active');
 await db.query("update event_team_matches set team_a_score=0,team_b_score=0,result='draw' where id=$1",[card]);
 await set('absent');await set('absent'); // 同じ操作でも1行
 assert.equal((await db.query('select count(*)::int n from event_team_attendance')).rows[0].n,1);
 await db.query("update event_team_matches set team_a_score=4,team_b_score=2,result='win',youtube_url='https://youtu.be/abcdefghijk' where id=$1",[card]);
 assert.equal((await db.query('select team_a_score from event_team_matches where id=$1',[card])).rows[0].team_a_score,4);
 await as(null,'anon');await assert.rejects(()=>set('active'),/permission denied/);
 await db.exec('reset role');
 await db.query("insert into event_team_guests(id,event_id,side,guest_name) values($1,$2,'team_b','同名ゲスト'),($3,$2,'team_a','同名ゲスト')",[id(970),a.eid,id(971)]);
 await as(1);await rpc('set_friendly_team_attendance',[a.eid,'team_b',null,id(970),'absent']);
 await assert.rejects(()=>rpc('set_friendly_team_attendance',[a.eid,'team_a',null,id(970),'active']),/ゲスト/);
 await assert.rejects(()=>db.query("insert into event_team_matches(event_id,match_order,team_b_player1_guest_name) values($1,2,'同名ゲスト')",[a.eid]),/欠席者/);
 await db.query("insert into event_team_matches(event_id,match_order,team_a_player1_guest_name) values($1,2,'同名ゲスト')",[a.eid]);
 await rpc('set_friendly_team_attendance',[a.eid,'team_b',null,id(970),'active']);
 await db.query("insert into event_team_matches(event_id,match_order,team_b_player1_guest_name) values($1,3,'同名ゲスト')",[a.eid]);
 await set('active');await db.query("update events set status='closed' where id=$1",[a.eid]);await assert.rejects(()=>set('absent'),/権限/);
 await db.exec('reset role');
 assert.equal((await db.query("select count(*)::int n from pg_policies where tablename='event_team_attendance' and cmd in ('INSERT','UPDATE','ALL')")).rows[0].n,0);
 }finally{await db.close();}
});
