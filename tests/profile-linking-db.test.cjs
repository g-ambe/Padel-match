const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// ネットワークには接続せず、実マイグレーションと架空の77選手をPostgreSQLで検証する。
const dir = join(__dirname, '../supabase/migrations');
const migration = readFileSync(join(dir, '0039_player_profile_consent_linking.sql'), 'utf8');
const id = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), adminA = id(2), adminB = id(3), other = id(4), newcomer = id(5), superUser = id(6);
const target = id(10), sourceA = id(20), sourceB = id(21), clubA = id(100), clubB = id(101), clubC = id(102);
const memberA = id(200), memberB = id(201);
const accountEmails = new Map([[owner,'owner@example.test'],[adminA,'admin-a@example.test'],[adminB,'admin-b@example.test'],[other,'other@example.test'],[newcomer,'new@example.test'],[superUser,'testuser01@example.com']]);
const initial = `create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
grant usage on schema auth,public to anon,authenticated; grant execute on all functions in schema auth to anon,authenticated;
create function public.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;`;
const seed = `
truncate public.player_profiles cascade;
insert into auth.users values ${[...accountEmails].map(([u,e])=>`('${u}','${e}',now())`).join(',')};
insert into profiles(id,display_name,email) values ${[...accountEmails].map(([u,e])=>`('${u}','アカウント${u.slice(-2)}','${e}')`).join(',')};
insert into player_profiles(id,linked_auth_user_id,display_name,bio,play_level,dominant_hand,preferred_position,activity_area) values
('${target}','${owner}','本人の正規名','本人の自己紹介','上級','左','バック','東京都'),
('${id(11)}','${adminA}','管理者A',null,null,null,null,null),
('${id(12)}','${adminB}','管理者B',null,null,null,null,null),
('${id(13)}','${other}','別人',null,null,null,null,null),
('${sourceA}',null,'仮登録名','仮の自己紹介','初級','右','フォア','大阪府'),
('${sourceB}',null,'仮登録名',null,null,null,null,null);
insert into player_profiles(id,display_name,is_active) select ('b0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'保存する既存選手'||n,n>54 from generate_series(1,71) n;
insert into clubs(id,name,owner_id,visibility) values ('${clubA}','グループA','${adminA}','public'),('${clubB}','グループB','${adminB}','public'),('${clubC}','本人の既存グループ','${owner}','public');
insert into club_members(id,club_id,profile_id,player_profile_id,role,created_at) values
('${id(210)}','${clubA}','${adminA}','${id(11)}','main_admin','2025-01-01'),
('${id(211)}','${clubB}','${adminB}','${id(12)}','main_admin','2025-01-02'),
('${id(212)}','${clubC}','${owner}','${target}','main_admin','2025-01-03'),
('${memberA}','${clubA}',null,'${sourceA}','sub_admin','2025-02-01'),
('${memberB}','${clubB}',null,'${sourceB}','member','2025-02-02');
insert into events(id,club_id,name,court_count) values ('${id(300)}','${clubA}','過去A',1),('${id(301)}','${clubB}','過去B',1),('${id(302)}','${clubC}','本人の過去',1);
insert into event_participants(id,event_id,player_profile_id,profile_id,status,participant_type,created_at) values
('${id(400)}','${id(300)}','${sourceA}','${owner}','resting','member','2025-03-01'),
('${id(401)}','${id(301)}','${sourceB}',null,'active','member','2025-03-02'),
('${id(402)}','${id(302)}','${target}',null,'active','member','2025-03-03');
insert into matches(id,event_id,court_number,youtube_url,completed,created_at) values ('${id(500)}','${id(300)}',1,'https://example.test/video',true,'2025-03-01');
insert into match_players(id,match_id,participant_id,team) values ('${id(501)}','${id(500)}','${id(400)}','A');
insert into match_results(id,match_id,score_a,score_b,winner_team) values ('${id(502)}','${id(500)}',6,4,'A');
insert into event_team_matches(id,event_id,team_a_player1_profile_id,team_a_player2_profile_id,team_b_player1_profile_id,team_b_player2_profile_id,team_a_score,team_b_score,youtube_url) values
('${id(510)}','${id(300)}','${sourceA}',null,null,null,6,4,'https://example.test/team'),
('${id(511)}','${id(300)}',null,'${sourceA}',null,null,6,4,null),
('${id(512)}','${id(300)}',null,null,'${sourceA}',null,4,6,null),
('${id(513)}','${id(300)}',null,null,null,'${sourceA}',4,6,null);
insert into official_events(id,club_id,title) values ('${id(520)}','${clubA}','過去の公式戦');
insert into official_opponents(id,official_event_id,opponent_team_name) values ('${id(521)}','${id(520)}','対戦相手');
insert into official_matches(id,official_event_id,official_opponent_id,match_order,our_player1_profile_id,our_player2_profile_id,our_score,opponent_score,youtube_url) values
('${id(522)}','${id(520)}','${id(521)}',1,'${sourceA}',null,6,4,'https://example.test/official'),
('${id(523)}','${id(520)}','${id(521)}',2,null,'${sourceA}',4,6,null);
insert into join_requests(id,club_id,requester_auth_user_id,requester_player_profile_id,status) values ('${id(530)}','${clubA}','${owner}','${sourceA}','approved');
insert into player_stats(id,club_id,profile_id,match_count,win_count) values ('${id(540)}','${clubA}','${owner}',42,30);
`;
async function prepare(db) {
  await db.exec(initial);
  for (const file of readdirSync(dir).sort()) if (file.endsWith('.sql') && file < '0039') {
    // UUID用拡張だけPGlite標準UUID生成で代用し、アプリのDDL・RLSはそのまま適用する。
    await db.exec(readFileSync(join(dir,file),'utf8').replace(/create extension if not exists (?:"uuid-ossp"|pgcrypto);/g,''));
  }
  await db.exec(seed);
  await db.exec('grant all on all tables in schema public to anon,authenticated');
}
async function fixture(run, extra = '', apply = true) {
  const db = new PGlite();
  try { await prepare(db); if (extra) await db.exec(extra); if (apply) await db.exec(migration); await run(db); }
  finally { await db.close(); }
}
async function asUser(db, uid, run, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid ?? '', JSON.stringify({sub:uid,email:accountEmails.get(uid)})]);
  await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec('reset role'); }
}
async function rpc(db, uid, name, args = []) {
  return asUser(db,uid,async()=> (await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})) as value`, args)).rows[0].value);
}
async function requestLink(db, member = memberA, club = clubA, admin = adminA, user = owner) { return rpc(db,admin,'request_player_profile_link',[club,member,user]); }
async function approve(db, request, user = owner) {
  const preview = await rpc(db,user,'get_player_profile_link_request',[request]);
  return rpc(db,user,'review_player_profile_link',[request,'approved',preview.review_token]);
}
async function state(db) {
  const tables = ['player_profiles','club_members','event_participants','match_players','matches','match_results','event_team_matches','official_matches','player_stats'];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table,(await db.query(`select to_jsonb(t) as row from public.${table} t order by id`)).rows.map(r=>r.row)])));
}

test('既存77件と無効化行を再統合せず、既存の認証IDと異なる正規選手IDを保持する', async()=>fixture(async db=>{
  const before=await state(db); await db.exec(migration); const after=await state(db);
  for (const p of after.player_profiles) delete p.created_by_auth_user_id;
  assert.deepEqual(after,before); assert.equal(after.player_profiles.length,77);
  const p=await rpc(db,owner,'ensure_my_player_profile',['新しい名前',target]); assert.equal(p.id,target); assert.equal(p.display_name,'本人の正規名');
},'',false));

test('同名の仮選手を別グループへ追加でき、連携せず再試行でも増殖しない', async()=>fixture(async db=>{
  const a=await rpc(db,adminA,'add_provisional_club_member',[clubA,'同姓同名',id(600)]);
  const b=await rpc(db,adminB,'add_provisional_club_member',[clubB,'同姓同名',id(601)]);
  assert.notEqual(a,b); assert.equal(await rpc(db,adminA,'add_provisional_club_member',[clubA,'同姓同名',id(600)]),a);
  const rows=(await db.query('select * from player_profiles where id=any($1::uuid[])',[[id(600),id(601)]])).rows;
  assert(rows.every(r=>r.linked_auth_user_id===null && r.is_active));
  await assert.rejects(rpc(db,other,'add_provisional_club_member',[clubA,'不正',id(602)]),/権限/);
}));

test('本人の明示作成は再実行しても1件で、単なる一覧表示や申請だけでは作成しない', async()=>fixture(async db=>{
  const before=await state(db); const request=await requestLink(db,memberB,clubB,adminB,newcomer);
  const preview=await rpc(db,newcomer,'get_player_profile_link_request',[request]); assert.equal(preview.target_profile_id,null); assert.deepEqual(await state(db),before);
  await assert.rejects(approve(db,request,newcomer),/作成してから/);
  const results=await Promise.all([rpc(db,newcomer,'ensure_my_player_profile',['本人作成',null]),rpc(db,newcomer,'ensure_my_player_profile',['本人作成',null])]);
  assert(results.every(p=>p.id===newcomer));
  assert.equal((await approve(db,request,newcomer)).status,'approved');
}));

test('管理者の申請・本人拒否ではプロフィール・所属・戦績が変わらず通知が届く', async()=>fixture(async db=>{
  const before=await state(db), request=await requestLink(db);
  assert.deepEqual(await state(db),before);
  assert((await db.query('select title from notifications where target_auth_user_id=$1',[owner])).rows.some(r=>r.title==='連携申請が届いています'));
  assert.equal((await rpc(db,owner,'review_player_profile_link',[request,'rejected',null])).status,'rejected');
  assert.deepEqual(await state(db),before);
  assert.equal((await rpc(db,owner,'review_player_profile_link',[request,'approved','無効'])).status,'rejected');
  assert.deepEqual(await state(db),before);
}));

test('本人承認でA・Bを同一正規IDへ統合し、本人設定・役職・日時・全試合を維持する', async()=>fixture(async db=>{
  const before=await state(db);
  const a=await requestLink(db), b=await requestLink(db,memberB,clubB,adminB);
  assert.equal((await approve(db,a)).status,'approved'); assert.equal((await approve(db,b)).status,'approved');
  const after=await state(db);
  assert.equal(after.player_profiles.length,77);
  assert.deepEqual(after.player_profiles.find(p=>p.id===target),before.player_profiles.find(p=>p.id===target));
  for (const source of [sourceA,sourceB]) {
    const p=after.player_profiles.find(p=>p.id===source), old=before.player_profiles.find(p=>p.id===source);
    assert.deepEqual(p,{...old,is_active:false,linked_auth_user_id:null});
  }
  for (const table of ['match_players','matches','match_results','player_stats']) assert.deepEqual(after[table],before[table]);
  for (const row of after.club_members) assert.deepEqual(row,{...before.club_members.find(r=>r.id===row.id),player_profile_id:[memberA,memberB].includes(row.id)?target:row.player_profile_id});
  for (const row of after.event_participants) assert.deepEqual(row,{...before.event_participants.find(r=>r.id===row.id),player_profile_id:[sourceA,sourceB].includes(before.event_participants.find(r=>r.id===row.id).player_profile_id)?target:row.player_profile_id});
  assert.equal((await db.query('select requester_player_profile_id as id from join_requests where id=$1',[id(530)])).rows[0].id,target);
  assert(after.event_team_matches.every(m=>[m.team_a_player1_profile_id,m.team_a_player2_profile_id,m.team_b_player1_profile_id,m.team_b_player2_profile_id].includes(target)));
  assert(after.official_matches.every(m=>[m.our_player1_profile_id,m.our_player2_profile_id].includes(target)));
  for (const table of ['event_team_matches','official_matches']) for (const row of after[table]) {
    const expected=structuredClone(before[table].find(r=>r.id===row.id));
    for(const column of Object.keys(expected)) if(column.endsWith('_profile_id') && [sourceA,sourceB].includes(expected[column])) expected[column]=target;
    assert.deepEqual(row,expected);
  }
  assert.equal((await db.query('select count(*)::int n from player_profile_merges')).rows[0].n,2);
  assert.equal((await db.query("select count(*)::int n from notifications where target_auth_user_id=$1 and related_profile_link_request_id=$2 and title='連携が完了しました'",[owner,a])).rows[0].n,1,'統合後に本人がグループ管理者となっても通知を二重送信しない');
  assert((await db.query('select changed_counts from player_profile_merges')).rows.every(r=>r.changed_counts.player_profiles===1));
}));

test('申請の二重作成・別アカウントへの競合申請・他人と管理者による承認を拒否する', async()=>fixture(async db=>{
  const request=await requestLink(db); const before=await state(db);
  await assert.rejects(requestLink(db),/承認待ち/); await assert.rejects(requestLink(db,memberA,clubA,adminA,other),/承認待ち/);
  await assert.rejects(rpc(db,adminA,'review_player_profile_link',[request,'approved','無効']),/申請先本人/); await assert.rejects(rpc(db,other,'review_player_profile_link',[request,'approved','無効']),/申請先本人/);
  assert.deepEqual(await state(db),before);
}));

test('承認の並行再試行は同じ申請を一度だけ統合する', async()=>fixture(async db=>{
  const request=await requestLink(db), preview=await rpc(db,owner,'get_player_profile_link_request',[request]);
  await asUser(db,owner,async()=>{
    const query=()=>db.query('select review_player_profile_link($1,$2,$3) as result',[request,'approved',preview.review_token]);
    const results=await Promise.all([query(),query()]); assert(results.every(r=>r.rows[0].result.status==='approved'));
  });
  assert.equal((await db.query('select count(*)::int n from player_profile_merges')).rows[0].n,1);
}));

for (const status of ['cancelled','expired']) test(`${status}の連携申請から統合できない`,async()=>fixture(async db=>{
  const request=await requestLink(db), before=await state(db);
  if(status==='cancelled') await rpc(db,adminA,'review_player_profile_link',[request,'cancelled',null]);
  else await db.query("update player_profile_link_requests set expires_at=now()-interval '1 second' where id=$1",[request]);
  assert.equal((await rpc(db,owner,'review_player_profile_link',[request,'approved','古い確認'])).status,status);
  assert.deepEqual(await state(db),before);
}));

test('確認後の内容変更・申請元の権限喪失・対象メンバーの変更は中止する',async()=>fixture(async db=>{
  const request=await requestLink(db), preview=await rpc(db,owner,'get_player_profile_link_request',[request]);
  await db.query('update player_profiles set bio=$1 where id=$2',['後からの変更',sourceA]);
  await assert.rejects(rpc(db,owner,'review_player_profile_link',[request,'approved',preview.review_token]),/確認後に/);
  await db.query('update club_members set is_active=false where id=$1',[id(210)]);
  await assert.rejects(approve(db,request),/管理権限が変更/);
  assert.equal((await db.query('select count(*)::int n from player_profile_merges')).rows[0].n,0);
}));

const conflicts=[
 ['同一グループ',`insert into club_members(club_id,player_profile_id,role) values ('${clubA}','${target}','member')`,/同じグループ/],
 ['同一イベント',`update event_participants set event_id='${id(300)}' where id='${id(402)}'`,/同じイベント/],
 ['別イベントIDでも同一試合',`insert into match_players(match_id,participant_id,team) values ('${id(500)}','${id(402)}','B')`,/同じ試合/],
 ['チーム戦二重枠',`update event_team_matches set team_b_player2_profile_id='${target}' where id='${id(510)}'`,/フレンドリーチーム戦/],
 ['公式戦二重枠',`update official_matches set our_player2_profile_id='${target}' where id='${id(522)}'`,/公式戦/],
 ['旧アカウント参照',`update event_participants set profile_id='${other}' where id='${id(400)}'`,/旧profile_id/],
 ['旧戦績参照',`insert into profiles(id,display_name) values ('${sourceA}','別の旧アカウント'); insert into player_stats(club_id,profile_id) values ('${clubA}','${sourceA}')`,/旧profile_id/],
 ['未知の外部キー',`create table unknown_player_refs(id uuid primary key, player_id uuid references player_profiles(id))`,/未確認の外部キー/],
];
for(const [name,extra,expected] of conflicts) test(`${name}の競合時は全体をロールバックして監査も部分作成しない`,async()=>fixture(async db=>{
  if (name === "未知の外部キー") await db.exec(extra);
  const request=await requestLink(db); const before=await state(db);
  await assert.rejects(approve(db,request),expected);
  assert.deepEqual(await state(db),before);
  assert.equal((await db.query('select count(*)::int n from player_profile_merges')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from profile_link_private.merge_changes')).rows[0].n,0);
},name==='未知の外部キー'?'':extra));

async function joining(db, selected=true){
 const preview=selected?await rpc(db,owner,'preview_profile_join',[clubA,memberA]):null;
 return rpc(db,owner,'submit_profile_join_request',[clubA,selected?memberA:null,'本人の申請',preview?.review_token??null]);
}
test('本人が仮選手を選んだ加入申請は同意を記録し、管理者承認で二重の本人承認なく統合する',async()=>fixture(async db=>{
 const request=await joining(db); const row=(await db.query('select * from join_requests where id=$1',[request])).rows[0];
 assert.equal(row.consent_source_player_profile_id,sourceA); assert(row.consent_at); assert(row.consent_snapshot);
 assert.equal((await rpc(db,adminA,'review_profile_join_request',[request,'approved'])).status,'approved');
 assert.equal((await db.query('select player_profile_id from club_members where id=$1',[memberA])).rows[0].player_profile_id,target);
 assert.equal((await db.query('select count(*)::int n from player_profile_merges')).rows[0].n,1);
}));
test('通常の加入申請は正規プロフィールを所属させ、無関係な仮選手に触れない',async()=>fixture(async db=>{
 const before=(await db.query('select * from player_profiles where id=$1',[sourceA])).rows[0];
 const request=await joining(db,false); await rpc(db,adminA,'review_profile_join_request',[request,'approved']);
 assert.deepEqual((await db.query('select * from player_profiles where id=$1',[sourceA])).rows[0],before);
 assert.equal((await db.query('select count(*)::int n from club_members where club_id=$1 and player_profile_id=$2',[clubA,target])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from player_profile_merges')).rows[0].n,0);
}));
test('加入同意後の履歴変更、仮選手変更、旧申請の同意欠落を拒否する',async()=>fixture(async db=>{
 const request=await joining(db);
 await db.query('update event_participants set status=$1 where id=$2',['active',id(400)]);
 await assert.rejects(rpc(db,adminA,'review_profile_join_request',[request,'approved']),/同意後に/);
 await db.query('update join_requests set target_club_member_id=$1 where id=$2',[memberB,request]);
 await assert.rejects(rpc(db,adminA,'review_profile_join_request',[request,'approved']),/本人が指定した/);
 await db.query('update join_requests set consent_at=null where id=$1',[request]);
 await assert.rejects(rpc(db,adminA,'review_profile_join_request',[request,'approved']),/統合同意/);
 assert.equal((await db.query('select count(*)::int n from player_profile_merges')).rows[0].n,0);
}));
for(const status of ['rejected','cancelled','expired']) test(`${status}の加入申請から統合できない`,async()=>fixture(async db=>{
 const request=await joining(db), before=await state(db);
 if(status==='expired') await db.query("update join_requests set expires_at=now()-interval '1 second' where id=$1",[request]);
 else await rpc(db,status==='cancelled'?owner:adminA,'review_profile_join_request',[request,status]);
 assert.equal((await rpc(db,adminA,'review_profile_join_request',[request,'approved'])).status,status); assert.deepEqual(await state(db),before);
}));

test('匿名・一般ユーザー・管理者でも直接連携、解除、無効化、申請改ざん、権限偽装はできない',async()=>fixture(async db=>{
 for(const actor of [owner,other,adminA]) await asUser(db,actor,async()=>{
   for(const sql of [
     `update player_profiles set linked_auth_user_id='${owner}' where id='${sourceA}'`,
     `update player_profiles set linked_auth_user_id=null where id='${target}'`,
     `update player_profiles set is_active=false where id='${target}'`,
     `insert into player_profiles(display_name,linked_auth_user_id) values ('不正','${actor}')`,
     `update club_members set profile_id='${actor}' where id='${memberA}'`,
     `insert into app_admins(profile_id) values ('${actor}')`,
     `update clubs set owner_id='${other}' where id='${clubA}'`,
     `update join_requests set status='approved'`,
     `select profile_link_private.merge_profiles('${sourceA}','${target}','${owner}','${clubA}','${adminA}','${owner}',null,null)`,
   ]) await assert.rejects(db.exec(sql), undefined, sql);
 });
 await asUser(db,null,async()=>{
   await assert.rejects(db.exec(`select ensure_my_player_profile('匿名',null)`));
   await assert.rejects(db.exec('select email from profiles'));
 },'anon');
 await asUser(db,adminA,async()=>{
   await assert.rejects(db.exec('select email from profiles'));
   const changed=await db.query('update player_profiles set display_name=$1 where id=$2 returning id',['上書き',target]); assert.equal(changed.rows.length,0);
 });
}));

test('アカウント確認は管理者の完全一致メールに限定し、メール一覧と大量検索を許可しない',async()=>fixture(async db=>{
 await assert.rejects(rpc(db,other,'find_profile_link_account',[clubA,'owner@example.test']),/権限/);
 await asUser(db,adminA,async()=>{
   assert.equal((await db.query('select * from find_profile_link_account($1,$2)',[clubA,'owner@example.test'])).rows[0].auth_user_id,owner);
   assert.equal((await db.query('select * from find_profile_link_account($1,$2)',[clubA,'%@example.test'])).rows.length,0);
   for(let n=0;n<18;n++) await db.query('select * from find_profile_link_account($1,$2)',[clubA,'none@example.test']);
   await assert.rejects(db.query('select * from find_profile_link_account($1,$2)',[clubA,'owner@example.test']),/確認回数の上限/);
 });
}));

test('統合済み選手は通常一覧に出ず、新しい所属・参加・チーム戦・公式戦の参照を拒否する',async()=>fixture(async db=>{
 const request=await requestLink(db); await approve(db,request);
 await asUser(db,other,async()=>assert.equal((await db.query('select id from player_profiles where id=$1',[sourceA])).rows.length,0));
 for(const sql of [
   `insert into club_members(club_id,player_profile_id,role) values ('${clubB}','${sourceA}','member')`,
   `insert into event_participants(event_id,player_profile_id,status,participant_type) values ('${id(301)}','${sourceA}','active','member')`,
   `update event_team_matches set team_a_player1_profile_id='${sourceA}' where id='${id(510)}'`,
   `update official_matches set our_player1_profile_id='${sourceA}' where id='${id(522)}'`,
 ]) await assert.rejects(db.exec(sql),/統合済み/);
}));

test('イベント限定ゲストの追加は選手プロフィールを作成しない',async()=>fixture(async db=>{
 const before=(await db.query('select count(*)::int n from player_profiles')).rows[0].n;
 await asUser(db,other,async()=>db.query("insert into event_participants(event_id,guest_name,status,participant_type) values ($1,'イベント限定','active','guest')",[id(300)]));
 assert.equal((await db.query('select count(*)::int n from player_profiles')).rows[0].n,before);
}));

test('一意制約違反を具体的なIDで報告し、既存行を変更せずマイグレーション全体を中止する',async()=>fixture(async db=>{
 const before=await state(db);
 await assert.rejects(db.exec(migration),e=>{assert.match(e.message,/複数/);assert.match(e.detail,new RegExp(target));assert.match(e.detail,new RegExp(id(700)));return true;});
 await db.exec('rollback'); assert.deepEqual(await state(db),before);
 assert.equal((await db.query("select to_regclass('public.player_profile_link_requests') as t")).rows[0].t,null);
},`insert into player_profiles(id,display_name,linked_auth_user_id) values ('${id(700)}','曖昧な連携','${owner}')`,false));

const maintenance = name => readFileSync(join(__dirname,'../supabase/maintenance/profile-linking',name),'utf8');
const restoreMerge = (mergeId,commit=false) => maintenance('04_restore_reviewed_merge.sql')
  .replace('-- 復旧対象挿入位置',mergeId?`insert into reviewed_merge_restore values ('${mergeId}');`:'')
  .replace(/rollback;\s*$/,commit?'commit;':'rollback;');
test('事前調査・バックアップ・適用後検証SQLを実行でき、バックアップ再作成は拒否する',async()=>fixture(async db=>{
 await db.exec(maintenance('01_preflight.sql'));
 const before=await state(db); await db.exec(maintenance('02_backup.sql'));
 await asUser(db,other,async()=>assert.equal((await db.query("select has_schema_privilege(current_user,'player_profile_link_backup_20261023','USAGE') as allowed")).rows[0].allowed,false));
 await assert.rejects(db.exec(maintenance('02_backup.sql')),/already exists/); await db.exec('rollback');
 await db.exec(migration); await db.exec(maintenance('03_verify.sql'));
 const after=await state(db); for(const p of after.player_profiles) delete p.created_by_auth_user_id; assert.deepEqual(after,before);
},'',false));

test('監査からの手動復旧は既定ROLLBACKで、承認した復旧では全参照・状態を戻せる',async()=>fixture(async db=>{
 const before=await state(db),request=await requestLink(db); const result=await approve(db,request); const merged=await state(db);
 await assert.rejects(db.exec(restoreMerge(null)),/監査IDを1件/); await db.exec('rollback');
 await db.exec(restoreMerge(result.merge_id)); assert.deepEqual(await state(db),merged);
 await db.exec(restoreMerge(result.merge_id,true)); assert.deepEqual(await state(db),before);
 assert((await db.query('select restored_at from player_profile_merges where id=$1',[result.merge_id])).rows[0].restored_at);
}));

test('統合後に編集された行があれば手動復旧でも上書きしない',async()=>fixture(async db=>{
 const request=await requestLink(db), result=await approve(db,request);
 await db.query('update club_members set role=$1 where id=$2',['member',memberA]); const before=await state(db);
 await assert.rejects(db.exec(restoreMerge(result.merge_id,true)),/編集・削除/); await db.exec('rollback');
 assert.deepEqual(await state(db),before);
}));

test('所有プロフィールの直接追加は一意索引でも防ぎ、仮選手の別アカウント連携を拒否する',async()=>fixture(async db=>{
 await assert.rejects(db.query('insert into player_profiles(id,display_name,linked_auth_user_id) values ($1,$2,$3)',[id(710),'二重正規',owner]),/unique/);
 await db.query('update player_profiles set linked_auth_user_id=$1 where id=$2',[newcomer,sourceB]);
 await assert.rejects(requestLink(db,memberB,clubB,adminB,owner),/未連携/);
}));

test('既存のメンバー編集・役職変更・退会・復帰・本人編集とsuper_userの管理権限を維持する',async()=>fixture(async db=>{
 await asUser(db,adminA,async()=>{
  assert.equal((await db.query('update player_profiles set display_name=$1 where id=$2 returning id',['仮選手を編集',sourceA])).rows.length,1);
  assert.equal((await db.query("update club_members set role='member',is_active=false,status='inactive' where id=$1 returning id",[memberA])).rows.length,1);
  assert.equal((await db.query("update club_members set is_active=true,status='active' where id=$1 returning id",[memberA])).rows.length,1);
 });
 await asUser(db,owner,async()=>assert.equal((await db.query('update player_profiles set display_name=$1 where id=$2 returning id',['本人の編集',target])).rows.length,1));
 assert.equal(await rpc(db,superUser,'can_manage_player_profile_club',[clubA]),true);
 const request=await requestLink(db,memberA,clubA,superUser); assert.equal((await approve(db,request)).status,'approved');
}));

test('新旧の加入申請と連携申請は作成から7日で失効する',async()=>fixture(async db=>{
 const request=await requestLink(db);
 assert.equal((await db.query("select expires_at-created_at = interval '7 days' as valid from player_profile_link_requests where id=$1",[request])).rows[0].valid,true);
 await db.query("update join_requests set status='pending',created_at=now()-interval '8 days' where id=$1",[id(530)]);
 assert.equal((await rpc(db,adminA,'review_profile_join_request',[id(530),'approved'])).status,'expired');
 assert.equal((await db.query('select count(*)::int n from player_profile_merges')).rows[0].n,0);
}));


test('本人の詳細が空欄でも仮プロフィールの設定では補完・上書きしない',async()=>fixture(async db=>{
 const before=(await db.query('select * from player_profiles where id=$1',[target])).rows[0];
 const request=await requestLink(db); await approve(db,request);
 assert.deepEqual((await db.query('select * from player_profiles where id=$1',[target])).rows[0],before);
},`update player_profiles set bio=null,play_level=null,dominant_hand=null,preferred_position=null,activity_area=null where id='${target}'`));


test('申請後にメンバーの選手IDが変わった場合は別の選手を統合しない',async()=>fixture(async db=>{
 const request=await requestLink(db);
 await db.query('update club_members set player_profile_id=$1 where id=$2',[sourceB,memberA]);const before=await state(db);
 await assert.rejects(approve(db,request),/対象メンバーが変更/);assert.deepEqual(await state(db),before);
}));

test('申請時の本人の正規IDが変更された場合は新しいIDへ勝手に統合しない',async()=>fixture(async db=>{
 const request=await requestLink(db);
 await db.query('update player_profiles set is_active=false where id=$1',[target]);
 await db.query('insert into player_profiles(id,display_name,linked_auth_user_id) values ($1,$2,$3)',[id(720),'別の正規候補',owner]);
 const before=await state(db);await assert.rejects(approve(db,request),/連携が変わっています/);assert.deepEqual(await state(db),before);
}));

const membershipSql=name=>readFileSync(join(__dirname,'../supabase/maintenance/group-members',name),'utf8');
const commitMembershipSql=name=>membershipSql(name).replace(/rollback;\s*$/,'commit;');

test('復帰後の権限はis_activeで判定し、旧状態やプロフィールを変更せずRLSの再帰も起こさない',async()=>fixture(async db=>{
 await db.query("update club_members set status='inactive' where id=$1",[id(210)]);
 const before=await state(db);assert.equal(await rpc(db,adminA,'can_manage_player_profile_club',[clubA]),false);
 await db.exec(membershipSql('01_check_access.sql'));await db.exec(membershipSql('02_use_is_active.sql'));
 assert.equal(await rpc(db,adminA,'can_manage_player_profile_club',[clubA]),false);
 await db.exec(commitMembershipSql('02_use_is_active.sql'));assert.equal(await rpc(db,adminA,'can_manage_player_profile_club',[clubA]),true);
 await asUser(db,adminA,async()=>assert.equal((await db.query('update club_members set is_active=false where id=$1 returning id',[memberA])).rows.length,1));
 await db.query('update club_members set is_active=true where id=$1',[memberA]);
 assert.deepEqual(await state(db),before);
}));

test('所属の旧状態列がなくても、復帰した仮選手の本人承認・統合と新規候補を維持する',async()=>fixture(async db=>{
 await db.exec(commitMembershipSql('02_use_is_active.sql'));
 await db.exec('alter table club_members drop column status');
 const request=await requestLink(db);assert.equal((await approve(db,request)).status,'approved');
 const fresh=await rpc(db,adminB,'add_provisional_club_member',[clubB,'新しい仮選手',id(730)]);assert(fresh);
}));

test('最後のメイン管理者の退会・降格・削除を手動保護SQLでも防ぎ、他の所属を変更しない',async()=>fixture(async db=>{
 await db.exec(commitMembershipSql('03_guard_last_admin.sql'));
 const before=await state(db);
 for(const sql of ["update club_members set is_active=false where id=$1","update club_members set role='member' where id=$1","delete from club_members where id=$1"])
   await assert.rejects(db.query(sql,[id(210)]),/最低1人/);
 assert.deepEqual(await state(db),before);
 await db.query("update club_members set role='main_admin' where id=$1",[memberA]);
 await db.query('update club_members set is_active=false where id=$1',[id(210)]);
 await assert.rejects(db.query('update club_members set is_active=false where id=$1',[memberA]),/最低1人/);
 assert.equal((await db.query('select is_active from club_members where id=$1',[id(211)])).rows[0].is_active,true);
}));
