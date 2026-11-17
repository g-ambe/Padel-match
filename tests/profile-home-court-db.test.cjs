const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture,uid,other,pid,request}=require('./fixtures/profile-media-db.cjs');
async function setup(){const f=await fixture();await f.db.exec(fs.readFileSync('supabase/migrations/0050_private_profile_home_court.sql','utf8'));f.court=async(version,name)=>f.call('save_my_home_court',[pid,version,name,await f.ticket()]);return f;}
test('本人のホームコート登録/変更/削除・CAS・不正値拒否と他項目/画像枠不変',async()=>{
 const f=await setup();try{await f.as();let m=await f.court(0,'  テストコート  ');assert.equal(m.home_court_name,'テストコート');assert.equal(m.home_court_version,1);assert.equal(m.avatar_version,0);assert.equal(m.instagram_version,0);
 await assert.rejects(f.court(0,'競合'),/変更されています/);await assert.rejects(f.court(1,'あ'.repeat(81)),/80文字/);await assert.rejects(f.court(1,'x\ny'),/80文字/);m=await f.court(1,'別のコート');assert.equal(m.home_court_version,2);m=await f.court(2,'');assert.equal(m.home_court_name,null);
 await f.db.exec('reset role');assert.equal((await f.db.query('select count(*)::int n from profile_media_operations')).rows[0].n,0);assert.equal((await f.db.query('select count(*)::int n from profile_media_objects')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('画像成功上限到達後もホームコートを保存でき、写真/Instagramの更新はホームコートを保持',async()=>{
 const f=await setup();try{await f.as();for(let i=0;i<3;i++){await f.prepare(100+i,i);await f.commit(100+i);}await assert.rejects(f.prepare(104,3),/上限/);let m=await f.court(0,'コート');assert.equal(m.avatar_version,3);await f.call('save_my_instagram',[pid,0,'player',await f.ticket()]);assert.equal((await f.db.query('select home_court_name from player_profile_private')).rows[0].home_court_name,'コート');
 await f.db.exec('reset role');assert.equal((await f.db.query("select count(*)::int n from profile_media_operations where status='committed'")).rows[0].n,3);
 }finally{await f.db.close();}
});
test('他人・匿名・直接UPDATE・複数有効プロフィールを拒否、連携変更時に旧ホームコートを渡さない',async()=>{
 const f=await setup();try{await f.as();await f.court(0,'本人コート');await assert.rejects(f.db.exec("update player_profile_private set home_court_name='bad'"),/permission denied/);
 await f.as(other);assert.equal((await f.db.query('select * from player_profile_private')).rows.length,0);await assert.rejects(f.court(1,'bad'),/本人/);await f.as(null,'anon');await assert.rejects(f.court(1,'bad'),/permission denied/);
 await f.db.exec('reset role');await f.db.query('insert into player_profiles values($1,$2,true)',[request(12),uid]);await f.as();await assert.rejects(f.court(1,'bad'),/一意/);await f.db.exec('reset role');await f.db.query('delete from player_profiles where id=$1',[request(12)]);await f.db.query('update player_profiles set linked_auth_user_id=$1 where id=$2',[other,pid]);await f.as(other);const m=(await f.db.query('select * from player_profile_private')).rows[0];assert.equal(m.home_court_name,null);assert.equal(m.home_court_version,2);await f.court(2,'新しい本人のコート');
 }finally{await f.db.close();}
});
test('0050検証SQL・専用プロフィールの保存試験は全書込みをROLLBACKする',async()=>{
 const f=await setup();try{await f.db.exec(fs.readFileSync('supabase/maintenance/profile-home-court/02_verify.sql','utf8'));await f.db.exec("alter table player_profiles add column display_name text not null default 'synthetic'");const before=(await f.db.query('select * from player_profiles order by id')).rows;await f.db.exec(fs.readFileSync('supabase/maintenance/profile-home-court/03_smoke.sql','utf8'));assert.deepEqual((await f.db.query('select * from player_profiles order by id')).rows,before);}finally{await f.db.close();}
});
