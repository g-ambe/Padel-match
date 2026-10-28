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
insert into player_stats(id,club_id,profile_id,match_count,win_count) values ('${statA}','${clubA}','${member}',2,2),('${statB}','${clubB}','${otherMain}',1,1),('${legacyNullStat}',null,'${member}',42,30);
insert into event_video_links(id,event_id,title,video_url) values ('${id(1300)}','${closed}','全試合動画','https://example.test/all-video');
`;
let db,securityMigrations;
async function fingerprints(){const tables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;const out={};for(const {tablename} of tables)out[tablename]=(await db.query("select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) value from public."+tablename+' t')).rows[0].value;return out;}
before(async()=>{db=new PGlite();await db.exec(initial);const files=readdirSync(migrationDir).filter(f=>f.endsWith('.sql')).sort();
for(const file of files.filter(f=>f<'0039'))await db.exec(readFileSync(join(migrationDir,file),'utf8').replace(/create extension if not exists (?:"uuid-ossp"|pgcrypto);/g,''));
await db.exec('grant all on all tables in schema public to anon,authenticated');await db.exec(readFileSync(join(migrationDir,'0039_player_profile_consent_linking.sql'),'utf8'));await db.exec(seed);
await db.exec("insert into match_results(match_id,score_a,score_b,winner_team) values(null,6,4,'A'),(null,4,6,'B')"); // 旧孤立行も適用時に削除・補正しない。
await db.exec(maintenance('01_preflight.sql'));await db.exec(maintenance('02_backup.sql'));
securityMigrations=files.filter(f=>f.startsWith('20261027')).map(f=>readFileSync(join(migrationDir,f),'utf8'));const original=await fingerprints();for(const sql of securityMigrations)await db.exec(sql);assert.deepEqual(await fingerprints(),original,'適用で全業務行が不変');for(const sql of securityMigrations)await db.exec(sql);assert.deepEqual(await fingerprints(),original,'再適用で全業務行が不変');
await db.exec(maintenance('03_verify.sql'));await db.exec(maintenance('04_rollback.sql'));
assert.deepEqual(await fingerprints(),original,'切り戻し予行で全業務行が不変');
await db.exec(maintenance('04_rollback.sql').replace(/rollback;\s*$/,'commit;'));
assert.deepEqual(await fingerprints(),original,'切り戻しCOMMITで全業務行が不変');
for(const sql of securityMigrations)await db.exec(sql);
});
after(async()=>{if(db)await db.close();});
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

for(const [name,actor,role] of [['匿名',null,'anon'],['無関係ログイン',outsider,'authenticated'],['別グループ管理者',otherMain,'authenticated'],['退会メンバー',inactive,'authenticated']]) test(`${name}は非公開の親子7テーブルを参照・更新・削除できない`,()=>scenario(async()=>{
  await asUser(actor,async()=>{
    for(const [table,row] of protectedRows){
      if(role==='anon') await prevented(`select id from ${table} where id=$1`,[row]); else await zero(`select id from ${table} where id=$1`,[row]);
      if(role==='anon' || table==='player_stats') {
        await rejected(`update ${table} set id=id where id=$1 returning id`,[row]);
        await rejected(`delete from ${table} where id=$1 returning id`,[row]);
      } else {
        await prevented(`update ${table} set id=id where id=$1 returning id`,[row]);
        await prevented(`delete from ${table} where id=$1 returning id`,[row]);
      }
    }
    if(role==='anon') await prevented('select id from clubs where id=$1',[clubA]);
    else if(actor===inactive) assert.equal((await db.query('select id from clubs where id=$1',[clubA])).rows.length,1,'本人の過去の所属概要は参照できる');
    else await zero('select id from clubs where id=$1',[clubA]);
    await rejected('insert into events(club_id,name,court_count,created_by_auth_user_id) values ($1,$2,1,$3)',[clubA,'不正イベント',actor]);
    await rejected('insert into rounds(event_id,round_number) values ($1,22)',[eventA]);
    await rejected('insert into event_participants(event_id,guest_name,status,participant_type) values ($1,$2,$3,$4)',[eventA,'不正ゲスト','active','guest']);
    await rejected('insert into matches(event_id,round_id,court_number) values ($1,$2,2)',[eventA,roundA]);
    await rejected('insert into match_players(match_id,participant_id,team) values ($1,$2,$3)',[matchA,participantA,'B']);
    await rejected('insert into match_results(match_id,score_a,score_b,winner_team) values ($1,1,0,$2)',[matchA,'A']);
    await rejected('insert into player_stats(club_id,profile_id) values ($1,$2)',[clubA,outsider]);
  },role);
}));

test('個人イベントは作成者だけが管理でき、他人の作成者IDを偽装できない',()=>scenario(async()=>{
  await createPlayable(creator,player(creator),personal);
  await asUser(creator,async()=>{
    assert.equal((await db.query('select id from events where id=$1',[personal])).rows.length,1);
    await db.query("insert into event_participants(event_id,guest_name,participant_type,status) values ($1,'個人ゲスト','guest','active')",[personal]);
    assert.equal((await db.query("update events set status='closed' where id=$1 returning id",[personal])).rows.length,1);
    assert.equal((await db.query("update events set status='active' where id=$1 returning id",[personal])).rows.length,1);
    await rejected('insert into events(name,court_count,created_by_auth_user_id) values ($1,1,$2)',['本人偽装',main]);
  });
  await asUser(member,async()=>{await zero('select id from events where id=$1',[personal]);await zero('update events set name=$1 where id=$2 returning id',['侵入',personal]);});
}));

test('新規グループ作成と本人の初回メイン管理者所属を維持し、他人の所有IDは拒否する',()=>scenario(async()=>{
  const c=id(2100);
  await asUser(outsider,async()=>{
    await db.query("select create_friendly_group($1,'新グループ',null,'private')",[c]);
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
  await db.query("insert into club_members(id,club_id,profile_id,player_profile_id,role) values ($1,$2,$3,$4,'sub_admin')",[id(2523),clubB,main,player(main)]);
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
    await prevented('delete from events where id=$1 returning id',[created]);
    await db.query('update events set is_deleted=true where id=$1',[created]);
  });
  assert.equal((await db.query('select id from event_team_sides where event_id=$1',[created])).rows.length,2,'論理削除で所属履歴を維持');
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

test('Roundの2試合目で失敗しても1試合目・Round・参加枠を残さない',()=>scenario(async()=>{
  const game=await createPlayable(), before=await state();
  const extra=[...game.cards,{court:2,teamA:[participantB,id(9998)],teamB:[id(9997),id(9996)]}];
  await asUser(member,async()=>rejected('select create_friendly_round($1,$2,$3,$4)',[eventA,game.expected+1,JSON.stringify(extra),id(generatedId++)]));
  assert.deepEqual(await state(),before);
}));

test('Round再送・競合・組合せの途中失敗を原子的に処理する',()=>scenario(async()=>{
  const game=await createPlayable();
  const replay=await asUser(member,async()=>(await db.query('select create_friendly_round($1,$2,$3,$4) value',[eventA,game.expected,JSON.stringify(game.cards),game.request])).rows[0].value);
  assert.deepEqual(replay,game.round);
  await asUser(sub,async()=>rejected('select create_friendly_round($1,$2,$3,$4)',[eventA,game.expected,JSON.stringify(game.cards),id(generatedId++)],/先にRound/));
  const before=await state();
  await asUser(member,async()=>rejected('select set_friendly_lineup($1,$2,$3,$4)',[eventA,game.match,JSON.stringify([game.participantIds[0],game.participantIds[1],participantB,id(9999)]),id(generatedId++)]));
  assert.deepEqual(await state(),before);
}));

test('第三者グループのINSERTを拒否し、管理グループの相手登録と双方の操作を許可する',()=>scenario(async()=>{
  const eid=id(6120);
  await db.query("insert into events(id,club_id,name,court_count,event_mode,created_by_auth_user_id) values ($1,$2,'相手登録',1,'team',$3)",[eid,clubA,main]);
  await asUser(main,async()=>{
    await rejected("insert into event_team_sides(event_id,side,club_id) values ($1,'team_b',$2)",[eid,clubB]);
    await rejected("insert into event_team_sides(event_id,side,club_id) values ($1,'team_b',$2)",[eid,publicClub]);
    await db.query("insert into event_team_sides(event_id,side,club_id) values ($1,'team_a',$2)",[eid,clubA]);
    await db.query("insert into event_team_sides(event_id,side,team_name) values ($1,'team_b','グループなしの対戦相手')",[eid]);
  });
  await asUser(otherMain,async()=>rejected('insert into event_team_matches(event_id,team_a_score,team_b_score) values ($1,6,4)',[eid]));
}));

test('グループと管理者は同時に作成され再送でも重複せず途中失敗も残らない',()=>scenario(async()=>{
  const request=id(6200);
  await asUser(outsider,async()=>{
    const first=(await db.query('select create_friendly_group($1,$2,null,$3) value',[request,'原子的な作成','private'])).rows[0].value;
    const replay=(await db.query('select create_friendly_group($1,$2,null,$3) value',[request,'原子的な作成','private'])).rows[0].value;
    assert.deepEqual(first,replay);
  });
  assert.equal((await db.query("select count(*)::int n from club_members where club_id=$1 and role='main_admin'",[request])).rows[0].n,1);
  await db.exec("create function public.reject_test_member() returns trigger language plpgsql as $$begin raise exception '試験用の管理者登録失敗'; end$$; create trigger test_member_failure before insert on club_members for each row execute function reject_test_member();");
  await asUser(outsider,async()=>rejected('select create_friendly_group($1,$2,null,$3)',[id(6201),'失敗する作成','private'],/試験用/));
  assert.equal((await db.query('select count(*)::int n from clubs where id=$1',[id(6201)])).rows[0].n,0);
}));

test('チーム作成もイベント・両サイドを同時に保存し不正な相手指定や途中失敗を残さない',()=>scenario(async()=>{
  const request=id(6210), sides=[{side:'team_a',club_id:clubA,team_name:'A'},{side:'team_b',club_id:null,team_name:'正当な自由入力の相手'}];
  await asUser(main,async()=>{
    const result=(await db.query('select create_friendly_team($1,$2,null,null,$3) value',[request,'チーム作成',JSON.stringify(sides)])).rows[0].value;
    assert.equal(result.event_id,request);
    assert.deepEqual((await db.query('select create_friendly_team($1,$2,null,null,$3) value',[request,'チーム作成',JSON.stringify(sides)])).rows[0].value,result);
    await rejected('select create_friendly_team($1,$2,null,null,$3)',[id(6211),'不正な相手',JSON.stringify([sides[0],{...sides[1],club_id:clubB}])]);
  });
  assert.equal((await db.query('select count(*)::int n from event_team_sides where event_id=$1',[request])).rows[0].n,2);
  assert.equal((await db.query('select count(*)::int n from events where id=$1',[id(6211)])).rows[0].n,0);
  await db.exec("create function public.reject_test_side() returns trigger language plpgsql as $$begin if new.side='team_b' then raise exception '試験用の相手登録失敗'; end if; return new; end$$; create trigger test_side_failure before insert on event_team_sides for each row execute function reject_test_side();");
  await asUser(main,async()=>rejected('select create_friendly_team($1,$2,null,null,$3)',[id(6212),'途中失敗',JSON.stringify(sides)],/試験用/));
  assert.equal((await db.query('select count(*)::int n from events where id=$1',[id(6212)])).rows[0].n,0);
}));

test('別参加IDでも同じ選手を同じRoundへ重複登録できない',()=>scenario(async()=>{
  const game=await createPlayable(), alias=id(6230);
  await db.query("insert into event_participants(id,event_id,profile_id,participant_type,status) values ($1,$2,$3,'member','active')",[alias,eventA,member]);
  const cards=[{court:1,teamA:[game.participantIds[0],alias],teamB:game.participantIds.slice(2)}], before=await state();
  await asUser(member,async()=>rejected('select create_friendly_round($1,$2,$3,$4)',[eventA,game.expected+1,JSON.stringify(cards),id(generatedId++)],/同一選手/));
  assert.deepEqual(await state(),before);
}));

test('戦績のない旧版の加入同意は書き換えずに管理者承認を維持できる',()=>scenario(async()=>{
  const source=id(6240);
  await db.query("update clubs set visibility='public' where id=$1",[clubA]);
  const cm=await asUser(main,async()=>(await db.query('select add_provisional_club_member($1,$2,$3) id',[clubA,'加入申請の仮選手',source])).rows[0].id);
  const request=await asUser(outsider,async()=>{
    const preview=(await db.query('select preview_profile_join($1,$2) value',[clubA,cm])).rows[0].value;
    return (await db.query("select submit_profile_join_request($1,$2,'本人同意',$3) id",[clubA,cm,preview.review_token])).rows[0].id;
  });
  await db.query("update join_requests set consent_snapshot=consent_snapshot-'player_stats' where id=$1",[request]);
  const approval=await asUser(main,async()=>(await db.query("select review_profile_join_request($1,'approved') value",[request])).rows[0].value);
  assert.equal(approval.status,'approved');
  assert.equal((await db.query('select player_profile_id from club_members where id=$1',[cm])).rows[0].player_profile_id,player(outsider));
}));
let generatedId=3000;
async function createPlayable(actor=member, playerId=player(member), event=eventA) {
  const participantIds=[];
  for(let i=0;i<4;i++) {
    const pid=id(generatedId++); participantIds.push(pid);
    await db.query("insert into event_participants(id,event_id,player_profile_id,guest_name,participant_type,status) values ($1,$2,$3,$4,$5,'active')",[pid,event,i===0?playerId:null,i===0?null:`限定ゲスト${i}`,i===0?'member':'guest']);
  }
  const expected=(await db.query('select coalesce(max(round_number),0)::int n from rounds where event_id=$1',[event])).rows[0].n;
  const request=id(generatedId++), cards=[{court:1,teamA:participantIds.slice(0,2),teamB:participantIds.slice(2)}];
  const round=await asUser(actor,async()=>(await db.query('select create_friendly_round($1,$2,$3,$4) as value',[event,expected,JSON.stringify(cards),request])).rows[0].value);
  const match=(await db.query('select id from matches where round_id=$1',[round.round_id])).rows[0].id;
  return {event,match,round,expected,cards,request,participantIds};
}
async function saveResult(game,a,b,actor=member,request=id(generatedId++)) {
  return asUser(actor,async()=>(await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values ($1,$2,$3,'A') on conflict(match_id) do update set score_a=excluded.score_a,score_b=excluded.score_b returning id",[game.match,a,b])).rows[0]);
}

async function state(){return fingerprints();}
function maintenance(name){return readFileSync(join(__dirname,'../supabase/maintenance/minimal-security',name),'utf8');}
async function shared(token,actor=null,role='anon'){return asUser(actor,async()=>(await db.query('select public.get_shared_event($1) result',[token])).rows[0].result,role);}

async function totals(who){return (await db.query(`select count(distinct m.id)::int played,count(distinct m.id) filter(where r.winner_team=mp.team)::int wins
 from matches m join match_results r on r.match_id=m.id join events e on e.id=m.event_id
 join match_players mp on mp.match_id=m.id join event_participants ep on ep.id=mp.participant_id
 where e.club_id=$1 and not e.is_deleted and e.stats_mode='official' and m.completed
 and coalesce(ep.player_profile_id,security_private.player_id(ep.profile_id))=$2`,[clubA,who])).rows[0];}

for(const [label,actor] of [['一般',member],['サブ',sub],['メイン',main],['選手ID所属',linkedMember],['旧状態列を持つ復帰者',staleStatus],['スーパー',superUser]])
test(`${label}のRound・スコア再送・編集・削除が動き、旧累計は変更しない`,()=>scenario(async()=>{
 const original=(await db.query('select to_jsonb(s) value from player_stats s order by id')).rows;
 const game=await createPlayable(actor);
 await saveResult(game,6,4,actor);await saveResult(game,6,4,actor);
 assert.deepEqual(await totals(player(member)),{played:3,wins:3});
 await saveResult(game,4,6,actor);assert.deepEqual(await totals(player(member)),{played:3,wins:2});
 await saveResult(game,0,0,actor);assert.deepEqual(await totals(player(member)),{played:3,wins:2});
 assert.equal((await db.query('select count(*)::int n from match_results where match_id=$1',[game.match])).rows[0].n,1);
 await asUser(actor,async()=>db.query('select delete_friendly_match($1,$2,$3)',[eventA,game.match,id(generatedId++)]));
 assert.deepEqual(await totals(player(member)),{played:2,wins:2});
 assert.deepEqual((await db.query('select to_jsonb(s) value from player_stats s order by id')).rows,original);
}));

test('旧累計に不一致やNULL所属があっても新しいスコア・終了・再開を止めない',()=>scenario(async()=>{
 await db.query('update player_stats set match_count=99,win_count=70 where id=$1',[statA]);
 const saved=(await db.query('select to_jsonb(s) value from player_stats s order by id')).rows;
 const game=await createPlayable();await saveResult(game,6,4);await saveResult(game,4,6);
 await asUser(member,async()=>{await db.query("update events set status='closed' where id=$1",[eventA]);await db.query("update events set status='active' where id=$1",[eventA]);});
 assert.deepEqual((await db.query('select to_jsonb(s) value from player_stats s order by id')).rows,saved);
}));

test('完了状態の更新に失敗すれば結果も同時にロールバックする',()=>scenario(async()=>{
 const game=await createPlayable();
 await db.exec(`create function public.fixture_fail_complete() returns trigger language plpgsql as $$begin if new.completed then raise exception '架空の保存失敗'; end if;return new;end $$;
 create trigger fixture_fail before update on matches for each row execute function public.fixture_fail_complete();`);
 await asUser(member,async()=>rejected("insert into match_results(match_id,score_a,score_b,winner_team) values ($1,6,4,'A')",[game.match],/架空/));
 assert.equal((await db.query('select completed from matches where id=$1',[game.match])).rows[0].completed,false);
 assert.equal((await db.query('select count(*)::int n from match_results where match_id=$1',[game.match])).rows[0].n,0);
}));

test('公開名と画像は検索でき、非公開のプロフィール詳細・メール・所属は列挙できない',()=>scenario(async()=>{
 await db.query("update player_profiles set display_name='同名の選手',bio='非公開の自己紹介',activity_area='非公開地域' where id=any($1::uuid[])",[[player(main),player(otherMain)]]);
 for(const [actor,role] of [[null,'anon'],[outsider,'authenticated']])await asUser(actor,async()=>{
   const directory=(await db.query("select * from public_player_profiles where display_name='同名の選手'")).rows;
   assert.equal(directory.length,2);assert.deepEqual(Object.keys(directory[0]).sort(),['avatar_url','display_name','id']);
   await prevented('select role from club_members where club_id=$1',[clubA]);
   await rejected('select bio,activity_area from player_profiles');await rejected('select email from profiles');
   await rejected('select owner_id from clubs');
 },role);
 await asUser(member,async()=>{
   await rejected('select bio from player_profiles where id=$1',[player(main)]);
   assert.equal((await db.query('select id from player_profiles where id=$1',[player(main)])).rows.length,1);
 });
}));

test('本人用プロフィール取得・保存は他人のIDや連携列を受け付けない',()=>scenario(async()=>{
 await asUser(member,async()=>{
   const own=(await db.query('select to_jsonb(p) value from get_my_player_profiles() p')).rows;
   assert.equal(own.length,1);assert.equal(own[0].value.id,player(member));
   await rejected('select save_my_player_profile($1,$2,$3)',[player(main),JSON.stringify({bio:'偽装'}),JSON.stringify({bio:null})]);
   await rejected('select save_my_player_profile($1,$2,$3)',[player(member),JSON.stringify({linked_auth_user_id:main}),JSON.stringify({linked_auth_user_id:member})]);
   const changed=(await db.query('select to_jsonb(save_my_player_profile($1,$2,$3)) value',[player(member),JSON.stringify({bio:'本人の詳細'}),JSON.stringify({bio:null})])).rows[0].value;
   assert.equal(changed.bio,'本人の詳細');
   await rejected('select save_my_player_profile($1,$2,$3)',[player(member),JSON.stringify({bio:'古い画面'}),JSON.stringify({bio:null})],/変更/);
 });
}));

test('公開候補と加入プレビューは申請先だけを返し、同意の内部JSONは直接読めない',()=>scenario(async()=>{
 const source=id(7000);await db.query("update clubs set visibility='public' where id=$1",[clubA]);
 const cm=await asUser(main,async()=>(await db.query('select add_provisional_club_member($1,$2,$3) id',[clubA,'加入用の仮選手',source])).rows[0].id);
 await db.query("insert into club_members(club_id,player_profile_id,role) values($1,$2,'member')",[clubB,source]);
 await db.query("update player_profiles set bio='別グループの詳細' where id=$1",[source]);
 await asUser(outsider,async()=>{
   const candidates=(await db.query('select * from get_public_join_candidates($1)',[clubA])).rows;
   assert.equal(candidates.length,1);assert.deepEqual(Object.keys(candidates[0]).sort(),['display_name','id','player_profile_id']);
   const preview=(await db.query('select preview_profile_join($1,$2) value',[clubA,cm])).rows[0].value;
   assert.equal(preview.memberships.length,1);assert.equal(preview.memberships[0].club_name,'非公開A');
   assert(!JSON.stringify(preview).includes('非公開B'));assert(!JSON.stringify(preview).includes('別グループの詳細'));
   await db.query("select submit_profile_join_request($1,$2,'本人同意',$3)",[clubA,cm,preview.review_token]);
   await rejected('select consent_snapshot from join_requests');
 });
}));

test('本人加入申請から管理者承認し、試合・戦績を引き継ぎ旧累計は保持する',()=>scenario(async()=>{
 const source=id(7010);await db.query("update clubs set visibility='public' where id=$1",[clubA]);
 const cm=await asUser(main,async()=>(await db.query('select add_provisional_club_member($1,$2,$3) id',[clubA,'戦績のある仮選手',source])).rows[0].id);
 await db.query("insert into profiles(id,display_name) values($1,'旧保存用の架空行')",[source]);
 await db.query('insert into player_stats(club_id,profile_id,match_count,win_count) values($1,$2,91,40)',[clubA,source]);
 const legacy=(await db.query('select to_jsonb(s) value from player_stats s order by id')).rows;
 const game=await createPlayable(main,source);await saveResult(game,6,4,main);
 const req=await asUser(outsider,async()=>{
   const p=(await db.query('select preview_profile_join($1,$2) value',[clubA,cm])).rows[0].value;
   return(await db.query('select submit_profile_join_request($1,$2,null,$3) id',[clubA,cm,p.review_token])).rows[0].id;
 });
 await asUser(main,async()=>db.query("select review_profile_join_request($1,'approved')",[req]));
 assert.deepEqual(await totals(player(outsider)),{played:1,wins:1});
 await asUser(outsider,async()=>assert.equal((await db.query('select id from matches where id=$1',[game.match])).rows.length,1));
 assert.deepEqual((await db.query('select to_jsonb(s) value from player_stats s order by id')).rows,legacy);
 assert((await db.query('select count(*)::int n from profile_link_private.merge_changes')).rows[0].n>0);
}));

test('管理者の完全一致メール検索・本人承認はUID表示なしで全参照を引き継ぐ',()=>scenario(async()=>{
 const source=id(7020), cm=await asUser(main,async()=>(await db.query('select add_provisional_club_member($1,$2,$3) id',[clubA,'管理者申請の仮選手',source])).rows[0].id);
 const game=await createPlayable(main,source);await saveResult(game,6,4,main);
 const oe=id(7021),oo=id(7022);
 await asUser(main,async()=>{
  await db.query('insert into event_team_matches(event_id,team_a_player1_profile_id) values($1,$2)',[teamEvent,source]);
  await db.query("insert into official_events(id,club_id,title,created_by_auth_user_id) values($1,$2,'公式履歴',$3)",[oe,clubA,main]);
  await db.query("insert into official_opponents(id,official_event_id,opponent_team_name) values($1,$2,'相手')",[oo,oe]);
  await db.query('insert into official_matches(official_event_id,official_opponent_id,match_order,our_player1_profile_id) values($1,$2,1,$3)',[oe,oo,source]);
 });
 const request=await asUser(main,async()=>{
  assert.equal((await db.query('select * from find_profile_link_account($1,$2)',[clubA,'security-4@'])).rows.length,0);
  const candidate=(await db.query('select * from find_profile_link_account($1,$2)',[clubA,'security-4@example.test'])).rows[0];
  assert.equal(candidate.auth_user_id,outsider);assert.equal(candidate.identifier,'確認済みアカウント');
  return(await db.query('select request_player_profile_link($1,$2,$3) id',[clubA,cm,candidate.auth_user_id])).rows[0].id;
 });
 await asUser(main,async()=>rejected("select review_player_profile_link($1,'approved','偽装')",[request]));
 await asUser(otherMain,async()=>rejected("select review_player_profile_link($1,'approved','偽装')",[request]));
 await asUser(outsider,async()=>{const p=(await db.query('select get_player_profile_link_request($1) value',[request])).rows[0].value;await db.query("select review_player_profile_link($1,'approved',$2)",[request,p.review_token]);});
 assert.deepEqual(await totals(player(outsider)),{played:1,wins:1});
 assert.equal((await db.query('select team_a_player1_profile_id id from event_team_matches where event_id=$1',[teamEvent])).rows[0].id,player(outsider));
 assert.equal((await db.query('select our_player1_profile_id id from official_matches where official_event_id=$1',[oe])).rows[0].id,player(outsider));
 const merge=(await db.query('select id from player_profile_merges where link_request_id=$1',[request])).rows[0].id;
 let restore=readFileSync(join(__dirname,'../supabase/maintenance/profile-linking/04_restore_reviewed_merge.sql'),'utf8');
 restore=restore.replace(/^begin;$/m,'').replace(/rollback;\s*$/,'').replace('-- 復旧対象挿入位置',`insert into reviewed_merge_restore values('${merge}');`);
 await db.exec(restore);
 assert.equal((await db.query('select player_profile_id id from club_members where id=$1',[cm])).rows[0].id,source);
 assert.deepEqual(await totals(source),{played:1,wins:1});
}));

test('公式共有は匿名・別グループの正しいトークンだけに表示し、内部UIDを返さない',()=>scenario(async()=>{
 const oe=id(7030),oo=id(7031);await db.query("update player_profiles set display_name='同名' where id=any($1::uuid[])",[[player(main),player(member)]]);
 await asUser(main,async()=>{
  await db.query("insert into official_events(id,club_id,title,status,share_enabled,share_token,created_by_auth_user_id) values($1,$2,'共有公式','closed',true,'official-fixture-token',$3)",[oe,clubA,main]);
 });
 await db.query("insert into official_opponents(id,official_event_id,opponent_team_name) values($1,$2,'相手')",[oo,oe]);
 await db.query('insert into official_matches(official_event_id,official_opponent_id,match_order,our_player1_profile_id,our_player2_profile_id) values($1,$2,1,$3,$4)',[oe,oo,player(main),player(member)]);
 for(const [actor,role] of [[null,'anon'],[otherMain,'authenticated']])await asUser(actor,async()=>{
  const data=(await db.query("select get_shared_event($1,'official') value",['official-fixture-token'])).rows[0].value;
  assert.equal(data.event.clubs.name,'非公開A');assert.equal(data.matches[0].our_player1_guest_name,'同名');
  assert.notEqual(data.matches[0].our_player1_profile_id,data.matches[0].our_player2_profile_id);
  assert(!JSON.stringify(data).includes(main));assert(!JSON.stringify(data).includes(player(main)));
  assert.equal((await db.query("select get_shared_event('invalid','official') value")).rows[0].value,null);
  await prevented('select share_token from official_events');
 },role);
 await db.query('update official_events set share_enabled=false where id=$1',[oe]);
 assert.equal((await db.query("select get_shared_event('official-fixture-token','official') value")).rows[0].value,null);
}));

test('相手チームの必要な選手名は返すが、無関係な所属の役職は返さない',()=>scenario(async()=>{
 await asUser(otherMain,async()=>{
  const names=(await db.query('select * from get_club_players($1)',[clubA])).rows;
  assert(names.some(r=>r.player_profile_id===player(member)));assert.deepEqual(Object.keys(names[0]).sort(),['display_name','player_profile_id']);
  await zero('select role from club_members where club_id=$1',[clubA]);
 });
 await asUser(outsider,async()=>zero('select * from get_club_players($1)',[clubA]));
}));

test('旧アカウントIDだけの所属でも正規選手IDで参加・Round・保存できる',()=>scenario(async()=>{
 await db.query("insert into club_members(club_id,profile_id,role) values($1,$2,'member')",[clubA,outsider]);
 await asUser(main,async()=>assert((await db.query('select * from get_club_players($1)',[clubA])).rows.some(r=>r.player_profile_id===player(outsider))));
 const game=await createPlayable(main,player(outsider));await saveResult(game,6,4,main);
 assert.deepEqual(await totals(player(outsider)),{played:1,wins:1});
}));

test('手動Roundも再送・スコア・反映対象切替を保ち、旧累計は保持する',()=>scenario(async()=>{
 await db.query("update events set event_mode='manual',stats_mode='undecided' where id=$1",[eventA]);
 const legacy=(await db.query('select to_jsonb(s) value from player_stats s order by id')).rows;
 const game=await createPlayable();await saveResult(game,6,4);
 await asUser(member,async()=>db.query("update events set status='closed',stats_mode='official' where id=$1",[eventA]));
 assert.deepEqual(await totals(player(member)),{played:3,wins:3});
 assert.deepEqual((await db.query('select to_jsonb(s) value from player_stats s order by id')).rows,legacy);
}));

test('メール確認前の候補・連携申請を拒否し、確認後の初回プロフィールを重複作成しない',()=>scenario(async()=>{
 const newUser=id(7040),source=id(7041);
 await db.query("insert into auth.users(id,email) values($1,'confirmed-fixture@example.test')",[newUser]);
 const cm=await asUser(main,async()=>(await db.query('select add_provisional_club_member($1,$2,$3) id',[clubA,'確認用の仮選手',source])).rows[0].id);
 await asUser(main,async()=>{
  assert.equal((await db.query('select * from find_profile_link_account($1,$2)',[clubA,'confirmed-fixture@example.test'])).rows.length,0);
  await rejected('select request_player_profile_link($1,$2,$3)',[clubA,cm,newUser]);
 });
 // Authのメール配送・JWT発行の代わりに、DBで確認済み状態を再現する。
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[newUser]);
 await asUser(newUser,async()=>{
  await db.query("insert into profiles(id,display_name) values($1,'本人')",[newUser]);
  assert.equal((await db.query('select * from get_my_player_profiles()')).rows.length,0);
  await db.query("select ensure_my_player_profile('本人',null)");await db.query("select ensure_my_player_profile('再送',null)");
  assert.equal((await db.query('select * from get_my_player_profiles()')).rows.length,1);
 });
 await asUser(main,async()=>assert.equal((await db.query('select * from find_profile_link_account($1,$2)',[clubA,'confirmed-fixture@example.test'])).rows.length,1));
}));

test('一般メンバーも管理者も所属・本人連携ID・管理者登録を直接改ざんできない',()=>scenario(async()=>{
 for(const actor of [member,main])await asUser(actor,async()=>{
  await rejected('update club_members set club_id=$1 where id=$2',[clubB,id(202)]);
  await rejected('update club_members set player_profile_id=$1,profile_id=$2 where id=$3',[player(main),main,id(202)]);
  await rejected('update player_profiles set linked_auth_user_id=$1 where id=$2',[actor,player(otherMain)]);
  await rejected('insert into app_admins(profile_id,is_active) values($1,true)',[actor]);
 });
}));

test('Round・試合・参加枠の直接一括変更を拒否し、正規の単一試合削除だけを維持する',()=>scenario(async()=>{
 const game=await createPlayable();
 await asUser(member,async()=>{
  for(const table of ['rounds','matches','match_players']){
   await rejected(`delete from ${table}`);await rejected(`update ${table} set id=id`);
  }
  await db.query('select delete_friendly_match($1,$2,$3)',[eventA,game.match,id(generatedId++)]);
 });
 assert.equal((await db.query('select id from matches where id=$1',[matchA])).rows.length,1);
}));

test('稼働後の変更があればメタデータ切り戻しも停止して新しいデータを保持する',()=>scenario(async()=>{
 await db.query("update events set name='稼働後の変更' where id=$1",[eventA]);
 await db.exec('savepoint reviewed_rollback');
 try { await assert.rejects(db.exec(maintenance('04_rollback.sql')),/業務再開後/); }
 finally { await db.exec('rollback to savepoint reviewed_rollback;release savepoint reviewed_rollback'); }
 assert.equal((await db.query('select name from events where id=$1',[eventA])).rows[0].name,'稼働後の変更');
}));

test('退会後も本人の終了済み試合と選手名は参照でき、現在の運営権限は戻らない',()=>scenario(async()=>{
 await db.query('update club_members set is_active=false where id=$1',[id(202)]);
 await asUser(member,async()=>{
  assert.equal((await db.query('select id from events where id=$1',[closed])).rows.length,1);
  assert.equal((await db.query('select id,display_name from player_profiles where id=$1',[player(member)])).rows.length,1);
  await zero('select id from events where id=$1',[eventA]);
  await prevented("update events set status='active' where id=$1 returning id",[closed]);
 });
}));

test('グループなしの公式戦も正しい共有トークンで表示できる',()=>scenario(async()=>{
 const oe=id(7050);
 await asUser(creator,async()=>db.query("insert into official_events(id,club_id,title,status,share_enabled,share_token,created_by_auth_user_id) values($1,null,'個人公式','closed',true,'personal-official',$2)",[oe,creator]));
 await asUser(null,async()=>assert.equal((await db.query("select get_shared_event('personal-official','official') value")).rows[0].value.event.title,'個人公式'),'anon');
}));

test('認証UIDと別人の選手IDが同値でも、別グループの仮選手を所属扱いにしない',()=>scenario(async()=>{
 const privateClub=id(7060);
 await db.query("insert into clubs(id,name,owner_id,visibility) values($1,'非公開C',$2,'private')",[privateClub,otherMain]);
 await db.query("insert into club_members(club_id,profile_id,player_profile_id,role) values($1,$2,$3,'main_admin')",[privateClub,otherMain,player(otherMain)]);
 await asUser(otherMain,async()=>db.query('select add_provisional_club_member($1,$2,$3)',[privateClub,'別グループの別人',outsider]));
 await db.query("insert into club_members(club_id,profile_id,role) values($1,$2,'member')",[clubA,outsider]);
 await asUser(outsider,async()=>{
  await zero('select id from player_profiles where id=$1',[outsider]);
  await zero('select * from get_player_names($1)',[[outsider]]);
  const names=(await db.query('select * from get_club_players($1)',[clubA])).rows;
  assert(names.some(r=>r.player_profile_id===player(outsider)));assert(!names.some(r=>r.player_profile_id===outsider));
  await rejected("insert into event_participants(event_id,player_profile_id,participant_type,status) values($1,$2,'member','active')",[eventA,outsider]);
 });
 const game=await createPlayable(main,player(outsider));await saveResult(game,6,4,main);
 assert.deepEqual(await totals(player(outsider)),{played:1,wins:1});
}));

test('旧profile_idだけの参加者も、選手IDだけの所属に対応して保存・再参加できる',()=>scenario(async()=>{
 const game=await createPlayable(main,player(linkedMember));
 // 適用前から存在する旧形式をDB所有者で用意する。通常APIでのID付け替えには依存しない。
 await db.query('update event_participants set player_profile_id=null,profile_id=$1 where id=$2',[linkedMember,game.participantIds[0]]);
 await saveResult(game,6,4,main);
 assert.deepEqual(await totals(player(linkedMember)),{played:1,wins:1});
 const next=await asUser(main,async()=>(await db.query('select create_friendly_round($1,$2,$3,$4) value',[eventA,game.expected+1,JSON.stringify(game.cards),id(generatedId++)])).rows[0].value);
 const mid=(await db.query('select id from matches where round_id=$1',[next.round_id])).rows[0].id;
 await saveResult({event:eventA,match:mid},4,6,main);
 assert.deepEqual(await totals(player(linkedMember)),{played:2,wins:1});
}));

for(const [label,actor] of [['一般メンバー',member],['管理者',main]])
test(`${label}も参加者の人物ID・種別を直接付け替えられず、過去の戦績を移せない`,()=>scenario(async()=>{
 const game=await createPlayable();await saveResult(game,6,4);
 const legacy=id(generatedId++),guest=game.participantIds[1];
 await db.query("insert into event_participants(id,event_id,profile_id,participant_type,status) values($1,$2,$3,'member','active')",[legacy,eventA,member]);
 const before=await state(),ownTotals=await totals(player(member)),otherTotals=await totals(player(main));
 await asUser(actor,async()=>{
  for(const [sql,args] of [
   ['update event_participants set player_profile_id=$1 where id=$2',[player(main),game.participantIds[0]]],
   ['update event_participants set profile_id=$1 where id=$2',[main,legacy]],
   ['update event_participants set player_profile_id=$1,profile_id=$2 where id=$3',[player(main),main,game.participantIds[0]]],
   ['update event_participants set player_profile_id=null where id=$1',[game.participantIds[0]]],
   ['update event_participants set profile_id=null where id=$1',[legacy]],
   ["update event_participants set participant_type='guest' where id=$1",[game.participantIds[0]]],
   ["update event_participants set participant_type='guest',player_profile_id=null,profile_id=null where id=$1",[game.participantIds[0]]],
   ["update event_participants set participant_type='member' where id=$1",[guest]],
   ["update event_participants set participant_type='member',player_profile_id=$1,profile_id=$2 where id=$3",[player(main),main,guest]],
   ["update event_participants set player_profile_id=$1,status='resting' where id=$2",[player(main),game.participantIds[0]]]
  ]) await rejected(sql,args,{code:'42501'});
 });
 assert.deepEqual(await state(),before,'拒否した操作で人物・試合・戦績を変更しない');
 assert.deepEqual(await totals(player(member)),ownTotals);assert.deepEqual(await totals(player(main)),otherTotals);
}));

test('人物IDを固定しても一般メンバーの状態・ゲスト名・採点前組合せ・スコア再編集を維持する',()=>scenario(async()=>{
 const game=await createPlayable(),before=(await db.query('select id,profile_id,player_profile_id,participant_type from event_participants where id=any($1::uuid[]) order by id',[game.participantIds])).rows;
 await asUser(member,async()=>{
  const participant=game.participantIds[0],guest=game.participantIds[1];
  assert.equal((await db.query("update event_participants set status='resting' where id=$1 returning status",[participant])).rows[0].status,'resting');
  assert.equal((await db.query("update event_participants set status='active',player_profile_id=$1,profile_id=null,participant_type='member' where id=$2 returning status",[player(member),participant])).rows[0].status,'active','人物IDの同値送信は状態変更を妨げない');
  assert.equal((await db.query("update event_participants set guest_name='変更後ゲスト' where id=$1 returning guest_name",[guest])).rows[0].guest_name,'変更後ゲスト');
  const players=[game.participantIds[2],game.participantIds[1],game.participantIds[0],game.participantIds[3]];
  await db.query('select set_friendly_lineup($1,$2,$3,$4)',[eventA,game.match,JSON.stringify(players),id(generatedId++)]);
  assert.equal((await db.query("select team from match_players where match_id=$1 and participant_id=$2",[game.match,participant])).rows[0].team,'B');
 });
 assert.deepEqual((await db.query('select id,profile_id,player_profile_id,participant_type from event_participants where id=any($1::uuid[]) order by id',[game.participantIds])).rows,before);
 await saveResult(game,6,4);await saveResult(game,4,6);
 assert.equal((await db.query('select count(*)::int n from match_results where match_id=$1',[game.match])).rows[0].n,1);
 assert.deepEqual((await db.query('select score_a,score_b,winner_team from match_results where match_id=$1',[game.match])).rows[0],{score_a:4,score_b:6,winner_team:'B'});
}));
