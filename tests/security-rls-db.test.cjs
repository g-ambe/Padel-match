const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// 本番・ステージングには接続せず、実SQLと架空のデータをPostgreSQLで検証する。
const migrationDir = join(__dirname, '../supabase/migrations');
const id = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const main = id(1), sub = id(2), member = id(3), otherMain = id(4), outsider = id(5), creator = id(6), superUser = id(7), inactive = id(8), linkedMember = id(9), staleStatus = id(10);
const users = [main, sub, member, otherMain, outsider, creator, superUser, inactive, linkedMember, staleStatus];
const player = user => id(Number(user.slice(-12)) + 1000);
const clubA = id(100), clubB = id(101), publicClub = id(102), deletedClub = id(103);
const eventA = id(300), eventB = id(301), personal = id(302), closed = id(303), deletedEvent = id(304), activeShared = id(305), teamEvent = id(306);
const roundA = id(400), roundB = id(401), closedRound = id(403);
const matchA = id(500), matchB = id(501), closedMatch = id(503);
const participantA = id(600), participantB = id(601), closedParticipant = id(603);
const matchPlayerA = id(700), matchPlayerB = id(701), closedMatchPlayer = id(703);
const resultA = id(800), resultB = id(801), closedResult = id(803);
const statA = id(900), statB = id(901), legacyNullStat = id(902);
const sharedToken = '0123456789abcdef0123456789abcdef';
const initial = `create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
grant usage on schema auth,public to anon,authenticated; grant execute on all functions in schema auth to anon,authenticated;
create function public.uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;`;
const seed = `truncate public.player_profiles cascade;
insert into auth.users values ${users.map((u,i)=>`('${u}','security-${i}@example.test',now())`).join(',')};
insert into profiles(id,display_name,email) values ${users.map((u,i)=>`('${u}','試験アカウント${i}','security-${i}@example.test')`).join(',')};
insert into player_profiles(id,linked_auth_user_id,display_name) values ${users.map((u,i)=>`('${player(u)}','${u}','試験選手${i}')`).join(',')};
insert into app_admins(profile_id,is_active) values ('${superUser}',true);
insert into clubs(id,name,owner_id,visibility,is_deleted) values
('${clubA}','非公開A','${main}','private',false),('${clubB}','非公開B','${otherMain}','private',false),('${publicClub}','公開一覧','${main}','public',false),('${deletedClub}','削除済','${main}','public',true);
insert into club_members(id,club_id,profile_id,player_profile_id,role,is_active,status) values
('${id(200)}','${clubA}','${main}','${player(main)}','main_admin',true,'active'),
('${id(201)}','${clubA}','${sub}','${player(sub)}','sub_admin',true,'active'),
('${id(202)}','${clubA}','${member}','${player(member)}','member',true,'active'),
('${id(203)}','${clubB}','${otherMain}','${player(otherMain)}','main_admin',true,'active'),
('${id(204)}','${clubA}','${inactive}','${player(inactive)}','member',false,'inactive'),
('${id(205)}','${clubA}',null,'${player(linkedMember)}','member',true,'active'),
('${id(206)}','${clubA}',null,'${player(staleStatus)}','member',true,'inactive');
insert into events(id,club_id,name,court_count,created_by_auth_user_id,status,share_enabled,share_token,is_deleted,event_mode) values
('${eventA}','${clubA}','グループA',2,'${main}','active',false,null,false,'auto'),
('${eventB}','${clubB}','グループB',2,'${otherMain}','active',false,null,false,'auto'),
('${personal}',null,'個人',1,'${creator}','active',false,null,false,'manual'),
('${closed}','${clubA}','共有する終了試合',2,'${main}','closed',true,'${sharedToken}',false,'auto'),
('${deletedEvent}','${clubA}','削除試合',1,'${main}','closed',true,'deleted-token',true,'auto'),
('${activeShared}','${clubA}','未終了共有',1,'${main}','active',true,'active-token',false,'auto'),
('${teamEvent}',null,'チーム戦',1,'${creator}','active',false,null,false,'team');
insert into event_team_sides(id,event_id,side,club_id,team_name) values ('${id(1200)}','${teamEvent}','team_a','${clubA}','チームA'),('${id(1201)}','${teamEvent}','team_b','${clubB}','チームB');
insert into event_participants(id,event_id,player_profile_id,participant_type,status,guest_name) values
('${participantA}','${eventA}','${player(member)}','member','active',null),
('${participantB}','${eventB}','${player(otherMain)}','member','active',null),
('${closedParticipant}','${closed}','${player(member)}','member','active',null);
insert into rounds(id,event_id,round_number) values ('${roundA}','${eventA}',1),('${roundB}','${eventB}',1),('${closedRound}','${closed}',1);
insert into matches(id,event_id,round_id,court_number,completed,youtube_url) values
('${matchA}','${eventA}','${roundA}',1,true,'https://example.test/private-video'),('${matchB}','${eventB}','${roundB}',1,true,null),('${closedMatch}','${closed}','${closedRound}',1,true,'https://example.test/public-video');
insert into match_players(id,match_id,participant_id,team) values ('${matchPlayerA}','${matchA}','${participantA}','A'),('${matchPlayerB}','${matchB}','${participantB}','B'),('${closedMatchPlayer}','${closedMatch}','${closedParticipant}','A');
insert into match_results(id,match_id,score_a,score_b,winner_team) values ('${resultA}','${matchA}',6,4,'A'),('${resultB}','${matchB}',4,6,'B'),('${closedResult}','${closedMatch}',6,4,'A');
insert into player_stats(id,club_id,profile_id,match_count,win_count) values ('${statA}','${clubA}','${member}',2,1),('${statB}','${clubB}','${otherMain}',2,1),('${legacyNullStat}',null,'${member}',42,30);
insert into event_video_links(id,event_id,title,video_url) values ('${id(1300)}','${closed}','全試合動画','https://example.test/all-video');
`;
const maintenance = name => readFileSync(join(__dirname,'../supabase/maintenance/security-p0',name),'utf8');
let db, securityMigrations;
async function state() {
  const tables = ['clubs','club_members','events','event_participants','rounds','matches','match_players','match_results','player_stats','player_profiles'];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table,(await db.query(`select to_jsonb(t) as row from public.${table} t order by id`)).rows.map(r=>r.row)])));
}
before(async()=>{
  db = new PGlite(); await db.exec(initial);
  const files = readdirSync(migrationDir).filter(f=>f.endsWith('.sql')).sort();
  for(const file of files.filter(f=>f<'0039')) await db.exec(readFileSync(join(migrationDir,file),'utf8').replace(/create extension if not exists (?:"uuid-ossp"|pgcrypto);/g,''));
  await db.exec('grant all on all tables in schema public to anon,authenticated');
  await db.exec(readFileSync(join(migrationDir,'0039_player_profile_consent_linking.sql'),'utf8'));
  await db.exec(seed);
  securityMigrations = files.filter(f=>f>'0039_player_profile_consent_linking.sql').map(f=>readFileSync(join(migrationDir,f),'utf8'));
  assert(securityMigrations.length>0,'PR-Aのマイグレーションが必要');
  const beforeState=await state();
  await db.exec(maintenance('01_preflight.sql'));
  await db.exec(maintenance('02_backup.sql'));
  for(const sql of securityMigrations) await db.exec(sql);
  assert.deepEqual(await state(),beforeState,'適用で既存データを変更しない');
  for(const sql of securityMigrations) await db.exec(sql);
  assert.deepEqual(await state(),beforeState,'再適用で既存データを変更しない');
  await db.exec(maintenance('03_verify.sql'));
  await db.exec(maintenance('04_rollback.sql'));
  assert.deepEqual(await state(),beforeState,'切り戻し予行でデータを変更しない');
});
after(async()=>{ if(db) await db.close(); });
async function scenario(run) {
  await db.exec('begin');
  try { await run(); } finally { await db.exec('rollback'); await db.exec('reset role'); }
}
async function asUser(uid, run, role='authenticated', extra={}) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid??'',JSON.stringify({sub:uid,email:uid?`security-${users.indexOf(uid)}@example.test`:null,...extra})]);
  await db.exec(`set role ${role}`);
  let failure;
  try { return await run(); } catch(error) { failure=error; throw error; }
  finally { try { await db.exec('reset role'); } catch(error) { if(!failure) throw error; } }
}
// 拒否は例外とRLSの0件応答を区別して確認し、例外後も同じトランザクションを使えるようにする。
async function rejected(sql, params=[], expected) {
  await db.exec('savepoint denied_operation');
  try { await assert.rejects(db.query(sql,params),expected); } finally { await db.exec('rollback to savepoint denied_operation; release savepoint denied_operation'); }
}
async function zero(sql,params=[]) { assert.equal((await db.query(sql,params)).rows.length,0,sql); }
async function prevented(sql,params=[]) {
  await db.exec('savepoint blocked_operation');
  let result, denied=false;
  try { try { result=await db.query(sql,params); } catch(error) { assert(error.code,'DBによる拒否'); denied=true; } if(!denied) assert.equal(result.rows.length,0,sql); }
  finally { await db.exec('rollback to savepoint blocked_operation; release savepoint blocked_operation'); }
}
const protectedRows=[['events',eventA],['event_participants',participantA],['rounds',roundA],['matches',matchA],['match_players',matchPlayerA],['match_results',resultA],['player_stats',statA]];

