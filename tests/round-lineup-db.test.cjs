const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixedPairDatabase,id}=require('./fixtures/fixed-pair-db.cjs');
const migration=fs.readFileSync('supabase/migrations/0041_atomic_round_lineups.sql','utf8');
const copy=v=>structuredClone(v);

test('Round入替・スコアCAS・旧経路拒否を実SQLで検証する',async t=>{
 let client,monitor,Client;const external=process.env.LINEUP_PG_URL;
 if(external){const u=new URL(external);assert(['127.0.0.1','localhost'].includes(u.hostname)&&u.pathname==='/lineup_test','専用ローカルDBのみ使用する');({Client}=require('pg'));client=new Client({connectionString:external});await client.connect();}
 const adapter=client?{exec:s=>client.query(s),query:(s,a)=>client.query(s,a)}:undefined;
 let f;
 try{
 f=await fixedPairDatabase(true,adapter);const {db,as,event,rpc}=f;
 const owner=()=>db.exec('reset role');let seq=10000000,ev=1000;
 const requestId=()=>id(seq++);
 const metadata=async()=>JSON.stringify((await db.query("select (select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public' and tablename in('events','rounds','matches','match_players','match_results','event_participants')) policies,(select jsonb_agg(pg_get_functiondef(oid) order by oid) from pg_proc where pronamespace in('fixed_pair_private'::regnamespace,'match_identity_private'::regnamespace)) functions")).rows);
 const before=await metadata();
 const legacy=await event(1999,5);const legacyRound=(await db.query('insert into rounds(event_id,round_number) values($1,1) returning id',[legacy.eid])).rows[0].id;
 const legacyMatch=(await db.query('insert into matches(event_id,round_id,court_number,completed,youtube_url) values($1,$2,1,true,$3) returning id',[legacy.eid,legacyRound,'https://youtu.be/preserved'])).rows[0].id;
 for(let i=0;i<4;i++)await db.query('insert into match_players(match_id,participant_id,team) values($1,$2,$3)',[legacyMatch,legacy.participants[i],i<2?'A':'B']);await db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,4,2,'A')",[legacyMatch]);
 const data=async()=>JSON.stringify((await db.query("select (select jsonb_agg(to_jsonb(m) order by id) from matches m) matches,(select jsonb_agg(to_jsonb(m) order by id) from match_players m) players,(select jsonb_agg(to_jsonb(m) order by id) from match_results m) results,(select jsonb_agg(to_jsonb(m) order by id) from event_participants m) participants,(select jsonb_agg(to_jsonb(m) order by id) from player_profiles m) profiles")).rows);
 const beforeData=await data();const maintenance=name=>fs.readFileSync('supabase/maintenance/round-lineups/'+name,'utf8');
 await db.exec(maintenance('01_preflight.sql'));await db.exec(maintenance('02_backup.sql'));await db.exec(migration);
 // 0041単体の穴を実際のauthenticated権限で再現し、各試験をROLLBACKする。
 await db.query('insert into friendly_round_lineup_state values($1,$2,1)',[legacyRound,legacy.eid]);
 for (const table of ['match_players','match_results','matches','rounds']) {
  await as();await db.exec('begin');
  const q=table==='rounds'?['id',legacyRound]:table==='matches'?['id',legacyMatch]:['match_id',legacyMatch];
  const deleted=await db.query('delete from '+table+' where '+q[0]+'=$1 returning id',[q[1]]);assert(deleted.rows.length>0,'0041単体の直接DELETEを再現: '+table);await db.exec('rollback');
 }
 await owner();await db.query('delete from friendly_round_lineup_state where round_id=$1',[legacyRound]);
 await db.exec(fs.readFileSync('supabase/migrations/0042_round_lineup_safety.sql','utf8'));await db.exec(maintenance('03_verify.sql'));
 assert.equal(await metadata(),before,'既存RLS・固定・IDガードの定義を維持');assert.equal(await data(),beforeData,'既存履歴・プロフィールを変更しない');
 const versions=e=>rpc('get_friendly_lineup_versions',[e.eid]);
 const snap=e=>rpc('get_friendly_round_lineup',[e.eid,e.rid]);
 const gen=async(e,extra={})=>{
  const s=await versions(e),fixed=e.noGroup?{revision:0}:await rpc('get_event_fixed_pair_state',[e.eid,true]);
  const req={eventId:e.eid,lineupRevision:s.event_revision,revision:fixed.revision,lastRound:e.round??0,courtCount:e.courts,mode:'normal',activeIds:e.participants,matches:Array.from({length:e.courts},(_,i)=>({court:i+1,teamA:e.participants.slice(i*4,i*4+2),teamB:e.participants.slice(i*4+2,i*4+4)})),requestId:requestId(),...extra};
  const r=await rpc('create_friendly_round',[JSON.stringify(req)]);assert.equal((await db.query('select changed_rows from friendly_match_operations where request_id=$1',[req.requestId])).rows[0].changed_rows,1+5*req.matches.length);e.rid=r.round_id;e.round=r.round_number;return req;
 };
 const seed=async(count=9,courts=2,extra={})=>{const e={...await event(ev++,count,{courts,...extra}),courts,...extra};await as(extra.noGroup?1:3);await gen(e);return e;};
 const changed=(s,other)=>{const c=copy(s.cards).map(m=>({id:m.id,players:m.players}));const from=c[0].players[0].participant_id,to=other??c[1]?.players[0].participant_id??c[0].players[1].participant_id;for(const m of c)for(const p of m.players)p.participant_id=p.participant_id===from?to:p.participant_id===to?from:p.participant_id;return c;};
 const edit=(e,s,c=changed(s),rid=requestId())=>rpc('replace_friendly_round_lineup',[e.eid,e.rid,JSON.stringify(s),JSON.stringify(c),rid]);
 const scoreArgs=(e,s,mid=s.cards[0].id,rid=requestId())=>{const m=s.cards.find(c=>c.id===mid);return[e.eid,mid,s.revision,JSON.stringify(m.players),JSON.stringify({completed:m.completed,results:m.result}),0,0,rid];};
 const score=(e,s,mid,rid)=>rpc('save_friendly_match_score',scoreArgs(e,s,mid,rid));
 await t.test('Migration直後は入替停止、通常スコアRPCは原子的に利用できる',async()=>{const e=await seed();assert.equal((await versions(e)).editing_enabled,false);const s=await snap(e);await assert.rejects(edit(e,s),/停止中/);await score(e,s);assert.equal((await snap(e)).cards[0].completed,true);await owner();await db.exec('update lineup_private.release_control set editing_enabled=true');});
 await t.test('同コート・別コート・休憩者を入替し、ID・日時・動画・参加機会を維持',async()=>{
  for(const kind of ['same','cross','bench']){const e=await seed();const s=await snap(e);const beforeRows=(await db.query('select id,match_id,team from match_players where match_id=any($1) order by id',[s.cards.map(c=>c.id)])).rows;
   const beforeMatches=(await db.query('select * from matches where round_id=$1 order by id',[e.rid])).rows;
   const to=kind==='same'?s.cards[0].players[2].participant_id:kind==='bench'?e.participants[8]:undefined;
   const r=await edit(e,s,changed(s,to));assert.equal(r.snapshot.revision,1);assert.equal(r.snapshot.event_revision,1);assert.equal((await versions(e)).event_revision,1);
   assert.deepEqual((await db.query('select id,match_id,team from match_players where match_id=any($1) order by id',[s.cards.map(c=>c.id)])).rows,beforeRows);
   assert.deepEqual((await db.query('select * from matches where round_id=$1 order by id',[e.rid])).rows,beforeMatches);
   const audit=(await db.query('select * from event_fixed_pair_rounds where round_id=$1',[e.rid])).rows[0];assert.deepEqual(audit.eligible_ids,s.audit.eligible_ids);assert.deepEqual(audit.request_body,s.audit.request_body);assert.deepEqual(audit.effective_pairs,[]);assert.equal(new Set(r.snapshot.cards.flatMap(c=>c.players.map(p=>p.participant_id))).size,8);assert.equal((await rpc('get_event_fixed_pair_state',[e.eid,true])).used_fixed_pairs,false);
  }
 });
 await t.test('同じ要求の再送は監査1件、内容違い・別本人・古い期待値は拒否',async()=>{const e=await seed(),s=await snap(e),cards=changed(s),req=requestId();const a=await edit(e,s,cards,req);assert.deepEqual(await edit(e,s,cards,req),a);assert.equal(Number((await db.query("select count(*) n from friendly_match_operations where request_id=$1",[req])).rows[0].n),1);await assert.rejects(edit(e,s,changed(s,e.participants[8]),req),/再利用/);await assert.rejects(edit(e,s),/変更されています/);await as(1);await assert.rejects(edit(e,s,cards,req),/再利用/);});
 await t.test('重複・別Round・不完全カード・参加状態変更は全体ROLLBACK',async()=>{const e=await seed(),s=await snap(e);const duplicated=changed(s);duplicated[1].players[1].participant_id=duplicated[0].players[0].participant_id;await assert.rejects(edit(e,s,duplicated),/重複/);assert.deepEqual(await snap(e),s);const broken=changed(s);broken[1].players.pop();await assert.rejects(edit(e,s,broken),/4名/);assert.deepEqual(await snap(e),s);await db.query("update event_participants set status='resting' where id=$1",[e.participants[8]]);await assert.rejects(edit(e,s,changed(s,e.participants[8])),/変更されています/);});
 await t.test('スコア済みカードを変更せず、他の未入力カードだけ編集できる',async()=>{const e=await seed(),s=await snap(e);await score(e,s,s.cards[1].id);const current=await snap(e),cards=changed(current,e.participants[8]);const result=await edit(e,current,cards);assert.deepEqual(result.snapshot.cards[1],current.cards[1]);const again=await snap(e);await assert.rejects(edit(e,again,changed(again)),/スコア入力済み/);});
 await t.test('入替後の旧スコア・直接構成変更・旧生成をDBで拒否、対応RPCと再試行は成功',async()=>{const e=await seed(),s=await snap(e);await edit(e,s);await assert.rejects(score(e,s),/構成または結果/);await assert.rejects(db.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,1,0,'A')",[s.cards[0].id]),/専用保存/);await assert.rejects(db.query('update match_players set participant_id=$1 where match_id=$2',[e.participants[8],s.cards[0].id]),/変更できません|専用/);await assert.rejects(db.query('insert into rounds(event_id,round_number) values($1,2)',[e.eid]),/専用保存/);await assert.rejects(rpc('create_fixed_pair_round',[e.eid,2,1,2,'normal',e.participants,'[]',requestId()]),/対応済み画面/);const current=await snap(e),req=requestId();const a=await score(e,current,undefined,req);assert.deepEqual(await score(e,current,undefined,req),a);assert.equal(Number((await db.query('select count(*) n from match_results where match_id=$1',[s.cards[0].id])).rows[0].n),1);await gen(e);assert.equal(e.round,2);});
 await t.test('固定0組の出場履歴は更新し、固定使用済みRound・解除後の使用履歴は維持して拒否',async()=>{const e={...await event(ev++,9,{courts:2}),courts:2};await as();await rpc('replace_event_fixed_pairs',[e.eid,0,JSON.stringify([{id:requestId(),a:e.participants[0],b:e.participants[1]}]),requestId()]);await gen(e);const s=await snap(e);assert.match(s.blocked_reason,/固定ペア/);await assert.rejects(edit(e,s),/固定ペア/);const fixed=await rpc('get_event_fixed_pair_state',[e.eid,true]);await rpc('replace_event_fixed_pairs',[e.eid,fixed.revision,'[]',requestId()]);await assert.rejects(edit(e,await snap(e)),/固定ペア/);assert.equal((await rpc('get_event_fixed_pair_state',[e.eid,true])).used_fixed_pairs,true);});
 await t.test('グループなしは作成者・super_userだけ、一般メンバー・管理者は所属内で操作可能',async()=>{
  const e=await seed();const s=await snap(e);for(const n of [1,2,3,6]){await as(n);assert.equal((await snap(e)).round_id,e.rid);}for(const n of [4,5]){await as(n);await assert.rejects(snap(e),/権限/);await assert.rejects(edit(e,s),/権限/);assert.equal((await db.query('select * from friendly_round_lineup_state')).rows.length,0);}
  await as(null,'anon');await assert.rejects(snap(e),/permission denied/);await as(3);await assert.rejects(db.query('delete from friendly_match_operations'),/permission denied/);
  const solo=await seed(5,1,{noGroup:true}),soloSnap=await snap(solo);await edit(solo,soloSnap,changed(soloSnap,solo.participants[4]));await as(3);await assert.rejects(snap(solo),/権限/);await as(1);await gen(solo);assert.equal(solo.round,2);
 });
 await t.test('グループなしでも新生成の既知の参加機会を使い、後から追加された人を過去の休憩者にしない',async()=>{
  const e=await seed(5,1,{noGroup:true}),late=requestId();await owner();await db.query("insert into event_participants(id,event_id,guest_name,status,participant_type) values($1,$2,'途中参加','active','guest')",[late,e.eid]);await as(1);const s=await snap(e);assert(!s.eligible.includes(late));await assert.rejects(edit(e,s,changed(s,late)),/参加可能/);assert.equal((await snap(e)).revision,0);
 });
 await t.test('未知の過去Roundは現在activeでも入替不可、スコア保存・正規削除は維持',async()=>{
  await as();const e={...legacy,rid:legacyRound},s=await snap(e);assert.match(s.blocked_reason,/生成時/);assert.deepEqual(s.eligible,[]);await assert.rejects(edit(e,s,changed(s,legacy.participants[4])),/生成時/);
  await score(e,s);assert.equal((await snap(e)).cards[0].completed,true);
 });
 await t.test('authenticatedの直接DELETEを4表とも拒否し、構成・結果・履歴を保持',async()=>{
  const e=await seed(),s=await snap(e);await edit(e,s);await score(e,await snap(e));const before=await snap(e);
  for(const table of ['match_players','match_results','matches','rounds']){
   const q=table==='rounds'?['id',e.rid]:table==='matches'?['id',s.cards[0].id]:['match_id',s.cards[0].id];
   await assert.rejects(db.query('delete from '+table+' where '+q[0]+'=$1',[q[1]]),/専用削除/);assert.deepEqual(await snap(e),before);
  }
 });
 const remove=(e,s,mid=s.cards[0].id,req=requestId())=>rpc('delete_friendly_match',[e.eid,mid,JSON.stringify(s),req]);
 await t.test('正規削除はスコア・子行・空Round・番号詰めを原子的に確定し、再送・固定使用履歴を維持',async()=>{
  const e=await seed(),s=await snap(e);await score(e,s);const current=await snap(e),req=requestId(),mid=current.cards[0].id;const r=await remove(e,current,mid,req);assert.equal(r.removed_round,false);assert.deepEqual(await remove(e,current,mid,req),r);await assert.rejects(remove(e,current,current.cards[1].id,req),/再利用/);
  assert.equal((await snap(e)).revision,1);assert.equal((await versions(e)).event_revision,1);assert.equal((await db.query('select * from match_results where match_id=$1',[mid])).rows.length,0);
  await gen(e);const later=e.rid;const earlier={...e,rid:s.round_id};const last=await snap(earlier);await remove(earlier,last);assert.equal((await db.query('select round_number from rounds where id=$1',[later])).rows[0].round_number,1);
  await owner();assert.equal((await db.query('select * from event_fixed_pair_rounds where round_id is null and event_id=$1',[e.eid])).rows.length,1);await as();assert.equal((await versions(e)).event_revision,2);
 });
 await t.test('固定利用済みカードの正規削除でも固定設定・利用済み印・当時の参加履歴は保持',async()=>{
  const e={...await event(ev++,9,{courts:2}),courts:2};await as();await rpc('replace_event_fixed_pairs',[e.eid,0,JSON.stringify([{id:requestId(),a:e.participants[0],b:e.participants[1]}]),requestId()]);await gen(e);const s=await snap(e);assert.match(s.blocked_reason,/固定ペア/);await remove(e,s);const after=await snap(e);assert.deepEqual(after.audit,s.audit);assert.deepEqual(after.fixed.pairs,s.fixed.pairs);assert.equal(after.fixed.used_fixed_pairs,true);
 });
 await t.test('削除中の途中失敗は子行を含め全てROLLBACKし、期待値違い・他人の削除も拒否',async()=>{
  const e=await seed(),s=await snap(e);await owner();await db.exec(`create function public.lineup_delete_fail() returns trigger language plpgsql as $$begin raise exception '削除注入失敗';end$$;create trigger zz_delete_fail before delete on matches for each row execute function public.lineup_delete_fail()`);
  await as();await assert.rejects(remove(e,s),/削除注入失敗/);assert.deepEqual(await snap(e),s);await owner();await db.exec('drop trigger zz_delete_fail on matches;drop function public.lineup_delete_fail()');await as();await score(e,s);await assert.rejects(remove(e,s),/変更されています/);await as(4);await assert.rejects(remove(e,s),/権限/);await as(null,'anon');await assert.rejects(remove(e,s),/permission denied/);
 });
 await t.test('得点は既存integer仕様で0・引分・負数・修正を維持し、小数・未入力・範囲外は保存しない',async()=>{
  const e=await seed(),s=await snap(e);for(const [a,b] of [['1.5',0],['',0],[null,0],['2147483648',0],['NaN',0]]){const args=scoreArgs(e,s);args[5]=a;args[6]=b;await assert.rejects(rpc('save_friendly_match_score',args));assert.deepEqual(await snap(e),s);}
  // PostgRESTと同じJSONからintegerへの変換でも小数・範囲外は丸めて通らない。
  for(const a of [1.5,2147483648])await assert.rejects(db.query('select * from json_to_record($1::json) as x(a integer)',[JSON.stringify({a})]));
  await score(e,s);let now=await snap(e);assert.equal(now.cards[0].result[0].winner_team,'draw');const rid=now.cards[0].result[0].id;
  const args=scoreArgs(e,now);args[5]=-1;args[6]=0;await rpc('save_friendly_match_score',args);now=await snap(e);assert.equal(now.cards[0].result[0].score_a,-1);assert.equal(now.cards[0].result[0].winner_team,'B');assert.equal(now.cards[0].result[0].id,rid);
 });
 await t.test('2コート目の更新失敗は構成・版数・監査・参加履歴を全てROLLBACK',async()=>{const e=await seed(),s=await snap(e);await owner();await db.exec(`create function public.lineup_test_fail() returns trigger language plpgsql as $$begin if old.match_id='${s.cards[1].id}'::uuid then raise exception '注入失敗';end if;return new;end$$;create trigger zz_lineup_test_fail before update on match_players for each row execute function public.lineup_test_fail()`);await as();await assert.rejects(edit(e,s),/注入失敗/);assert.deepEqual(await snap(e),s);await owner();await db.exec('drop trigger zz_lineup_test_fail on match_players;drop function public.lineup_test_fail()');});
 await t.test('結果INSERT後の確定失敗も全体ROLLBACKし、再試行で1件だけ確定',async()=>{const e=await seed(),s=await snap(e),req=requestId();await owner();await db.exec(`create function public.lineup_test_fail() returns trigger language plpgsql as $$begin if new.id='${s.cards[0].id}'::uuid then raise exception '確定注入失敗';end if;return new;end$$;create trigger zz_lineup_test_fail before update on matches for each row execute function public.lineup_test_fail()`);await as();await assert.rejects(score(e,s,undefined,req),/確定注入失敗/);assert.deepEqual(await snap(e),s);await owner();await db.exec('drop trigger zz_lineup_test_fail on matches;drop function public.lineup_test_fail()');await as();await score(e,s,undefined,req);});
 await t.test('停止・再開SQLと復旧テンプレートの未承認ガードを検証する',async()=>{
  await owner();await db.exec(maintenance('04_disable.sql'));const e=await seed();await assert.rejects(edit(e,await snap(e)),/permission denied/);await owner();await assert.rejects(db.exec(maintenance('06_recover_reviewed.sql')),/未設定/);await db.exec('rollback');await db.exec(maintenance('05_enable.sql'));await as();await edit(e,await snap(e));
 });
 await t.test('承認済みの個別復旧はプレビューで戻さず、明示COMMITでは新しい監査・版数で復旧する',async()=>{
  const e=await seed(),before=await snap(e),req=requestId();await edit(e,before,changed(before),req);const after=await snap(e);await owner();await db.exec(maintenance('04_disable.sql'));
  const restore=maintenance('06_recover_reviewed.sql').replace('approved_request_id uuid:=null',`approved_request_id uuid:='${req}'`).replace('approved_operator_auth_id uuid:=null',`approved_operator_auth_id uuid:='${id(3)}'`);
  await db.exec(restore);await as();assert.deepEqual(await snap(e),after);await owner();await db.exec(restore.replace(/rollback;\s*$/i,'commit;'));await as();const recovered=await snap(e);assert.deepEqual(recovered.cards,before.cards);assert.equal(recovered.revision,2);assert.equal(recovered.event_revision,2);assert.equal((await versions(e)).editing_enabled,false);await owner();await db.exec(maintenance('05_enable.sql'));
 });
 await t.test('通常の論理削除は監査を維持し、直接の物理削除・ID再利用は監査参照で防ぐ',async()=>{
  const e=await seed();await as(1);await db.query('update events set is_deleted=true,deleted_at=now() where id=$1',[e.eid]);await assert.rejects(snap(e),/権限/);await owner();assert.equal(Number((await db.query('select count(*) n from friendly_match_operations where event_id=$1',[e.eid])).rows[0].n),1);await assert.rejects(db.query('delete from events where id=$1',[e.eid]),/foreign key/);
 });
 if(client){
  monitor=new Client({connectionString:external});await monitor.connect();
  const connection=async()=>{const c=new Client({connectionString:external});await c.connect();c.pid=(await c.query('select pg_backend_pid() id')).rows[0].id;await c.query("select set_config('request.jwt.claim.sub',$1,false)",[id(3)]);await c.query('set role authenticated');return c;};
  const waiting=async c=>{const end=Date.now()+5000;while(Date.now()<end){const row=(await monitor.query('select wait_event_type from pg_stat_activity where pid=$1',[c.pid])).rows[0];if(row?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error('2接続目がロック待機しませんでした');};
  const editSql='select replace_friendly_round_lineup($1,$2,$3,$4,$5) result',scoreSql='select save_friendly_match_score($1,$2,$3,$4,$5,$6,$7,$8) result';
  const editArgs=(e,s)=>[e.eid,e.rid,JSON.stringify(s),JSON.stringify(changed(s)),requestId()];
  const outcome=p=>p.then(value=>({value}),error=>({error}));
  for(const order of ['edit/edit','edit/score','score/edit','edit/legacy-score','legacy-score/edit','participant/edit','edit/participant','generate/edit','edit/generate','finish/edit','edit/finish','delete/edit','edit/delete','delete/score','score/delete','delete/generate','generate/delete','delete/finish','finish/delete','reopen/edit'])await t.test('PostgreSQL 17複数接続: '+order,async()=>{
   const e=await seed();if(order==='reopen/edit'){await owner();await db.query("update events set status='closed' where id=$1",[e.eid]);await as();}const s=await snap(e),b=await connection();
   const generateArgs={eventId:e.eid,lineupRevision:0,revision:1,lastRound:1,courtCount:2,mode:'normal',activeIds:e.participants,matches:[{court:1,teamA:e.participants.slice(0,2),teamB:e.participants.slice(2,4)},{court:2,teamA:e.participants.slice(4,6),teamB:e.participants.slice(6,8)}],requestId:requestId()};
   const call=async(c,kind)=>{
    if(kind==='delete')return c.query('select delete_friendly_match($1,$2,$3,$4)',[e.eid,s.cards[0].id,JSON.stringify(s),requestId()]);
    if(kind==='reopen')return c.query("select finish_fixed_pair_event($1,1,false,null)",[e.eid]);
    if(kind==='edit')return c.query(editSql,editArgs(e,s));if(kind==='score')return c.query(scoreSql,scoreArgs(e,s));
    if(kind==='legacy-score')return c.query("insert into match_results(match_id,score_a,score_b,winner_team) values($1,0,0,'draw')",[s.cards[0].id]);
    if(kind==='participant')return c.query("update event_participants set status='resting' where id=$1",[e.participants[8]]);
    if(kind==='generate')return c.query('select create_friendly_round($1)',[JSON.stringify(generateArgs)]);
    if(kind==='finish')return c.query("select finish_fixed_pair_event($1,1,true,'official')",[e.eid]);
   };
   try{
    const [first,second]=order.split('/');await db.exec('begin');await call(client,first);const pending=outcome(call(b,second));await waiting(b);await db.exec('commit');const result=await pending;
    if(order==='edit/participant'){assert(!result.error);assert.equal((await snap(e)).revision,1);}else assert(result.error,'競合する2番目の更新は拒否');
    const after=await snap(e);if(first==='edit')assert.equal(after.revision,1);else assert.equal(after.revision,first==='delete'?1:0);
    if(second==='score'||second==='legacy-score')assert(after.cards.every(c=>c.result.length===0));
   }finally{await db.exec('rollback');await b.end();}
  });
  for(const kind of ['lineup','score','delete'])await t.test('PostgreSQL 17同一要求の同時再送: '+kind,async()=>{
   const e=await seed(),s=await snap(e),b=await connection();const args=kind==='lineup'?editArgs(e,s):kind==='delete'?[e.eid,s.cards[0].id,JSON.stringify(s),requestId()]:scoreArgs(e,s),sql=kind==='lineup'?editSql:kind==='delete'?'select delete_friendly_match($1,$2,$3,$4) result':scoreSql;
   try{await db.exec('begin');const first=(await client.query(sql,args)).rows[0].result;const pending=outcome(b.query(sql,args));await waiting(b);await db.exec('commit');const second=await pending;assert(!second.error);assert.deepEqual(second.value.rows[0].result,first);assert.equal(Number((await db.query('select count(*) n from friendly_match_operations where request_id=$1',[args.at(-1)])).rows[0].n),1);}finally{await db.exec('rollback');await b.end();}
  });
 }
 }finally{if(monitor)await monitor.end();if(client)await client.end();else if(f)await f.db.close();}
});
