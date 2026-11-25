const {test}=require('node:test'),assert=require('node:assert/strict');
const {homeFixture,candidate,fingerprint,uid,other,pid,request}=require('./fixtures/lineup-home-court-candidates.cjs');
const profile=async f=>{await f.db.exec('reset role');return (await f.db.query('select to_jsonb(t) value from player_profile_private t')).rows[0].value;};
test('02候補：新旧RPCの自由入力拒否・マスター選択/解除・認可/CAS/試行制限と既存値保全',async t=>{
 const f=await homeFixture();
 try{
  await t.test('候補適用は既存名・参照施設・ACL/RLS/他関数を変更しない',async()=>{
   const p=await profile(f);assert.equal(p.home_court_name,'既存の自由入力');assert.equal(p.home_court_version,1);assert.equal(p.home_facility_id,null);assert.equal((await f.db.query('select main_facility_id from clubs')).rows[0].main_facility_id,f.fid);assert.equal((await f.db.query('select count(*)::int n from padel_facilities')).rows[0].n,2);
  });
  await t.test('旧新RPC直接自由入力を22023拒否・既存値維持',async()=>{
   const before=await profile(f);await f.as();
   for(const name of [' 新規名称 ','x\ny','a'.repeat(81)]){await assert.rejects(f.legacy(1,name),e=>e.code==='22023');await assert.rejects(f.select(1,null,name),e=>e.code==='22023');}
   assert.deepEqual(await profile(f),before);
  });
  await t.test('施設IDは偽名を無視してマスター名を保存、CAS・閉業・不明ID拒否',async()=>{
   await f.db.exec('delete from profile_media_attempts');await f.as();let p=await f.select(1,f.fid,'偽名');assert.equal(p.home_court_name,'正規施設名');assert.equal(p.home_facility.id,f.fid);assert.equal(p.home_court_version,2);
   await assert.rejects(f.select(1,f.fid),e=>e.code==='40001');await assert.rejects(f.select(2,f.closed),e=>e.code==='22023');await assert.rejects(f.select(2,request(999)),e=>e.code==='22023');
   await f.db.exec('reset role');await f.db.query("update padel_facilities set name='改称後の施設' where id=$1",[f.fid]);await f.as();p=await f.select(2,f.fid);assert.equal(p.home_court_name,'改称後の施設');assert.equal(p.home_facility_id,f.fid);
  });
  await t.test('旧空文字/NULLと新未設定による明示解除',async()=>{
   await f.db.exec('reset role;delete from profile_media_attempts');await f.as();let p=await f.legacy(3,'  ');assert.equal(p.home_court_name,null);assert.equal(p.home_facility_id,null);p=await f.select(4,f.fid);p=await f.legacy(5,null);assert.equal(p.home_court_name,null);p=await f.select(6,f.fid);p=await f.select(7,null);assert.equal(p.home_court_name,null);assert.equal(p.home_facility_id,null);assert.equal(p.home_court_version,8);
  });
  await t.test('他人/匿名/複数連携/直接UPDATEと無効ticketを拒否',async()=>{
   const before=await profile(f);await f.as(other);await assert.rejects(f.select(8,f.fid),/本人/);await assert.rejects(f.legacy(8,''),/本人/);
   await f.as(null,'anon');for(const [name,args]of [['save_my_home_court',[pid,8,'',request(999)]],['save_my_home_court_selection',[pid,8,f.fid,'',request(999)]]])await assert.rejects(f.call(name,args),/permission denied/);
   await f.as();await assert.rejects(f.db.query('update player_profile_private set home_court_name=$1 where profile_id=$2',['bad',pid]),/permission denied/);await assert.rejects(f.call('save_my_home_court_selection',[pid,8,f.fid,'',request(999)]),/時間をおいて/);
   await f.db.exec('reset role');await f.db.query('insert into player_profiles values($1,$2,true)',[request(12),uid]);await f.as();await assert.rejects(f.select(8,f.fid),/一意/);await f.db.exec('reset role');await f.db.query('delete from player_profiles where id=$1',[request(12)]);assert.deepEqual(await profile(f),before);
  });
  await t.test('画像成功枠やInstagramはホームコートを変えず、ホームコートも画像枠を消費しない',async()=>{
   await f.db.exec('reset role;delete from profile_media_attempts');await f.as();await f.select(8,f.fid);const before=await profile(f);
   await f.as();await f.call('save_my_instagram',[pid,0,'sample_player',await f.ticket()]);await f.prepare(101,0);await f.commit(101);let p=await profile(f);assert.equal(p.home_facility_id,before.home_facility_id);assert.equal(p.home_court_name,before.home_court_name);assert.equal(p.home_court_version,before.home_court_version);
   await f.as();await f.select(9,null);p=await profile(f);assert.equal(p.instagram_username,'sample_player');assert.equal(p.avatar_version,1);assert.equal((await f.db.query("select count(*)::int n from profile_media_operations where status='committed'")).rows[0].n,1);
  });
  await t.test('ticket再利用/10分10回と途中例外のrollback',async()=>{
   await f.db.exec('reset role;delete from profile_media_attempts');await f.as();const ticket=await f.ticket();await f.call('save_my_home_court_selection',[pid,10,f.fid,'',ticket]);await assert.rejects(f.call('save_my_home_court_selection',[pid,11,null,'',ticket]),/時間をおいて/);
   const before=await profile(f);await f.db.exec("create function public.home_candidate_fail() returns trigger language plpgsql as $$begin raise exception '注入失敗';end$$;create trigger home_candidate_fail before update on player_profile_private for each row execute function public.home_candidate_fail()");await f.as();await assert.rejects(f.select(11,null),/注入失敗/);assert.deepEqual(await profile(f),before);await f.db.exec('drop trigger home_candidate_fail on player_profile_private;drop function public.home_candidate_fail()');
   await f.as();for(let i=0;i<8;i++)await f.ticket();assert.equal(await f.ticket(),null);await assert.rejects(f.select(11,null),/時間をおいて/);
  });
 }finally{await f.db.close();}
});