for(const [name,actor,role] of [['匿名',null,'anon'],['無関係ログイン',outsider,'authenticated'],['別グループ管理者',otherMain,'authenticated'],['退会メンバー',inactive,'authenticated'],['旧状態が非在籍のメンバー',staleStatus,'authenticated']]) test(`${name}は非公開の親子7テーブルを参照・更新・削除できない`,()=>scenario(async()=>{
  await asUser(actor,async()=>{
    for(const [table,row] of protectedRows){
      if(role==='anon') await prevented(`select id from ${table} where id=$1`,[row]); else await zero(`select id from ${table} where id=$1`,[row]);
      if(role==='anon') {
        await rejected(`update ${table} set id=id where id=$1 returning id`,[row]);
        await rejected(`delete from ${table} where id=$1 returning id`,[row]);
      } else {
        await zero(`update ${table} set id=id where id=$1 returning id`,[row]);
        await zero(`delete from ${table} where id=$1 returning id`,[row]);
      }
    }
    if(role==='anon') await prevented('select id from clubs where id=$1',[clubA]); else await zero('select id from clubs where id=$1',[clubA]);
    await rejected('insert into events(club_id,name,court_count,created_by_auth_user_id) values ($1,$2,1,$3)',[clubA,'不正イベント',actor]);
    await rejected('insert into rounds(event_id,round_number) values ($1,22)',[eventA]);
    await rejected('insert into event_participants(event_id,guest_name,status,participant_type) values ($1,$2,$3,$4)',[eventA,'不正ゲスト','active','guest']);
    await rejected('insert into matches(event_id,round_id,court_number) values ($1,$2,2)',[eventA,roundA]);
    await rejected('insert into match_players(match_id,participant_id,team) values ($1,$2,$3)',[matchA,participantA,'B']);
    await rejected('insert into match_results(match_id,score_a,score_b,winner_team) values ($1,1,0,$2)',[matchA,'A']);
    await rejected('insert into player_stats(club_id,profile_id) values ($1,$2)',[clubA,outsider]);
  },role);
}));

