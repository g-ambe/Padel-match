const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixedPairDatabase,id}=require('./fixtures/fixed-pair-db.cjs');
const fs=require('node:fs'),path=require('node:path');
const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase/maintenance/event-fixed-pairs',name),'utf8');
const {seededRandom,card}=require('./fixtures/friendly-round-helpers.cjs');
const {generateFriendlyRoundWithFixedPairs}=require('../lib/friendly-fixed-pairs.ts');
const {metadataFingerprints}=require('./fixtures/fixed-pair-metadata.cjs');
const productionMetadata=require('./fixtures/fixed-pair-production-metadata.json');

// 通常は組み込みPostgreSQLで実行。別途、空のローカルPostgreSQL 17でも同じ試験を実行する。
test('固定ペアのDB保存・権限・生成・戦績反映を実際のSQLで検証する',async t=>{
 let client,adapter;
 if(process.env.FIXED_PAIR_PG_URL){const {Client}=require('pg');client=new Client({connectionString:process.env.FIXED_PAIR_PG_URL});await client.connect();adapter={exec:sql=>client.query(sql),query:(sql,args)=>client.query(sql,args)};}
 const f=await fixedPairDatabase(false,adapter),{db,as,event,rpc,migration}=f;
 const owner=()=>db.exec('reset role');
 const count=async table=>Number((await db.query(`select count(*) n from public.${table}`)).rows[0].n);
 const snapshot=async()=>JSON.parse(JSON.stringify((await db.query(`select jsonb_build_object(
 'rows',jsonb_build_object('events',(select jsonb_agg(to_jsonb(e) order by id) from events e),'event_participants',(select jsonb_agg(to_jsonb(e) order by id) from event_participants e),'rounds',(select jsonb_agg(to_jsonb(e) order by id) from rounds e),'matches',(select jsonb_agg(to_jsonb(e) order by id) from matches e),'match_players',(select jsonb_agg(to_jsonb(e) order by id) from match_players e),'match_results',(select jsonb_agg(to_jsonb(e) order by id) from match_results e),'clubs',(select jsonb_agg(to_jsonb(e) order by id) from clubs e),'club_members',(select jsonb_agg(to_jsonb(e) order by id) from club_members e),'player_profiles',(select jsonb_agg(to_jsonb(e) order by id) from player_profiles e),'profiles',(select jsonb_agg(to_jsonb(e) order by id) from profiles e),'app_admins',(select jsonb_agg(to_jsonb(e) order by id) from app_admins e)),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
 'acl',(select jsonb_agg(jsonb_build_array(relname,relacl) order by relname) from pg_class where oid in('events'::regclass,'event_participants'::regclass,'rounds'::regclass,'matches'::regclass,'match_players'::regclass,'match_results'::regclass,'clubs'::regclass,'club_members'::regclass,'player_profiles'::regclass,'profiles'::regclass,'app_admins'::regclass))) data`)).rows[0].data));
 const state=eid=>rpc('get_event_fixed_pair_state',[eid,true]);
 const pair=(p,index=0)=>({id:id(90000+index),a:p[0],b:p[1]});
 const replace=(eid,rev,pairs,req=91000)=>rpc('replace_event_fixed_pairs',[eid,rev,JSON.stringify(pairs),id(req)]);
 const gen=(e,rev=1,last=0,cards,req=92000,mode='normal',active=e.participants,courts=1)=>rpc('create_fixed_pair_round',[e.eid,rev,last,courts,mode,active,JSON.stringify(cards??[{court:1,teamA:e.participants.slice(0,2),teamB:e.participants.slice(2,4)}]),id(req)]);
 try {
  await t.test('追加Migrationは既存行・既存RLS・権限を変更せず、表示だけでは設定行を作らない',async()=>{
   const e=await event(700,6);const rid=id(700900),mid=id(700901);await db.query('insert into rounds(id,event_id,round_number) values($1,$2,1)',[rid,e.eid]);await db.query('insert into matches(id,event_id,round_id,court_number,completed) values($1,$2,$3,1,true)',[mid,e.eid,rid]);for(let i=0;i<4;i++)await db.query('insert into match_players(match_id,participant_id,team) values($1,$2,$3)',[mid,e.participants[i],i<2?'A':'B']);await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,0,0,'draw')",[mid]);const before=await snapshot();
   const preflight=(await db.exec(sql('01_preflight.sql'))).find(r=>r.rows?.[0]?.fixed_pair_preflight).rows[0].fixed_pair_preflight;assert.deepEqual(metadataFingerprints(preflight),productionMetadata.sha256);assert.equal(preflight.new_schema_present,false);
   await db.exec(sql('02_backup.sql'));await db.exec(migration);const after=await snapshot();
   assert.deepEqual(after.rows,before.rows);assert.deepEqual(after.acl,before.acl);assert.deepEqual(after.policies.filter(p=>!p.tablename.startsWith('event_fixed_pair')),before.policies);
   for(const n of [1,2,3,6]){await as(n);assert.equal((await state(e.eid)).revision,0);}
   await owner();for(const table of ['event_fixed_pair_state','event_fixed_pairs','event_fixed_pair_rounds'])assert.equal(await count(table),0);
   const other=await event(729,5),ids=other.participants.slice(0,2).sort();await assert.rejects(db.query('insert into event_fixed_pairs(id,event_id,a,b) values($1,$2,$3,$4)',[id(90999),e.eid,...ids]),/foreign key/);
  });
  await t.test('本人所属・旧profile_id・管理者・super_userを許可し、別グループ・退会・匿名を拒否する',async()=>{
   const e=await event(701,6);await as();await replace(e.eid,0,[pair(e.participants)],91001);
   for(const n of [1,2,3,6]){await as(n);assert.equal((await state(e.eid)).pairs.length,1);}
   for(const [n,role]of [[4,'authenticated'],[5,'authenticated'],[null,'anon'],[null,'authenticated']]){await as(n,role);await assert.rejects(state(e.eid),/権限|permission denied/);await assert.rejects(replace(e.eid,1,[],91002),/権限|permission denied/);await assert.rejects(gen(e),/権限|permission denied/);await assert.rejects(rpc('finish_fixed_pair_event',[e.eid,1,true,'official']),/権限|permission denied/);}
   await as(4);assert.equal((await db.query('select * from event_fixed_pairs')).rows.length,0);
   await assert.rejects(db.query('delete from event_fixed_pairs'),/permission denied/);await assert.rejects(db.query('insert into event_fixed_pair_state(event_id) values($1)',[e.eid]),/permission denied/);
   for(const [i,extra] of [{noGroup:true},{mode:'manual'},{mode:'team'},{deleted:true},{club:601}].entries()){const other=await event(702+i,6,extra);await as();await assert.rejects(state(other.eid),/権限/);}
   await owner();const functions=(await db.query("select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') auth from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='fixed_pair_private' or p.proname in('get_event_fixed_pair_state','replace_event_fixed_pairs','create_fixed_pair_round','finish_fixed_pair_event')")).rows;
   assert(functions.every(p=>p.proconfig.includes('search_path=""')||p.proconfig.includes('search_path=')));assert(functions.every(p=>!p.anon));assert(functions.filter(p=>['eligible','lock_event','state'].includes(p.proname)).every(p=>!p.auth));
  });
  await t.test('同一参加者・別イベント・4人での新規固定を拒否し、CASと再試行で設定を壊さない',async()=>{
   const e=await event(710,6),other=await event(711,6);await as();const p=pair(e.participants,10),s=await replace(e.eid,0,[p],91010);assert.equal(s.revision,1);
   assert.deepEqual(await replace(e.eid,0,[p],91010),s);
   await assert.rejects(replace(e.eid,0,[],91011),/別端末/);
   await assert.rejects(replace(e.eid,1,[p,{id:id(90011),a:e.participants[2],b:e.participants[0]}],91012),/複数/);
   await assert.rejects(replace(e.eid,1,[pair(other.participants,12)],91013),/生成対象者/);
   assert.deepEqual((await state(e.eid)).pairs,s.pairs);
   const four=await event(712,4);await as();await assert.rejects(replace(four.eid,0,[pair(four.participants,13)],91014),/5〜20/);
   await db.query("update event_participants set status='resting' where id=any($1)",[e.participants.slice(4)]);
   const retained=await replace(e.eid,1,[p],91015);assert.equal(retained.pairs.length,1);assert.equal((await replace(e.eid,2,[],91016)).pairs.length,0);
  });
  await t.test('生成は全体で原子的に保存し、再試行は同じRoundを返し、実使用履歴を保持する',async()=>{
   const e=await event(720,6);await as();await replace(e.eid,0,[pair(e.participants,20)],91020);
   const result=await gen(e);assert.equal(result.round_number,1);assert.deepEqual(await gen(e),result);
   const s=await state(e.eid);assert.equal(s.used_fixed_pairs,true);assert.equal(s.eligible_rounds.length,1);assert.equal(s.eligible_rounds[0].eligible.length,6);assert.equal(s.eligible_rounds[0].played.length,4);
   const audit=(await db.query('select * from event_fixed_pair_rounds where event_id=$1',[e.eid])).rows[0];assert.equal(audit.applied_pairs.length,1);assert.equal(audit.split_pairs.length,0);
   assert.equal((await db.query('select stats_mode from events where id=$1',[e.eid])).rows[0].stats_mode,'undecided');
   await assert.rejects(gen(e,1,0,undefined,92001),/変更/);
   await replace(e.eid,2,[],91021);assert.equal((await state(e.eid)).used_fixed_pairs,true);
   await db.query('delete from match_players where match_id in(select id from matches where round_id=$1)',[result.round_id]);await db.query('delete from matches where round_id=$1',[result.round_id]);await db.query('delete from rounds where id=$1',[result.round_id]);
   assert.equal((await state(e.eid)).used_fixed_pairs,true);assert.equal((await state(e.eid)).eligible_rounds.length,0);await assert.rejects(gen(e),/削除/);
   assert.equal((await db.query('select count(*) n from event_fixed_pair_rounds where event_id=$1',[e.eid])).rows[0].n,client?'1':1);
  });
  await t.test('片方自動休憩も利用済みにし、4人では設定を残して無視する',async()=>{
   const e=await event(721,5);await as();await replace(e.eid,0,[pair(e.participants,21)],91022);
   const p=e.participants;await gen(e,1,0,[{court:1,teamA:[p[0],p[2]],teamB:[p[3],p[4]]}],92002);
   assert.equal((await state(e.eid)).used_fixed_pairs,true);const a=(await db.query('select applied_pairs,split_pairs from event_fixed_pair_rounds where event_id=$1',[e.eid])).rows[0];assert.equal(a.applied_pairs.length,0);assert.equal(a.split_pairs.length,1);assert.equal((await state(e.eid)).pairs.length,1);
   await db.query("update event_participants set status='resting' where id=$1",[p[1]]);await gen(e,2,1,[{court:1,teamA:[p[0],p[3]],teamB:[p[2],p[4]]}],92003,'normal',p.filter(x=>x!==p[1]));assert.equal((await state(e.eid)).used_fixed_pairs,true);
  });
  await t.test('参加状況・面数・固定維持・選手重複・特別モード未解放をDBでも検査する',async()=>{
   const e=await event(722,6);await as();await replace(e.eid,0,[pair(e.participants,22)],91023);const p=e.participants;
   for(const cards of [[{court:1,teamA:[p[0],p[2]],teamB:[p[1],p[3]]}],[{court:1,teamA:[p[0],p[1]],teamB:[p[2],p[2]]}]])await assert.rejects(gen(e,1,0,cards,92004),/固定ペア|同じイベント/);
   await assert.rejects(gen(e,1,0,undefined,92005,'normal',p.slice(1)),/生成対象者/);await assert.rejects(gen(e,1,0,undefined,92006,'normal',p,2),/面数/);
   await assert.rejects(gen(e,1,0,undefined,92007,'balance'),/10試合/);
   await db.query("update event_participants set status='absent' where id=$1",[p[1]]);await gen(e,1,0,[{court:1,teamA:[p[0],p[2]],teamB:[p[3],p[4]]}],92008,'normal',p.filter(x=>x!==p[1]));assert.equal((await state(e.eid)).used_fixed_pairs,false);
   assert.equal((await state(e.eid)).revision,2);assert.equal(Number((await db.query('select count(*) n from rounds where event_id=$1',[e.eid])).rows[0].n),1);
   const impossible=await event(723,9,{courts:2});await as();await replace(impossible.eid,0,[pair(impossible.participants,23)],91024);const q=impossible.participants;await gen(impossible,1,0,[{court:1,teamA:q.slice(0,2),teamB:q.slice(2,4)},{court:2,teamA:q.slice(4,6),teamB:q.slice(6,8)}],92009,'normal',q,2);assert.equal((await state(impossible.eid)).used_fixed_pairs,true);
  });
  await t.test('1面3組・8人3組の連続ペア・9人の片方休憩・全固定をDBでも許可する',async()=>{
   const e=await event(731,6);await as();const p=e.participants;await replace(e.eid,0,[pair(p,31),pair(p.slice(2),32),pair(p.slice(4),33)],91100);
   await gen(e,1,0,[{court:1,teamA:p.slice(0,2),teamB:p.slice(2,4)}],92100);await gen(e,2,1,[{court:1,teamA:p.slice(0,2),teamB:p.slice(4,6)}],92101);assert.equal((await state(e.eid)).pairs.length,3);
   const eight=await event(732,8,{courts:2});await as();const q=eight.participants;await replace(eight.eid,0,[pair(q,34),pair(q.slice(2),35),pair(q.slice(4),36)],91101);const cards=[{court:1,teamA:q.slice(0,2),teamB:q.slice(2,4)},{court:2,teamA:q.slice(4,6),teamB:q.slice(6,8)}];await gen(eight,1,0,cards,92102,'normal',q,2);await gen(eight,2,1,cards,92103,'normal',q,2);
   const nine=await event(733,9,{courts:2});await as();const r=nine.participants;await replace(nine.eid,0,[pair(r,37)],91102);await gen(nine,1,0,[{court:1,teamA:[r[1],r[2]],teamB:r.slice(3,5)},{court:2,teamA:r.slice(5,7),teamB:r.slice(7,9)}],92104,'normal',r,2);const audit=(await db.query('select * from event_fixed_pair_rounds where event_id=$1',[nine.eid])).rows[0];assert.equal(audit.effective_pairs.length,1);assert.equal(audit.applied_pairs.length,0);assert.equal(audit.split_pairs.length,1);assert.equal((await state(nine.eid)).used_fixed_pairs,true);
   const twenty=await event(734,20);await as();await replace(twenty.eid,0,Array.from({length:10},(_,i)=>pair(twenty.participants.slice(i*2),40+i)),91103);assert.equal((await state(twenty.eid)).pairs.length,10);
  });
  await t.test('固定条件を使って両名とも休憩した場合も利用済みとし、4人での一時停止だけでは印を立てない',async()=>{
   const e=await event(735,6);await as();const p=e.participants;await replace(e.eid,0,[pair(p,50)],91104);await gen(e,1,0,[{court:1,teamA:p.slice(2,4),teamB:p.slice(4,6)}],92105);const a=(await db.query('select * from event_fixed_pair_rounds where event_id=$1',[e.eid])).rows[0];assert.equal(a.effective_pairs.length,1);assert.equal(a.applied_pairs.length,0);assert.equal(a.split_pairs.length,0);assert.equal((await state(e.eid)).used_fixed_pairs,true);
   const four=await event(736,5);await as();const q=four.participants;await replace(four.eid,0,[pair(q,51)],91105);await db.query("update event_participants set status='resting' where id=$1",[q[4]]);await gen(four,1,0,[{court:1,teamA:[q[0],q[2]],teamB:[q[1],q[3]]}],92106,'normal',q.slice(0,4));assert.equal((await state(four.eid)).used_fixed_pairs,false);assert.equal((await state(four.eid)).pairs.length,1);
  });
  await t.test('SQLだけ適用後も固定0組の旧生成・スコア修正・終了再開・共有・削除を維持する',async()=>{
   const e=await event(737,6);await as(3);const p=e.participants,rid=id(737900),mid=id(737901);
   await db.query('insert into rounds(id,event_id,round_number) values($1,$2,1)',[rid,e.eid]);await db.query('insert into matches(id,event_id,round_id,court_number) values($1,$2,$3,1)',[mid,e.eid,rid]);for(let i=0;i<4;i++)await db.query('insert into match_players(match_id,participant_id,team) values($1,$2,$3)',[mid,p[i],i<2?'A':'B']);
   await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,0,0,'draw')",[mid]);await db.query('update matches set completed=true,youtube_url=$2 where id=$1',[mid,'https://youtu.be/synthetic-old']);await db.query("update match_results set score_a=4,score_b=2,winner_team='A' where match_id=$1",[mid]);
   assert.equal((await state(e.eid)).used_fixed_pairs,false);await gen(e,0,1,undefined,92107);assert.equal((await state(e.eid)).used_fixed_pairs,false);
   await db.query("update events set status='closed',stats_mode='official' where id=$1",[e.eid]);await db.query("update events set status='active',name='更新した開催',court_count=2 where id=$1",[e.eid]);await db.query("update events set status='closed',stats_mode='official' where id=$1",[e.eid]);
   await as(1);await db.query("update events set share_enabled=true,share_token='synthetic-share-token' where id=$1",[e.eid]);await as(null,'anon');assert.equal((await db.query('select id,name from events where id=$1',[e.eid])).rows.length,0);await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-padel-share-token':'synthetic-share-token'})]);assert.equal((await db.query('select id,name from events where id=$1',[e.eid])).rows.length,1);await assert.rejects(db.query('select * from event_fixed_pairs'),/permission denied/);
   await as(3);await db.query('delete from match_results where match_id=$1',[mid]);await db.query('delete from match_players where match_id=$1',[mid]);await db.query('delete from matches where id=$1',[mid]);await db.query('delete from rounds where id=$1',[rid]);
   const remaining=Number((await db.query('select count(*) n from matches where event_id=$1',[e.eid])).rows[0].n);await as(1);await db.query('update events set is_deleted=true,deleted_at=now() where id=$1',[e.eid]);await owner();assert.equal(Number((await db.query('select count(*) n from matches where event_id=$1',[e.eid])).rows[0].n),remaining);assert.equal(Number((await db.query('select count(*) n from event_participants where event_id=$1',[e.eid])).rows[0].n),6);
  });
  await t.test('生成器の全3モード出力を9構成×20RoundでRPC保存し、分割・重複許容をDBと一致させる',async()=>{
   let index=0;
   for(const [n,courts,fixed] of [[6,1,3],[7,1,3],[8,2,3],[9,2,4],[11,2,4],[13,3,6],[17,4,8],[20,1,10],[20,5,10]])for(const mode of ['normal','balance','rival']){
    const e=await event(750+index,n,{courts}),p=e.participants,history=[],settings=Array.from({length:fixed},(_,i)=>({id:id(7000000+index*20+i),a:p[2*i],b:p[2*i+1]}));
    for(let round=1;round<=10;round++){
     const rid=(await db.query('insert into rounds(event_id,round_number) values($1,$2) returning id',[e.eid,round])).rows[0].id,mid=(await db.query('insert into matches(event_id,round_id,court_number,completed) values($1,$2,1,true) returning id',[e.eid,rid])).rows[0].id;
     for(let i=0;i<4;i++)await db.query('insert into match_players(match_id,participant_id,team) values($1,$2,$3)',[mid,p[i],i<2?'A':'B']);await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,4,2,'A')",[mid]);history.push({...card(p.slice(0,4),round),event_id:e.eid});
    }
    await as();await replace(e.eid,0,settings,94000+index);let audit=[];
    for(let round=0;round<20;round++){
     const result=generateFriendlyRoundWithFixedPairs({eventId:e.eid,participantIds:p,knownParticipantIds:new Set(p),courtCount:courts,lastRound:10+round,history,mode,fixedPairs:settings,eligibleRounds:audit,random:seededRandom(30+round)});
     const saved=await gen(e,1+round,10+round,result.matches,95000+index*100+round,mode,p,courts);assert.equal(saved.round_number,11+round);
     const matches=(await db.query('select id from matches where round_id=$1',[saved.round_id])).rows;
     for(const match of matches){await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,4,2,'A')",[match.id]);await db.query('update matches set completed=true where id=$1',[match.id]);}
     for(const match of result.matches)history.push({...card([...match.teamA,...match.teamB],11+round),event_id:e.eid});audit=(await state(e.eid)).eligible_rounds;
    }
    assert.equal((await state(e.eid)).used_fixed_pairs,true);assert.equal(audit.length,20);assert.equal(Number((await db.query('select count(*) n from rounds where event_id=$1',[e.eid])).rows[0].n),30);index++;
   }
  });
  await t.test('途中の試合保存失敗でRound・試合・利用履歴を一切残さない',async()=>{
   const e=await event(724,8,{courts:2});await as();await replace(e.eid,0,[pair(e.participants,24)],91025);await owner();
   await db.exec("create function public.fixed_test_failure() returns trigger language plpgsql as $$begin if new.court_number=2 then raise exception '試験用保存失敗';end if;return new;end$$;create trigger fixed_test_failure before insert on matches for each row execute function fixed_test_failure()");
   await as();const p=e.participants;await assert.rejects(gen(e,1,0,[{court:1,teamA:p.slice(0,2),teamB:p.slice(2,4)},{court:2,teamA:p.slice(4,6),teamB:p.slice(6,8)}],92010,'normal',p,2),/試験用保存失敗/);
   for(const table of ['rounds','matches','event_fixed_pair_rounds'])assert.equal(Number((await db.query(`select count(*) n from ${table} where event_id=$1`,[e.eid])).rows[0].n),0);
   assert.equal((await state(e.eid)).revision,1);assert.equal((await state(e.eid)).used_fixed_pairs,false);
   await owner();await db.exec('drop trigger fixed_test_failure on matches;drop function fixed_test_failure()');
  });
  await t.test('利用済み終了は明示選択必須、再開・再終了で切替可能、旧経路の迂回を拒否する',async()=>{
   const e=await event(725,6);await as();await replace(e.eid,0,[pair(e.participants,25)],91026);const r=await gen(e,1,0,undefined,92011);
   await assert.rejects(rpc('finish_fixed_pair_event',[e.eid,2,true,null]),/選択/);
   await assert.rejects(db.query("update events set status='closed',stats_mode='official' where id=$1",[e.eid]),/専用/);
   await assert.rejects(db.query('insert into rounds(event_id,round_number) values($1,2)',[e.eid]),/専用/);
   const result=await rpc('finish_fixed_pair_event',[e.eid,2,true,'record_only']);assert.equal(result.stats_mode,'record_only');assert.deepEqual(await rpc('finish_fixed_pair_event',[e.eid,2,true,'record_only']),result);
   await assert.rejects(replace(e.eid,3,[],91027),/終了済み/);
   assert.deepEqual(await gen(e,1,0,undefined,92011),r);
   assert.equal((await rpc('finish_fixed_pair_event',[e.eid,3,false,null])).stats_mode,'undecided');await assert.rejects(rpc('finish_fixed_pair_event',[e.eid,4,true,null]),/選択/);assert.equal((await rpc('finish_fixed_pair_event',[e.eid,4,true,'official'])).stats_mode,'official');
   assert.equal(Number((await db.query('select count(*) n from matches where event_id=$1',[e.eid])).rows[0].n),1);
   const ordinary=await event(726,4);await as();await db.query("update events set status='closed',stats_mode='official' where id=$1",[ordinary.eid]);await db.query("update events set status='active' where id=$1",[ordinary.eid]);
   const mid=(await db.query('select id from matches where round_id=$1',[r.round_id])).rows[0].id;await db.query('update matches set youtube_url=$2 where id=$1',[mid,'https://youtu.be/synthetic']);await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,0,0,'draw')",[mid]);assert.equal(Number((await db.query('select count(*) n from match_results where match_id=$1',[mid])).rows[0].n),1);
  });
  if(client)await t.test('実PostgreSQLの2接続で設定更新・生成の同時競合を直列化する',async()=>{
   const {Client}=require('pg'),second=new Client({connectionString:process.env.FIXED_PAIR_PG_URL});await second.connect();
   try{const e=await event(727,6);await as();await second.query("select set_config('request.jwt.claim.sub',$1,false)",[id(3)]);await second.query('set role authenticated');
    const args=[e.eid,0,JSON.stringify([pair(e.participants,27)]),id(91028)],sql='select replace_event_fixed_pairs($1,$2,$3,$4) result';
    await db.exec('begin');await db.query(sql,args);const waiting=second.query(sql,[e.eid,0,'[]',id(91029)]);await db.exec('commit');await assert.rejects(waiting,/別端末/);
    await db.exec('begin');await gen(e,1,0,undefined,92012);const p=e.participants,body=JSON.stringify([{court:1,teamA:p.slice(0,2),teamB:p.slice(2,4)}]);const pending=second.query('select create_fixed_pair_round($1,$2,$3,$4,$5,$6,$7,$8)',[e.eid,1,0,1,'normal',p,body,id(92012)]);await db.exec('commit');await pending;
    assert.equal(Number((await db.query('select count(*) n from rounds where event_id=$1',[e.eid])).rows[0].n),1);
    const next=[{court:1,teamA:p.slice(0,2),teamB:[p[2],p[4]]}];await db.exec('begin');await gen(e,2,1,next,92013);const competing=second.query('select create_fixed_pair_round($1,$2,$3,$4,$5,$6,$7,$8)',[e.eid,2,1,1,'normal',p,JSON.stringify(next),id(92014)]);await db.exec('commit');await assert.rejects(competing,/変更/);assert.equal(Number((await db.query('select count(*) n from rounds where event_id=$1',[e.eid])).rows[0].n),2);
    await db.exec('begin');await gen(e,3,2,next,92015);const settingDuringGeneration=second.query(sql,[e.eid,3,'[]',id(91031)]);await db.exec('commit');await assert.rejects(settingDuringGeneration,/別端末/);assert.equal((await state(e.eid)).pairs.length,1);
   }finally{await second.end();}
  });
  await t.test('手動の適用後SELECTと停止SQLも実行でき、停止後の通常イベントは既存操作を維持する',async()=>{
   await owner();await db.exec(sql('03_verify.sql'));await db.exec(sql('04_disable_mutations.sql'));
   const e=await event(728,4);await as();await assert.rejects(replace(e.eid,0,[],91030),/permission denied/);
   await db.query('insert into rounds(event_id,round_number) values($1,1)',[e.eid]);await db.query("update events set status='closed' where id=$1",[e.eid]);
   assert.equal((await state(e.eid)).used_fixed_pairs,false);
   await owner();await db.exec(sql('05_resume_mutations.sql'));const resumed=await event(738,6);await as();await replace(resumed.eid,0,[],91106);await gen(resumed,1,0,undefined,92108);await as(null,'anon');await assert.rejects(gen(resumed),/permission denied/);
  });
 } finally { if(client)await client.end();else await db.close(); }
});
