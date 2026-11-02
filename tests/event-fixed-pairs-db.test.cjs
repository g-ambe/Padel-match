const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixedPairDatabase,id}=require('./fixtures/fixed-pair-db.cjs');
const fs=require('node:fs'),path=require('node:path');
const sql=name=>fs.readFileSync(path.join(__dirname,'../supabase/maintenance/event-fixed-pairs',name),'utf8');

// 通常は組み込みPostgreSQLで実行。別途、空のローカルPostgreSQL 17でも同じ試験を実行する。
test('固定ペアのDB保存・権限・生成・戦績反映を実際のSQLで検証する',async t=>{
 let client,adapter;
 if(process.env.FIXED_PAIR_PG_URL){const {Client}=require('pg');client=new Client({connectionString:process.env.FIXED_PAIR_PG_URL});await client.connect();adapter={exec:sql=>client.query(sql),query:(sql,args)=>client.query(sql,args)};}
 const f=await fixedPairDatabase(false,adapter),{db,as,event,rpc,migration}=f;
 const owner=()=>db.exec('reset role');
 const count=async table=>Number((await db.query(`select count(*) n from public.${table}`)).rows[0].n);
 const snapshot=async()=>JSON.parse(JSON.stringify((await db.query(`select jsonb_build_object(
 'rows',(select jsonb_agg(to_jsonb(e) order by id) from events e),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
 'acl',(select jsonb_agg(jsonb_build_array(relname,relacl) order by relname) from pg_class where oid in('events'::regclass,'event_participants'::regclass,'rounds'::regclass,'matches'::regclass,'match_players'::regclass,'match_results'::regclass))) data`)).rows[0].data));
 const state=eid=>rpc('get_event_fixed_pair_state',[eid,true]);
 const pair=(p,index=0)=>({id:id(90000+index),a:p[0],b:p[1]});
 const replace=(eid,rev,pairs,req=91000)=>rpc('replace_event_fixed_pairs',[eid,rev,JSON.stringify(pairs),id(req)]);
 const gen=(e,rev=1,last=0,cards,req=92000,mode='normal',active=e.participants,courts=1)=>rpc('create_fixed_pair_round',[e.eid,rev,last,courts,mode,active,JSON.stringify(cards??[{court:1,teamA:e.participants.slice(0,2),teamB:e.participants.slice(2,4)}]),id(req)]);
 try {
  await t.test('追加Migrationは既存行・既存RLS・権限を変更せず、表示だけでは設定行を作らない',async()=>{
   const e=await event(700,6),before=await snapshot();await db.exec(sql('02_backup.sql'));await db.exec(migration);const after=await snapshot();
   assert.deepEqual(after.rows,before.rows);assert.deepEqual(after.acl,before.acl);assert.deepEqual(after.policies.filter(p=>!p.tablename.startsWith('event_fixed_pair')),before.policies);
   for(const n of [1,2,3,6]){await as(n);assert.equal((await state(e.eid)).revision,0);}
   await owner();for(const table of ['event_fixed_pair_state','event_fixed_pairs','event_fixed_pair_rounds'])assert.equal(await count(table),0);
   const other=await event(729,5),ids=other.participants.slice(0,2).sort();await assert.rejects(db.query('insert into event_fixed_pairs(id,event_id,a,b) values($1,$2,$3,$4)',[id(90999),e.eid,...ids]),/foreign key/);
  });
  await t.test('本人所属・旧profile_id・管理者・super_userを許可し、別グループ・退会・匿名を拒否する',async()=>{
   const e=await event(701,6);await as();await replace(e.eid,0,[pair(e.participants)],91001);
   for(const n of [1,2,3,6]){await as(n);assert.equal((await state(e.eid)).pairs.length,1);}
   for(const [n,role]of [[4,'authenticated'],[5,'authenticated'],[null,'anon'],[null,'authenticated']]){await as(n,role);await assert.rejects(state(e.eid),/権限|permission denied/);await assert.rejects(replace(e.eid,1,[],91002),/権限|permission denied/);}
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
  await t.test('5人の片方自動休憩だけでは利用済みにせず、4人では設定を残して無視する',async()=>{
   const e=await event(721,5);await as();await replace(e.eid,0,[pair(e.participants,21)],91022);
   const p=e.participants;await gen(e,1,0,[{court:1,teamA:[p[0],p[2]],teamB:[p[3],p[4]]}],92002);
   assert.equal((await state(e.eid)).used_fixed_pairs,false);const a=(await db.query('select applied_pairs,split_pairs from event_fixed_pair_rounds where event_id=$1',[e.eid])).rows[0];assert.equal(a.applied_pairs.length,0);assert.equal(a.split_pairs.length,1);assert.equal((await state(e.eid)).pairs.length,1);
   await db.query("update event_participants set status='resting' where id=$1",[p[1]]);await gen(e,2,1,[{court:1,teamA:[p[0],p[3]],teamB:[p[2],p[4]]}],92003,'normal',p.filter(x=>x!==p[1]));assert.equal((await state(e.eid)).used_fixed_pairs,false);
  });
  await t.test('参加状況・面数・固定維持・選手重複・特別モード未解放をDBでも検査する',async()=>{
   const e=await event(722,6);await as();await replace(e.eid,0,[pair(e.participants,22)],91023);const p=e.participants;
   for(const cards of [[{court:1,teamA:[p[0],p[2]],teamB:[p[3],p[4]]}],[{court:1,teamA:[p[0],p[2]],teamB:[p[1],p[3]]}],[{court:1,teamA:[p[0],p[1]],teamB:[p[2],p[2]]}]])await assert.rejects(gen(e,1,0,cards,92004),/固定ペア|同じイベント/);
   await assert.rejects(gen(e,1,0,undefined,92005,'normal',p.slice(1)),/生成対象者/);await assert.rejects(gen(e,1,0,undefined,92006,'normal',p,2),/面数/);
   await assert.rejects(gen(e,1,0,undefined,92007,'balance'),/10試合/);
   await db.query("update event_participants set status='absent' where id=$1",[p[1]]);await assert.rejects(gen(e,1,0,[{court:1,teamA:[p[0],p[2]],teamB:[p[3],p[4]]}],92008,'normal',p.filter(x=>x!==p[1])),/片方/);
   assert.equal((await state(e.eid)).revision,1);assert.equal(Number((await db.query('select count(*) n from rounds where event_id=$1',[e.eid])).rows[0].n),0);
   const impossible=await event(723,9,{courts:2});await as();await replace(impossible.eid,0,[pair(impossible.participants,23)],91024);const q=impossible.participants;await assert.rejects(gen(impossible,1,0,[{court:1,teamA:q.slice(0,2),teamB:q.slice(2,4)},{court:2,teamA:q.slice(4,6),teamB:q.slice(6,8)}],92009,'normal',q,2),/公平な休憩/);
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
   }finally{await second.end();}
  });
  await t.test('手動の適用後SELECTと停止SQLも実行でき、停止後の通常イベントは既存操作を維持する',async()=>{
   await owner();await db.exec(sql('03_verify.sql'));await db.exec(sql('04_disable_mutations.sql'));
   const e=await event(728,4);await as();await assert.rejects(replace(e.eid,0,[],91030),/permission denied/);
   await db.query('insert into rounds(event_id,round_number) values($1,1)',[e.eid]);await db.query("update events set status='closed' where id=$1",[e.eid]);
   assert.equal((await state(e.eid)).used_fixed_pairs,false);
  });
 } finally { if(client)await client.end();else await db.close(); }
});
