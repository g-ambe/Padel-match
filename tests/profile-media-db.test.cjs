const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const uid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',pid='00000000-0000-4000-8000-000000000011';
const request=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,proof='a'.repeat(64);
async function fixture(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to public;create table player_profiles(id uuid primary key,linked_auth_user_id uuid,is_active boolean not null default true);grant select on player_profiles to authenticated,anon;`);
 await db.query('insert into player_profiles values($1,$2,true)',[pid,uid]);await db.exec(fs.readFileSync('supabase/migrations/0048_private_profile_media.sql','utf8'));
 await db.query("insert into profile_media_private.settings values(true,sha256(convert_to($1,'UTF8')))",[proof]);
 await db.exec(fs.readFileSync('supabase/maintenance/profile-media/02_verify.sql','utf8'));
 const as=async(actor=uid,role='authenticated')=>{await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor??'']);};
 const call=async(name,args=[])=>{const row=(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0];return row?.value;};
 const ticket=()=>call('profile_media_attempt');
 const prepare=async(n=100,version=0,kind='upload')=>call('prepare_profile_image',[pid,request(n),version,kind,await ticket(),kind==='upload'?'0'.repeat(64):null]);
 const commit=n=>call('commit_profile_image',[pid,request(n),proof]);
 return {db,as,call,ticket,prepare,commit};
}
test('本人専用RLS・Instagramの正規化/変更/削除・URL拒否・競合・複数連携制約',async()=>{
 const f=await fixture();try{await f.as();let m=await f.call('save_my_instagram',[pid,0,' @player.name ',await f.ticket()]);assert.equal(m.instagram_username,'player.name');
 await assert.rejects(f.call('save_my_instagram',[pid,0,'other',await f.ticket()]),/変更されています/);
 for(const value of ['https://instagram.com/test','javascript:bad','a..b','.bad','bad.','a'.repeat(31)])await assert.rejects(f.call('save_my_instagram',[pid,1,value,await f.ticket()]),/形式/);
 m=await f.call('save_my_instagram',[pid,1,'',await f.ticket()]);assert.equal(m.instagram_username,null);
 await f.as(other);assert.equal((await f.db.query('select * from player_profile_private')).rows.length,0);await assert.rejects(f.prepare(),/本人/);
 await f.as(null,'anon');await assert.rejects(f.call('profile_media_attempt'),/permission denied/);await assert.rejects(f.db.query('select * from player_profile_private'),/permission denied/);
 await f.as();await assert.rejects(f.db.query("update player_profile_private set avatar_key='fake'"),/permission denied/);
 await f.db.exec('reset role');await f.db.query('insert into player_profiles values($1,$2,true)',[request(12),uid]);await f.as();await assert.rejects(f.prepare(),/一意/);
 }finally{await f.db.close();}
});
test('画像差替えはCASで確定・二重実行無害・秘密値のないDB直呼び拒否・旧参照とGCを保護',async()=>{
 const f=await fixture();try{await f.as();const first=await f.prepare();assert.equal(first.operation.status,'pending');
 await assert.rejects(f.call('commit_profile_image',[pid,request(100),'x'.repeat(64)]),/設定/);
 const m=await f.commit(100);assert.equal(m.avatar_version,1);assert.equal((await f.commit(100)).avatar_version,1);
 await assert.rejects(f.call('prepare_profile_image',[pid,request(100),0,'upload',await f.ticket(),'1'.repeat(64)]),/一致/);
 assert.equal(await f.call('claim_profile_media_gc',[m.avatar_key,proof]),false);
 await f.prepare(101,1);await assert.rejects(f.prepare(102,1),/変更中/);await f.call('abort_profile_image',[pid,request(101),proof]);
 assert.equal((await f.db.query('select avatar_key from player_profile_private')).rows[0].avatar_key,m.avatar_key);
 await f.prepare(103,1);const next=await f.commit(103);assert.notEqual(next.avatar_key,m.avatar_key);
 assert.equal(await f.call('claim_profile_media_gc',[next.avatar_key,proof]),false);assert.equal(await f.call('claim_profile_media_gc',[m.avatar_key,proof]),true);
 await f.call('finish_profile_media_gc',[m.avatar_key,proof]);await assert.rejects(f.prepare(104,0),/変更されています/);
 }finally{await f.db.close();}
});
test('失敗は成功枠を消費せず、24h/30日・アカウント全体の制限と試行10回を強制',async()=>{
 const f=await fixture();try{await f.as();for(let i=0;i<3;i++){await f.prepare(200+i,i);await f.commit(200+i);}await assert.rejects(f.prepare(204,3),/上限/);
 // 別プロフィールへの正規連携変更でも、認証アカウントの成功回数はリセットされない。
 await f.db.exec('reset role');await f.db.query('update player_profiles set is_active=false where id=$1',[pid]);await f.db.query('insert into player_profiles values($1,$2,true)',[request(12),uid]);await f.as();await assert.rejects(f.call('prepare_profile_image',[request(12),request(300),0,'upload',await f.ticket(),'0'.repeat(64)]),/上限/);
 // 直近30日内の10成功も拒否。24hの条件とは分けて確認。
 await f.db.exec('reset role');await f.db.exec("update profile_media_operations set committed_at=clock_timestamp()-interval '2 days' where status='committed'");
 for(let n=0;n<7;n++)await f.db.query("insert into profile_media_operations(request_id,actor_id,profile_id,kind,status,expected_version,committed_at)values($1,$2,$3,'delete','committed',0,clock_timestamp()-interval '2 days')",[request(400+n),uid,request(12)]);
 await f.as();await assert.rejects(f.call('prepare_profile_image',[request(12),request(500),0,'upload',await f.ticket(),'0'.repeat(64)]),/上限/);
 for(let n=0;n<4;n++)await f.ticket();assert.equal(await f.ticket(),null);
 }finally{await f.db.close();}
});
test('連携解除・所有者変更は非公開情報を引き渡さず、既存の選手IDを変更しない',async()=>{
 const f=await fixture();try{await f.as();await f.call('save_my_instagram',[pid,0,'owner_one',await f.ticket()]);await f.prepare();const first=await f.commit(100);
 await f.db.exec('reset role');await f.db.query('update player_profiles set linked_auth_user_id=$1 where id=$2',[other,pid]);await f.as(other);const row=(await f.db.query('select * from player_profile_private')).rows[0];assert.equal(row.instagram_username,null);assert.equal(row.avatar_key,null);assert.equal(row.profile_id,pid);assert.equal(await f.call('claim_profile_media_gc',[first.avatar_key,proof]),false,'解除後の猶予期間中は回収不可');
 await f.as(uid);assert.equal((await f.db.query('select * from player_profile_private')).rows.length,0);
 }finally{await f.db.close();}
});

test('削除はDB参照の確定後だけ回収可能になり、未登録の削除・再実行は成功回数を増やさない',async()=>{
 const f=await fixture();try{await f.as();const empty=await f.prepare(700,0,'delete');assert.equal(empty.operation.status,'unchanged');
 await f.prepare(701,0);const before=await f.commit(701);await f.prepare(702,1,'delete');const removed=await f.commit(702);assert.equal(removed.avatar_key,null);assert.equal(removed.avatar_version,2);assert.equal((await f.commit(702)).avatar_version,2);
 assert.equal(await f.call('claim_profile_media_gc',[before.avatar_key,proof]),true);await f.db.exec('reset role');assert.equal(Number((await f.db.query("select count(*) n from profile_media_operations where status='committed'")).rows[0].n),2);
 }finally{await f.db.close();}
});

test('プロフィール復帰後に本人用項目を再登録でき、削除時の未参照画像も猶予付きGCへ移す',async()=>{
 const f=await fixture();try{await f.as();await f.prepare(800,0);await f.commit(800);await f.db.exec('reset role');await f.db.query('update player_profiles set is_active=false where id=$1',[pid]);await f.db.query('update player_profiles set is_active=true where id=$1',[pid]);await f.as();const revived=(await f.db.query('select * from player_profile_private')).rows[0];assert.equal(revived.owner_id,uid);await f.prepare(801,Number(revived.avatar_version));await f.commit(801);
 await f.db.exec('reset role');await f.db.query('delete from player_profiles where id=$1',[pid]);assert.equal((await f.db.query('select * from player_profile_private')).rows.length,0);assert((await f.db.query('select state from profile_media_objects')).rows.every(r=>r.state==='garbage'));assert.equal(Number((await f.db.query("select count(*) n from profile_media_operations where status='committed'")).rows[0].n),2);
 }finally{await f.db.close();}
});

test('画像の未完了操作中もInstagramを保存でき、画像確定はInstagramの最新版を維持する',async()=>{
 const f=await fixture();try{await f.as();await f.prepare(900,0);const ig=await f.call('save_my_instagram',[pid,0,'during_upload',await f.ticket()]);assert.equal(ig.avatar_version,0);const m=await f.commit(900);assert.equal(m.instagram_username,'during_upload');assert.equal(m.instagram_version,1);assert.equal(m.avatar_version,1);
 }finally{await f.db.close();}
});
