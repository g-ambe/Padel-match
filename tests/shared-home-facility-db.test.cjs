const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture,uid,other,pid,request}=require('./fixtures/profile-media-db.cjs');
const fid=request(500),closed=request(501);
async function setup(){
 const f=await fixture();
 await f.db.exec(fs.readFileSync('supabase/migrations/0050_private_profile_home_court.sql','utf8'));
 await f.db.exec(`create table padel_facilities(id uuid primary key,name text not null unique,prefecture text,address text,source_url text,created_at timestamptz default now());create table clubs(id uuid primary key,main_facility_id uuid references padel_facilities(id));`);
 await f.db.exec(fs.readFileSync('supabase/migrations/0017_padel_facilities_rls.sql','utf8'));
 await f.db.query('insert into padel_facilities(id,name,prefecture) values($1,$2,$3),($4,$5,$6)',[fid,'元の施設','東京',closed,'閉業施設','大阪']);
 await f.db.query('insert into clubs values($1,$2)',[request(600),fid]);
 await f.as();await f.call('save_my_home_court',[pid,0,'既存の自由入力',await f.ticket()]);
 await f.db.exec('reset role');
 f.before={clubs:(await f.db.query('select * from clubs')).rows,facilities:(await f.db.query('select id,name,prefecture from padel_facilities order by id')).rows,profile:(await f.db.query('select * from player_profile_private')).rows};
 await f.db.exec(fs.readFileSync('supabase/migrations/0051_shared_home_facility.sql','utf8'));
 f.select=async(version,id,name='')=>f.call('save_my_home_court_selection',[pid,version,id,name,await f.ticket()]);
 return f;
}
test('0051は既存施設ID/クラブ参照/自由入力を変更せず、施設ID・改称・自由入力・解除とCASを維持',async()=>{
 const f=await setup();try{
 assert.deepEqual((await f.db.query('select * from clubs')).rows,f.before.clubs);
 assert.deepEqual((await f.db.query('select id,name,prefecture from padel_facilities order by id')).rows,f.before.facilities);
 const after=(await f.db.query('select * from player_profile_private')).rows[0];for(const [key,v] of Object.entries(f.before.profile[0]))assert.deepEqual(after[key],v);assert.equal(after.home_facility_id,null);
 await f.as();let m=await f.select(1,fid,'偽の施設名');assert.equal(m.home_facility_id,fid);assert.equal(m.home_court_name,'元の施設');assert.equal(m.home_facility.name,'元の施設');
 await assert.rejects(f.select(1,null,'競合'),/変更されています/);
 await f.db.exec('reset role');await f.db.query('update padel_facilities set name=$1 where id=$2',['改称した施設',fid]);
 assert.equal((await f.db.query('select main_facility_id from clubs')).rows[0].main_facility_id,fid);
 await assert.rejects(f.db.query('delete from padel_facilities where id=$1',[fid]),/foreign key/);
 await f.as();m=await f.select(2,fid);assert.equal(m.home_court_name,'改称した施設');assert.equal(m.home_facility.id,fid);
 m=await f.select(3,null,'  未掲載のコート  ');assert.equal(m.home_court_name,'未掲載のコート');assert.equal(m.home_facility_id,null);assert.equal(m.home_facility,null);
 m=await f.select(4,null);assert.equal(m.home_court_name,null);assert.equal(m.home_facility_id,null);
 await f.db.exec('reset role');assert.equal((await f.db.query('select count(*)::int n from padel_facilities')).rows[0].n,2);
 assert.equal((await f.db.query('select count(*)::int n from profile_media_operations')).rows[0].n,0);
 }finally{await f.db.close();}
});
test('本人/匿名/直接更新/複数連携/不明・閉業施設を拒否し、旧クライアントと連携変更はIDを解除',async()=>{
 const f=await setup();try{
 await f.db.query("update padel_facilities set availability='closed' where id=$1",[closed]);
 await f.as();await assert.rejects(f.select(1,closed),/選択できません/);await assert.rejects(f.select(1,request(999)),/選択できません/);
 await assert.rejects(f.select(1,null,'x\ny'),/80文字/);await assert.rejects(f.db.query('update player_profile_private set home_facility_id=$1',[fid]),/permission denied/);
 await assert.rejects(f.db.query("update padel_facilities set name='bad' where id=$1",[fid]),/permission denied/);
 await f.as(other);assert.equal((await f.db.query('select * from player_profile_private')).rows.length,0);await assert.rejects(f.select(1,fid),/本人/);
 await f.as(null,'anon');await assert.rejects(f.call('save_my_home_court_selection',[pid,1,fid,'',request(999)]),/permission denied/);assert.equal((await f.db.query('select * from padel_facilities')).rows.length,2);
 await f.db.exec('reset role');await f.db.query('insert into player_profiles values($1,$2,true)',[request(12),uid]);await f.as();await assert.rejects(f.select(1,fid),/一意/);
 await f.db.exec('reset role');await f.db.query('delete from player_profiles where id=$1',[request(12)]);await f.as();await f.select(1,fid);
 let m=await f.call('save_my_home_court',[pid,2,'旧クライアントの自由入力',await f.ticket()]);assert.equal(m.home_facility_id,null);
 await f.select(3,fid);await f.db.exec('reset role');await f.db.query('update player_profiles set linked_auth_user_id=$1 where id=$2',[other,pid]);await f.as(other);
 m=(await f.db.query('select * from player_profile_private')).rows[0];assert.equal(m.home_facility_id,null);assert.equal(m.home_court_name,null);assert.equal(m.home_court_version,5);
 }finally{await f.db.close();}
});
test('0051でも0050権限検証が通り、同じ施設IDにもCAS/10分10回の試行制限を強制',async()=>{
 const f=await setup();try{
 await f.db.exec(fs.readFileSync('supabase/maintenance/profile-home-court/02_verify.sql','utf8'));
 await f.db.exec(fs.readFileSync('supabase/maintenance/shared-home-facility/02_verify.sql','utf8'));
 await f.as();await f.select(1,fid);
 await assert.rejects(f.select(1,fid),/変更されています/);
 // setup時に1回、成功1回、競合1回。失敗を含む残り7回の試行を使う。
 for(let i=0;i<7;i++)await f.ticket();assert.equal(await f.ticket(),null);await assert.rejects(f.select(2,fid),/時間をおいて/);
 }finally{await f.db.close();}
});