for(const [name,actor] of [['一般メンバー',member],['サブ管理者',sub],['メイン管理者',main],['連携IDのメンバー',linkedMember],['スーパー管理者',superUser]]) test(`${name}は所属イベントの参加者・Round・結果CRUDと終了・再開を維持する`,()=>scenario(async()=>{
  await asUser(actor,async()=>{
    for(const [table,row] of protectedRows) assert.equal((await db.query(`select id from ${table} where id=$1`,[row])).rows.length,1);
    const e=id(2000), p=id(2001), r=id(2002), m=id(2003), mp=id(2004), result=id(2005);
    await db.query('insert into events(id,club_id,name,court_count,created_by_auth_user_id) values ($1,$2,$3,1,$4)',[e,clubA,'正常イベント',actor]);
    if([main,sub,superUser].includes(actor)) assert.equal((await db.query('update events set name=$1 where id=$2 returning id',['編集後',e])).rows.length,1);
    await db.query("insert into event_participants(id,event_id,guest_name,participant_type,status) values ($1,$2,'限定ゲスト','guest','active')",[p,e]);
    await db.query('insert into rounds(id,event_id,round_number) values ($1,$2,1)',[r,e]);
    await db.query('insert into matches(id,event_id,round_id,court_number) values ($1,$2,$3,1)',[m,e,r]);
    await db.query("insert into match_players(id,match_id,participant_id,team) values ($1,$2,$3,'A')",[mp,m,p]);
    await db.query("insert into match_results(id,match_id,score_a,score_b,winner_team) values ($1,$2,6,4,'A')",[result,m]);
    assert.equal((await db.query('update match_results set score_b=3 where id=$1 returning id',[result])).rows.length,1);
    assert.equal((await db.query("update events set status='closed',closed_at=now() where id=$1 returning id",[e])).rows.length,1);
    assert.equal((await db.query("update events set status='active',closed_at=null where id=$1 returning id",[e])).rows.length,1);
    for(const [table,row] of [['match_results',result],['match_players',mp],['matches',m],['rounds',r],['event_participants',p]]) assert.equal((await db.query(`delete from ${table} where id=$1 returning id`,[row])).rows.length,1);
  });
}));

test('個人イベントは作成者だけが管理でき、他人の作成者IDを偽装できない',()=>scenario(async()=>{
  await asUser(creator,async()=>{
    assert.equal((await db.query('select id from events where id=$1',[personal])).rows.length,1);
    await db.query("insert into event_participants(event_id,guest_name,participant_type,status) values ($1,'個人ゲスト','guest','active')",[personal]);
    await db.query('insert into rounds(event_id,round_number) values ($1,1)',[personal]);
    assert.equal((await db.query("update events set status='closed' where id=$1 returning id",[personal])).rows.length,1);
    assert.equal((await db.query("update events set status='active' where id=$1 returning id",[personal])).rows.length,1);
    await rejected('insert into events(name,court_count,created_by_auth_user_id) values ($1,1,$2)',['本人偽装',main]);
  });
  await asUser(member,async()=>{await zero('select id from events where id=$1',[personal]);await zero('update events set name=$1 where id=$2 returning id',['侵入',personal]);});
}));

test('新規グループ作成と本人の初回メイン管理者所属を維持し、他人の所有IDは拒否する',()=>scenario(async()=>{
  const c=id(2100);
  await asUser(outsider,async()=>{
    await db.query('insert into clubs(id,name,owner_id) values ($1,$2,$3)',[c,'新グループ',outsider]);
    await db.query("insert into club_members(club_id,profile_id,player_profile_id,role) values ($1,$2,$3,'main_admin')",[c,outsider,player(outsider)]);
    await rejected('insert into clubs(name,owner_id) values ($1,$2)',['所有ID偽装',main]);
    await rejected('insert into events(club_id,name,court_count,created_by_auth_user_id) values ($1,$2,1,$3)',[clubA,'他グループ',outsider]);
  });
}));

test('一般メンバー・他グループは役職昇格できず、サブ管理者はメイン管理者を変更できない',()=>scenario(async()=>{
  await asUser(member,async()=>{await zero("update club_members set role='main_admin' where id=$1 returning id",[id(202)]);});
  await asUser(otherMain,async()=>{await zero("update club_members set role='main_admin' where id=$1 returning id",[id(202)]);});
  await asUser(sub,async()=>{
    await zero("update club_members set is_active=false where id=$1 returning id",[id(200)]);
    await rejected("update club_members set role='main_admin' where id=$1 returning id",[id(201)]);
    assert.equal((await db.query("update club_members set role='sub_admin' where id=$1 returning id",[id(202)])).rows.length,1);
  });
}));

test('イベント・Round・試合・参加者・結果を別イベントへ付け替えず、偽の親を挿入できない',()=>scenario(async()=>{
  await asUser(superUser,async()=>{
    for(const [sql,args] of [
      ['update events set club_id=$1 where id=$2',[clubB,eventA]],
      ['update events set created_by_auth_user_id=$1 where id=$2',[outsider,eventA]],
      ['update rounds set event_id=$1 where id=$2',[eventB,roundA]],
      ['update matches set event_id=$1,round_id=$2 where id=$3',[eventB,roundB,matchA]],
      ['update matches set round_id=$1 where id=$2',[roundB,matchA]],
      ['update event_participants set event_id=$1 where id=$2',[eventB,participantA]],
      ['update match_players set match_id=$1 where id=$2',[matchB,matchPlayerA]],
      ['update match_players set participant_id=$1 where id=$2',[participantB,matchPlayerA]],
      ['update match_results set match_id=$1 where id=$2',[matchB,resultA]],
      ['update player_stats set club_id=$1 where id=$2',[clubB,statA]],
      ['insert into matches(event_id,round_id,court_number) values ($1,$2,3)',[eventA,roundB]],
      ["insert into match_players(match_id,participant_id,team) values ($1,$2,'B')",[matchA,participantB]],
    ]) await rejected(sql,args);
  });
}));

test('閉鎖済みイベントの子データは編集できず、再開後にスコアを修正できる',()=>scenario(async()=>{
  await asUser(member,async()=>{
    for(const [sql,args] of [
      ['insert into rounds(event_id,round_number) values ($1,2)',[closed]],
      ["insert into event_participants(event_id,guest_name,participant_type,status) values ($1,'終了後','guest','active')",[closed]],
      ['insert into matches(event_id,round_id,court_number) values ($1,$2,2)',[closed,closedRound]],
      ["insert into match_players(match_id,participant_id,team) values ($1,$2,'B')",[closedMatch,closedParticipant]],
      ["insert into match_results(match_id,score_a,score_b,winner_team) values ($1,1,0,'A')",[closedMatch]],
    ]) await rejected(sql,args);
    for(const [table,row] of [['event_participants',closedParticipant],['rounds',closedRound],['matches',closedMatch],['match_players',closedMatchPlayer],['match_results',closedResult]]) {
      await prevented(table==='matches' ? 'update matches set court_number=2 where id=$1 returning id' : `update ${table} set id=id where id=$1 returning id`,[row]);
      await prevented(`delete from ${table} where id=$1 returning id`,[row]);
    }
    assert.equal((await db.query('update matches set youtube_url=$1 where id=$2 returning id',['https://example.test/edited-video',closedMatch])).rows.length,1,'終了後も動画編集を維持');
    await db.query("update events set status='active' where id=$1",[closed]);
    assert.equal((await db.query('update match_results set score_b=2 where id=$1 returning id',[closedResult])).rows.length,1);
  });
}));

test('公開グループだけ一覧で確認でき、削除済みグループ・イベントを一般ユーザーへ返さない',()=>scenario(async()=>{
  await asUser(outsider,async()=>{
    assert.equal((await db.query('select id from clubs where id=$1',[publicClub])).rows.length,1);
    await zero('select id from clubs where id=$1',[deletedClub]);
    await zero('select id from events where id=$1',[deletedEvent]);
  });
}));

test('user_metadataと未認証JWTの役職文字列を権限判定に使用しない',()=>scenario(async()=>{
  await asUser(outsider,async()=>{
    await zero('select id from events where id=$1',[eventA]);
    await rejected('insert into rounds(event_id,round_number) values ($1,2)',[eventA]);
  },'authenticated',{user_metadata:{role:'super_user',club_id:clubA},app_metadata:{role:'main_admin'}});
}));

async function shared(token,actor=null,role='anon') {return asUser(actor,async()=>(await db.query('select public.get_shared_event($1) as result',[token])).rows[0].result,role);}
test('共有トークンで終了イベントの表示情報だけを取得し、直接APIで共有イベントを列挙できない',()=>scenario(async()=>{
  const value=await shared(sharedToken);assert(value);assert.equal(value.event.name,'共有する終了試合');assert.equal(value.matches.length,1);assert.equal(value.matches[0].result.score_a,6);assert.equal(value.participants[0].display_name,'試験選手2');assert.equal(value.videos.length,1);
  const forbidden=['linked_auth_user_id','created_by_auth_user_id','profile_id','player_profile_id','club_id','event_id','share_token','owner_id','email'];
  const inspect=value=>{if(Array.isArray(value))value.forEach(inspect);else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){assert(!forbidden.includes(k),`共有JSONの内部列: ${k}`);inspect(v);}};inspect(value);
  await asUser(null,async()=>{await prevented('select id from events where id=$1',[closed]);await prevented('select id from matches where id=$1',[closedMatch]);await prevented('select id from match_results where id=$1',[closedResult]);},'anon');
}));

test('不正・空・未終了・削除済み・公開停止後のトークンから共有情報を取得できない',()=>scenario(async()=>{
  for(const token of ['not-a-token','',null,'active-token','deleted-token'])assert.equal(await shared(token),null,`拒否するトークン: ${token}`);
  await db.query('update events set share_enabled=false where id=$1',[closed]);
  assert.equal(await shared(sharedToken),null);
  assert.equal(await shared(sharedToken,outsider,'authenticated'),null);
}));

test('共有トークンのローテーションで旧URLを失効させ、無関係なログインでも有効URLを表示できる',()=>scenario(async()=>{
  await asUser(main,async()=>db.query('update events set share_token=$1 where id=$2',['new-valid-token',closed]));
  assert.equal(await shared(sharedToken),null);
  assert.equal((await shared('new-valid-token',outsider,'authenticated')).event.name,'共有する終了試合');
}));

test('緊急適用済みの匿名書込権限撤回と公式戦無条件ポリシー削除を再現する',()=>scenario(async()=>{
  const grants=(await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and (has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE') or has_table_privilege('anon',c.oid,'DELETE'))")).rows;
  assert.deepEqual(grants,[]);
  const bad=(await db.query("select policyname from pg_policies where schemaname='public' and (policyname in ('official_events_access','official_matches_access','official_opponents_access') or (tablename=any($1) and policyname like 'dev_all_%'))",[['clubs','events','event_participants','rounds','matches','match_players','match_results','player_stats']])).rows;
  assert.deepEqual(bad,[]);
}));

test('チーム所属の偽挿入で他イベントの運営権限を取得できない',()=>scenario(async()=>{
  const isolatedTeam=id(2200), isolatedSide=id(2201);
  await db.query("insert into events(id,name,court_count,event_mode,created_by_auth_user_id) values ($1,'他人のチーム戦',1,'team',$2)",[isolatedTeam,main]);
  await db.query("insert into event_team_sides(id,event_id,side,club_id) values ($1,$2,'team_a',$3)",[isolatedSide,isolatedTeam,clubA]);
  await asUser(otherMain,async()=>{
    await rejected("insert into event_team_sides(event_id,side,club_id,team_name) values ($1,'team_b',$2,'偽の所属')",[eventA,clubB]);
    await rejected("insert into event_team_sides(event_id,side,club_id) values ($1,'team_b',$2)",[isolatedTeam,clubB]);
    await zero('update event_team_sides set club_id=$1 where id=$2 returning id',[clubB,isolatedSide]);
    await zero('select id from events where id=$1',[isolatedTeam]);
  });
  await asUser(sub,async()=>{
    await rejected('update event_team_sides set event_id=$1 where id=$2',[eventA,id(1200)]);
  });
}));

test('一般メンバーの設定変更とサブ管理者の削除を拒否し、管理者の共有と終了済み削除は維持する',()=>scenario(async()=>{
  await asUser(member,async()=>{
    await rejected('update events set name=$1 where id=$2',['無権限の名称',eventA]);
    await rejected('update events set share_enabled=false where id=$1',[closed]);
    await rejected('update events set is_deleted=true,deleted_at=now() where id=$1',[closed]);
  });
  await asUser(sub,async()=>{
    await rejected('update events set is_deleted=true,deleted_at=now() where id=$1',[closed]);
    assert.equal((await db.query('update events set share_enabled=false where id=$1 returning id',[closed])).rows.length,1);
    assert.equal((await db.query('update events set name=$1 where id=$2 returning id',['管理者が編集',eventA])).rows.length,1);
  });
  await asUser(main,async()=>assert.equal((await db.query('update events set is_deleted=true,deleted_at=now() where id=$1 returning id',[closed])).rows.length,1));
}));

test('本人プロフィール連携0039と動画クリックRPCの既存正常系を維持する',()=>scenario(async()=>{
  await asUser(member,async()=>{
    const own=(await db.query('select to_jsonb(ensure_my_player_profile($1,$2)) as value',['名前を上書きしない',player(member)])).rows[0].value;
    assert.equal(own.id,player(member));assert.equal(own.display_name,'試験選手2');
  });
  await asUser(null,async()=>{
    await db.query('select record_event_video_click($1,null,null)',[closedMatch]);
    await db.query('select record_event_video_link_click($1,null,null)',[id(1300)]);
  },'anon');
  assert.equal((await db.query('select count(*)::int as n from event_video_clicks where match_id=$1',[closedMatch])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int as n from event_video_link_clicks where event_video_link_id=$1',[id(1300)])).rows[0].n,1);
}));

test('切り戻しSQLをCOMMITしても業務データを変えず緊急修正を維持し、修正SQLを再適用できる',async()=>{
  const original=await state();
  await db.exec(maintenance('04_rollback.sql').replace(/rollback;\s*$/,'commit;'));
  assert.deepEqual(await state(),original);
  assert.equal((await db.query("select to_regprocedure('public.get_shared_event(text)') as rpc")).rows[0].rpc,null);
  const bad=(await db.query("select policyname from pg_policies where schemaname='public' and policyname in ('official_events_access','official_matches_access','official_opponents_access')")).rows;
  assert.deepEqual(bad,[]);
  assert.equal((await db.query("select has_table_privilege('anon','public.events','INSERT') as allowed")).rows[0].allowed,false);
  for(const saved of (await db.query('select * from security_p0_backup_20261026.stats_identity_constraints')).rows) {
    const restored=(await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.player_stats'::regclass and conname=$1",[saved.conname])).rows[0];
    assert.equal(restored.definition,saved.definition,'元のアカウント用FKを復元する');
  }
  for(const sql of securityMigrations) await db.exec(sql);
  await db.exec(maintenance('03_verify.sql'));
  assert.deepEqual(await state(),original);
});

test('有効な所属選手だけを自動反映し、グループ別集計を更新できる',()=>scenario(async()=>{
  await asUser(member,async()=>{
    await db.query("insert into event_participants(event_id,player_profile_id,participant_type,status) values ($1,$2,'member','active')",[activeShared,player(sub)]);
    await rejected("insert into event_participants(event_id,player_profile_id,participant_type,status) values ($1,$2,'member','active')",[eventA,player(otherMain)]);
    await rejected("insert into event_participants(event_id,profile_id,participant_type,status) values ($1,$2,'member','active')",[eventA,otherMain]);
    await db.query('insert into player_stats(club_id,profile_id,match_count,win_count) values ($1,$2,3,2)',[clubA,sub]);
    assert.equal((await db.query('update player_stats set match_count=3,win_count=2 where id=$1 returning id',[statA])).rows.length,1);
    await rejected('insert into player_stats(club_id,profile_id) values ($1,$2)',[clubA,otherMain]);
    await rejected('insert into player_stats(profile_id) values ($1)',[member]);
  });
}));

test('本人承認による0039の統合は閉鎖済みイベント参照も維持する',()=>scenario(async()=>{
  const provisional=id(2300);
  const provisionalMember=await asUser(main,async()=>(await db.query('select add_provisional_club_member($1,$2,$3) as id',[clubA,'連携前の選手',provisional])).rows[0].id);
  await db.query("insert into event_participants(event_id,player_profile_id,participant_type,status) values ($1,$2,'member','active')",[closed,provisional]);
  const request=await asUser(main,async()=>(await db.query('select request_player_profile_link($1,$2,$3) as id',[clubA,provisionalMember,outsider])).rows[0].id);
  await asUser(outsider,async()=>{
    const preview=(await db.query('select get_player_profile_link_request($1) as value',[request])).rows[0].value;
    const result=(await db.query("select review_player_profile_link($1,'approved',$2) as value",[request,preview.review_token])).rows[0].value;
    assert.equal(result.status,'approved');
  });
  assert.equal((await db.query('select player_profile_id from event_participants where event_id=$1 and player_profile_id=$2',[closed,player(outsider)])).rows.length,1);
  assert.equal((await db.query('select count(*)::int n from player_profile_merges')).rows[0].n,1);
}));

test('既存のis_active復帰用手順を適用済みでstatus列がなくてもイベントを運営できる',()=>scenario(async()=>{
  const membershipSql=readFileSync(join(__dirname,'../supabase/maintenance/group-members/02_use_is_active.sql'),'utf8')
    .replace(/^begin;$/m,'').replace(/rollback;\s*$/,'');
  await db.exec(membershipSql);
  await db.exec('alter table club_members drop column status');
  await asUser(staleStatus,async()=>{
    assert.equal((await db.query('select id from events where id=$1',[eventA])).rows.length,1);
    await db.query("insert into event_participants(event_id,player_profile_id,participant_type,status) values ($1,$2,'member','active')",[eventA,player(staleStatus)]);
    await db.query('insert into rounds(event_id,round_number) values ($1,2)',[eventA]);
  });
  await asUser(inactive,async()=>zero('select id from events where id=$1',[eventA]));
}));

test('個人イベントの旧本人ID登録を維持し、ゲストへの他人の内部ID指定を拒否する',()=>scenario(async()=>{
  await asUser(creator,async()=>{
    await db.query("insert into event_participants(event_id,profile_id,participant_type,status) values ($1,$2,'member','active')",[personal,creator]);
    await rejected("insert into event_participants(event_id,profile_id,participant_type,status) values ($1,$2,'member','active')",[personal,member]);
    await rejected("insert into event_participants(event_id,player_profile_id,participant_type,status) values ($1,$2,'guest','active')",[personal,player(member)]);
  });
}));

test('チーム戦の両サイド管理・共有表示と公式戦の登録閲覧を維持する',()=>scenario(async()=>{
  await asUser(otherMain,async()=>{
    assert.equal((await db.query('update event_team_sides set team_name=$1 where id=$2 returning id',['更新チーム名',id(1201)])).rows.length,1);
    await db.query("insert into event_team_matches(event_id,team_a_player1_profile_id,team_a_player2_guest_name,team_b_player1_guest_name,team_b_player2_guest_name,team_a_score,team_b_score,result) values ($1,$2,'A2','B1','B2',6,4,'win')",[teamEvent,player(member)]);
    await db.query("update events set status='closed',share_enabled=true,share_token='team-share-token' where id=$1",[teamEvent]);
  });
  const team=await shared('team-share-token');assert.equal(team.team_matches.length,1);assert.equal(team.team_matches[0].team_a_player1_guest_name,'試験選手2');
  const official=id(2400), opponent=id(2401), officialMatch=id(2402);
  await asUser(main,async()=>{
    await db.query("insert into official_events(id,club_id,title,created_by_auth_user_id) values ($1,$2,'公式戦',$3)",[official,clubA,main]);
    await db.query("insert into official_opponents(id,official_event_id,opponent_team_name) values ($1,$2,'相手')",[opponent,official]);
    await db.query("insert into official_matches(id,official_event_id,official_opponent_id,match_order,our_player1_profile_id) values ($1,$2,$3,1,$4)",[officialMatch,official,opponent,player(member)]);
    assert.equal((await db.query('update official_matches set our_score=6,opponent_score=4 where id=$1 returning id',[officialMatch])).rows.length,1);
  });
  await asUser(member,async()=>assert.equal((await db.query('select id from official_matches where id=$1',[officialMatch])).rows.length,1));
  await asUser(outsider,async()=>zero('select id from official_matches where id=$1',[officialMatch]));
}));

test('スーパー管理者の開催中削除とメイン管理者のグループ無効化を維持する',()=>scenario(async()=>{
  await asUser(superUser,async()=>assert.equal((await db.query('update events set is_deleted=true,deleted_at=now() where id=$1 returning id',[eventA])).rows.length,1));
  await asUser(main,async()=>db.query('update clubs set is_active=false where id=$1',[clubA]));
  assert.equal((await db.query('select is_active from clubs where id=$1',[clubA])).rows[0].is_active,false);
}));

test('バックアップ後に列を追加した別作業があれば切り戻しを中止する',()=>scenario(async()=>{
  await db.exec('alter table clubs add column changed_after_backup text');
  await assert.rejects(db.exec(maintenance('04_rollback.sql')),/バックアップ後に列が追加/);
}));

test('参加者の旧アカウントIDと選手IDのみの両形式で戦績INSERT・UPDATEできる',()=>scenario(async()=>{
  const unlinkedPlayer=id(2500);
  await asUser(main,async()=>db.query('select add_provisional_club_member($1,$2,$3)',[clubA,'未連携の所属選手',unlinkedPlayer]));
  await db.query("insert into club_members(club_id,profile_id,role) values ($1,$2,'member')",[clubA,outsider]);
  await asUser(main,async()=>{
    for(const [accountId,playerId] of [[outsider,null],[null,player(linkedMember)],[null,unlinkedPlayer]]) {
      const participant=(await db.query("insert into event_participants(event_id,profile_id,player_profile_id,participant_type,status) values ($1,$2,$3,'member','active') returning profile_id,player_profile_id",[eventA,accountId,playerId])).rows[0];
      // 画面のprofileMapと同じ優先順位。IDの移管や偽アカウント作成をしない。
      const statsId=participant.profile_id??participant.player_profile_id;
      const stat=(await db.query('insert into player_stats(club_id,profile_id,match_count,win_count) values ($1,$2,1,1) returning id',[clubA,statsId])).rows[0];
      assert.equal((await db.query('update player_stats set match_count=2 where id=$1 returning id',[stat.id])).rows.length,1);
    }
    assert.equal((await db.query('update player_stats set match_count=3 where id=$1 returning id',[statA])).rows.length,1,'既存アカウント形式も維持');
  });
  assert.equal((await db.query('select id from profiles where id=any($1::uuid[])',[[player(linkedMember),unlinkedPlayer]])).rows.length,0,'保存のためのアカウント行を作らない');
}));

test('戦績の他グループ・未所属・無効所属・無効選手IDを拒否する',()=>scenario(async()=>{
  const inactivePlayer=id(2510);
  await db.query("insert into player_profiles(id,display_name,is_active) values ($1,'無効選手',true)",[inactivePlayer]);
  await db.query("insert into club_members(club_id,player_profile_id,role) values ($1,$2,'member')",[clubA,inactivePlayer]);
  await db.query('update player_profiles set is_active=false where id=$1',[inactivePlayer]);
  await asUser(main,async()=>{
    for(const invalidId of [player(otherMain),otherMain,player(outsider),outsider,player(inactive),inactive,inactivePlayer,id(9999)]) {
      await rejected('insert into player_stats(club_id,profile_id) values ($1,$2)',[clubA,invalidId]);
      assert.equal((await db.query('select security_private.valid_stats_profile($1,$2) as valid',[clubA,invalidId])).rows[0].valid,false);
    }
  });
  await db.query('update club_members set is_active=false where id=$1',[id(202)]);
  await asUser(main,async()=>zero('update player_stats set match_count=999 where id=$1 returning id',[statA]));
  assert.equal((await db.query('select match_count from player_stats where id=$1',[statA])).rows[0].match_count,2);
}));

test('NULLグループの旧戦績は適用・再適用でも不変で、一般ユーザーには表示しない',()=>scenario(async()=>{
  // beforeフックが、この行を含む全行の適用・再適用・切り戻し予行での不変を検証済み。
  const saved=(await db.query('select club_id,profile_id,match_count,win_count from player_stats where id=$1',[legacyNullStat])).rows[0];
  assert.deepEqual(saved,{club_id:null,profile_id:member,match_count:42,win_count:30});
  await asUser(member,async()=>zero('select id from player_stats where id=$1',[legacyNullStat]));
  await asUser(superUser,async()=>{
    assert.equal((await db.query('select id from player_stats where id=$1',[legacyNullStat])).rows.length,1);
    await zero('update player_stats set match_count=999 where id=$1 returning id',[legacyNullStat]);
  });
}));

test('チーム管理者でも第三者グループへの所属変更と削除・再登録の迂回を拒否する',()=>scenario(async()=>{
  await asUser(main,async()=>{
    await rejected('update event_team_sides set club_id=$1 where id=$2',[publicClub,id(1200)]);
    await zero('delete from event_team_sides where id=$1 returning id',[id(1200)]);
    await rejected("insert into event_team_sides(event_id,side,club_id) values ($1,'team_a',$2)",[teamEvent,publicClub]);
  });
  await asUser(otherMain,async()=>{
    await rejected('update event_team_sides set club_id=$1 where id=$2',[clubB,id(1200)]);
    await rejected('update event_team_sides set club_id=$1 where id=$2',[publicClub,id(1201)]);
    await rejected('update event_team_sides set club_id=null where id=$1',[id(1200)]);
  });
  assert.equal((await db.query('select club_id from event_team_sides where id=$1',[id(1200)])).rows[0].club_id,clubA);
}));

test('チーム戦の新規作成・相手サイド登録・双方の管理者による名称編集を維持する',()=>scenario(async()=>{
  const created=id(2520), sideA=id(2521), sideB=id(2522);
  await asUser(main,async()=>{
    await db.query("insert into events(id,club_id,name,court_count,event_mode,stats_mode,created_by_auth_user_id) values ($1,$2,'作成テスト',1,'team','undecided',$3)",[created,clubA,main]);
    await db.query("insert into event_team_sides(id,event_id,side,club_id,team_name) values ($1,$2,'team_a',$3,'A'),($4,$2,'team_b',$5,'B')",[sideA,created,clubA,sideB,clubB]);
    assert.equal((await db.query('update event_team_sides set team_name=$1 where id=$2 returning id',['相手サイドの名称',sideB])).rows.length,1);
  });
  await asUser(otherMain,async()=>{
    assert.equal((await db.query('update event_team_sides set team_name=$1 where id=$2 returning id',['相手管理者が編集',sideA])).rows.length,1);
    assert.equal((await db.query('update event_team_sides set team_name=$1 where id=$2 returning id',['自サイドの名称',sideB])).rows.length,1);
  });
  await asUser(main,async()=>{
    await db.query("update events set status='closed' where id=$1",[created]);
    assert.equal((await db.query('delete from events where id=$1 returning id',[created])).rows.length,1);
  });
  assert.equal((await db.query('select id from event_team_sides where event_id=$1',[created])).rows.length,0,'イベント削除の連動削除を維持');
}));

test('変更元・変更先の両グループの管理権限があれば所属変更とグループなしへの変更を許可する',()=>scenario(async()=>{
  // 作成画面と同じく主催グループを親イベントに保持する。
  await db.query('update events set club_id=$1 where id=$2',[clubA,teamEvent]);
  await db.query("insert into club_members(club_id,profile_id,player_profile_id,role) values ($1,$2,$3,'sub_admin')",[publicClub,main,player(main)]);
  await asUser(main,async()=>{
    assert.equal((await db.query('update event_team_sides set club_id=$1 where id=$2 returning id',[publicClub,id(1200)])).rows.length,1);
    assert.equal((await db.query('update event_team_sides set club_id=null where id=$1 returning id',[id(1200)])).rows.length,1);
    assert.equal((await db.query('update event_team_sides set club_id=$1 where id=$2 returning id',[clubA,id(1200)])).rows.length,1);
  });
}));

test('旧FKのアカウント削除時の後処理と選手ID削除時の後処理を維持する',()=>scenario(async()=>{
  await asUser(main,async()=>db.query('insert into player_stats(club_id,profile_id) values ($1,$2)',[clubA,player(linkedMember)]));
  await db.query('delete from player_profiles where id=$1',[player(linkedMember)]);
  assert.equal((await db.query('select id from player_stats where profile_id=$1',[player(linkedMember)])).rows.length,0);
  await db.query('delete from profiles where id=$1',[member]);
  assert.equal((await db.query('select id from player_stats where profile_id=$1',[member])).rows.length,0);
}));

test('新規の選手ID戦績を旧FKへ戻せない場合は、切り戻しでデータを削除しない',()=>scenario(async()=>{
  await asUser(main,async()=>db.query('insert into player_stats(club_id,profile_id) values ($1,$2)',[clubA,player(linkedMember)]));
  const beforeRollback=await state();
  await db.exec('savepoint unsafe_restore');
  await assert.rejects(db.exec(maintenance('04_rollback.sql')),/旧アカウント用FKへ戻せない/);
  await db.exec('rollback to savepoint unsafe_restore; release savepoint unsafe_restore');
  assert.deepEqual(await state(),beforeRollback);
}));

test('未連携選手の新ID戦績がある場合は0039の既存ガードが統合を中止しデータを維持する',()=>scenario(async()=>{
  const provisional=id(2530);
  const provisionalMember=await asUser(main,async()=>(await db.query('select add_provisional_club_member($1,$2,$3) as id',[clubA,'戦績のある仮選手',provisional])).rows[0].id);
  const request=await asUser(main,async()=>{
    await db.query('insert into player_stats(club_id,profile_id) values ($1,$2)',[clubA,provisional]);
    return (await db.query('select request_player_profile_link($1,$2,$3) as id',[clubA,provisionalMember,outsider])).rows[0].id;
  });
  const beforeApproval=await state();
  await asUser(outsider,async()=>{
    const preview=(await db.query('select get_player_profile_link_request($1) as value',[request])).rows[0].value;
    await rejected("select review_player_profile_link($1,'approved',$2)",[request,preview.review_token],/旧profile_id/);
  });
  assert.deepEqual(await state(),beforeApproval);
}));
