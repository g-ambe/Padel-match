const {test}=require('node:test'),assert=require('node:assert/strict');
const {lineupFixture,candidate,fingerprint,id}=require('./fixtures/lineup-home-court-candidates.cjs');
const clone=structuredClone;
function swapped(f,s,a,b){const c=f.cards(s);for(const card of c)for(const p of card.players){if(p.participant_id===a)p.participant_id=b;else if(p.participant_id===b)p.participant_id=a;}return c;}
const stableAudit=a=>{const c=clone(a);delete c.played_ids;return c;};
test('01候補：原文適用、保護履歴・非固定入替・既存認可/CAS・スコア/生成/削除',async t=>{
 const f=await lineupFixture();const {db,as,rpc}=f;
 try{
  for(const [label,from,to] of [['同一コート',4,6],['別コート',2,4],['休憩者',2,8]])await t.test(label,async()=>{
   const e=await f.seed(9,[[0,1]]),s=await f.snap(e),cards=swapped(f,s,e.participants[from],e.participants[to]);
   assert.equal(s.lineup_protection_version,1);assert.deepEqual(s.protected_participant_ids,e.participants.slice(0,2));assert.equal(s.blocked_reason,null);
   const result=await f.edit(e,s,cards),after=await f.snap(e);assert.deepEqual(after,result.snapshot);
   assert.deepEqual(stableAudit(after.audit),stableAudit(s.audit));assert.deepEqual(after.audit.played_ids,cards.flatMap(c=>c.players.map(p=>p.participant_id)).sort());assert.deepEqual(after.fixed.pairs,s.fixed.pairs);assert.equal(after.fixed.used_fixed_pairs,s.fixed.used_fixed_pairs);
   assert.equal(after.revision,s.revision+1);assert.equal(after.event_revision,s.event_revision+1);assert.equal((await db.query('select * from match_results')).rows.length,0);
   assert.deepEqual(after.fixed.eligible_rounds.find(r=>r.round===1).played,after.audit.played_ids);
   const state=await rpc('get_event_fixed_pair_state',[e.eid,true]),v=await rpc('get_friendly_lineup_versions',[e.eid]);
   const next=await rpc('create_friendly_round',[JSON.stringify({eventId:e.eid,lineupRevision:v.event_revision,revision:state.revision,lastRound:1,courtCount:2,mode:'normal',activeIds:e.participants,matches:[{court:1,teamA:e.participants.slice(0,2),teamB:e.participants.slice(2,4)},{court:2,teamA:e.participants.slice(4,6),teamB:e.participants.slice(6,8)}],requestId:f.req()})]);assert.equal(next.round_number,2);assert.deepEqual(stableAudit((await f.snap(e)).audit),stableAudit(s.audit));
  });
  for(const [label,pairs,slots,exchange] of [['片方休憩',[[0,1]],[0,2,3,4],[2,3]],['両方休憩',[[0,1]],[2,3,4,5],[2,4]],['複数固定',[[0,1],[4,5]],[0,1,2,3,4,5,6,7],[2,6]]])await t.test(label,async()=>{
   const e=await f.seed(9,pairs,slots),s=await f.snap(e);assert.equal(s.blocked_reason,null);assert.deepEqual(s.protected_participant_ids,pairs.flat().map(i=>e.participants[i]).sort());
   const cards=swapped(f,s,e.participants[exchange[0]],e.participants[exchange[1]]);await f.edit(e,s,cards);let current=await f.snap(e);assert.deepEqual(stableAudit(current.audit),stableAudit(s.audit));
   for(const [a,b] of [[0,2],[1,2],[0,4]])await assert.rejects(f.edit(e,current,swapped(f,current,e.participants[a],e.participants[b])),error=>error.code==='22023');
   const moved=f.cards(current);for(const card of moved)for(const p of card.players)if([e.participants[0],e.participants[1]].includes(p.participant_id))p.team=p.team==='A'?'B':'A';
   if(slots.includes(0)&&slots.includes(1))await assert.rejects(f.edit(e,current,moved));
   assert.deepEqual(await f.snap(e),current);
   const fixed=await rpc('get_event_fixed_pair_state',[e.eid,true]);await rpc('replace_event_fixed_pairs',[e.eid,fixed.revision,'[]',f.req()]);current=await f.snap(e);assert.deepEqual(current.protected_participant_ids,s.protected_participant_ids);await assert.rejects(f.edit(e,current,swapped(f,current,e.participants[0],e.participants[2])),/固定ペア/);
  });
  await t.test('固定ペア全体の別コート移動も禁止',async()=>{
   const e=await f.seed(9,[[0,1]]),s=await f.snap(e);let cards=swapped(f,s,e.participants[0],e.participants[4]);cards=swapped(f,{...s,cards:cards.map(c=>({...c,completed:false}))},e.participants[1],e.participants[5]);await assert.rejects(f.edit(e,s,cards),/固定ペア/);assert.deepEqual(await f.snap(e),s);
  });
  await t.test('固定なし/4人以下の一時停止を維持',async()=>{
   for(const [count,pairs,slots] of [[9,[],[0,1,2,3,4,5,6,7]],[5,[[0,1]],[0,1,2,3]]]){
    const e=await f.seed(count,pairs,slots,pairs.length?{rest:[4]}:{}),s=await f.snap(e);assert.deepEqual(s.protected_participant_ids,[]);await f.edit(e,s,swapped(f,s,e.participants[0],e.participants[2]));assert.deepEqual((await f.snap(e)).audit.effective_pairs,[]);
   }
  });
  await t.test('明示休みで一時停止した固定は保護を新設しない',async()=>{
   const e=await f.event(8000,6,{courts:1});await as();await rpc('replace_event_fixed_pairs',[e.eid,0,JSON.stringify([{id:f.req(),a:e.participants[0],b:e.participants[1]}]),f.req()]);await db.query("update event_participants set status='resting' where id=$1",[e.participants[1]]);
   const state=await rpc('get_event_fixed_pair_state',[e.eid,true]);const gen=await rpc('create_friendly_round',[JSON.stringify({eventId:e.eid,lineupRevision:0,revision:state.revision,lastRound:0,courtCount:1,mode:'normal',activeIds:e.participants.filter((_,i)=>i!==1),matches:[{court:1,teamA:[e.participants[0],e.participants[2]],teamB:[e.participants[3],e.participants[4]]}],requestId:f.req()})]);e.rid=gen.round_id;const s=await f.snap(e);assert.deepEqual(s.protected_participant_ids,[]);await f.edit(e,s,swapped(f,s,e.participants[0],e.participants[5]));
  });
  await t.test('新旧snapshot/CAS改ざん・資格・重複を拒否',async()=>{
   const e=await f.seed(9,[[0,1]]),s=await f.snap(e),cards=swapped(f,s,e.participants[2],e.participants[8]);
   for(const expected of [{...s,protected_participant_ids:[]},{...s,lineup_protection_version:2},Object.fromEntries(Object.entries(s).filter(([k])=>!['lineup_protection_version','protected_participant_ids'].includes(k)))])await assert.rejects(f.edit(e,expected,cards),e=>e.code==='40001');
   const dup=f.cards(s);dup[0].players[2].participant_id=dup[1].players[0].participant_id;await assert.rejects(f.edit(e,s,dup),/重複/);await db.query("update event_participants set status='resting' where id=$1",[e.participants[8]]);await assert.rejects(f.edit(e,s,cards),e=>e.code==='40001');await assert.rejects(f.edit(e,await f.snap(e),cards),/参加可能/);
  });
  await t.test('匿名/別グループ/退会者・直接DMLの拒否、在籍役職権限を維持',async()=>{
   const e=await f.seed(9,[[0,1]]),s=await f.snap(e),cards=swapped(f,s,e.participants[2],e.participants[8]);
   for(const actor of [1,2,3,6]){await as(actor);assert.equal((await f.snap(e)).round_id,e.rid);}
   for(const actor of [4,5]){await as(actor);await assert.rejects(f.snap(e),/権限/);await assert.rejects(f.edit(e,s,cards),/権限/);}
   await as(null,'anon');await assert.rejects(f.edit(e,s,cards),/permission denied/);await as();await assert.rejects(db.query('update match_players set participant_id=$1 where match_id=$2',[e.participants[8],s.cards[0].id]),/変更できません|専用/);assert.deepEqual(await f.snap(e),s);
  });
  await t.test('同一操作ID再送/CASの逐次競合と監査1件',async()=>{
   const e=await f.seed(9,[[0,1]]),s=await f.snap(e),cards=swapped(f,s,e.participants[2],e.participants[8]),req=f.req();const result=await f.edit(e,s,cards,req);assert.deepEqual(await f.edit(e,s,cards,req),result);await assert.rejects(f.edit(e,s,cards),e=>e.code==='40001');await assert.rejects(f.edit(e,s,f.cards(s),req),/再利用/);assert.equal((await db.query('select count(*)::int n from friendly_match_operations where request_id=$1',[req])).rows[0].n,1);
  });
  await t.test('得点済み/終了/停止を維持し、スコア・削除は追加DTOをそのまま使える',async()=>{
   const e=await f.seed(9,[[0,1]]),s=await f.snap(e),m=s.cards[0];await rpc('save_friendly_match_score',[e.eid,m.id,s.revision,JSON.stringify(m.players),JSON.stringify({completed:m.completed,results:m.result}),3,1,f.req()]);const current=await f.snap(e);await assert.rejects(f.edit(e,current,swapped(f,current,e.participants[2],e.participants[8])),/スコア/);
   await rpc('delete_friendly_match',[e.eid,m.id,JSON.stringify(current),f.req()]);assert.deepEqual(stableAudit((await f.snap(e)).audit),stableAudit(s.audit));
   const other=await f.seed(9,[[0,1]]),before=await f.snap(other);await db.exec('reset role');await db.query("update events set status='closed' where id=$1",[other.eid]);await as();await assert.rejects(f.edit(other,await f.snap(other),swapped(f,before,other.participants[2],other.participants[8])),/終了済み/);
   await db.exec('reset role;update lineup_private.release_control set editing_enabled=false');await as();await assert.rejects(f.edit(other,before,f.cards(before)),/停止中/);await db.exec('reset role;update lineup_private.release_control set editing_enabled=true');
  });
  await t.test('途中失敗は構成/履歴/版/監査すべてrollback',async()=>{
   const e=await f.seed(9,[[0,1]]),s=await f.snap(e);await db.exec(`reset role;create function public.candidate_fail() returns trigger language plpgsql as $$begin raise exception '注入失敗';end$$;create trigger candidate_fail before update on match_players for each row execute function public.candidate_fail();`);await as();await assert.rejects(f.edit(e,s,swapped(f,s,e.participants[2],e.participants[8])),/注入失敗/);assert.deepEqual(await f.snap(e),s);await db.exec('reset role;drop trigger candidate_fail on match_players;drop function public.candidate_fail()');
  });
  await t.test('生成監査だけのグループなしは従来通り、生成履歴不明は拒否',async()=>{
   const known=await f.seed(9,[],[0,1,2,3,4,5,6,7],{noGroup:true}),s=await f.snap(known);assert.equal(s.audit,null);assert.equal(s.blocked_reason,null);await f.edit(known,s,swapped(f,s,known.participants[2],known.participants[8]));
   const e=await f.event(8800,5,{noGroup:true});const r=(await db.query('insert into rounds(event_id,round_number) values($1,1) returning id',[e.eid])).rows[0].id;const m=(await db.query('insert into matches(event_id,round_id,court_number) values($1,$2,1) returning id',[e.eid,r])).rows[0].id;for(let i=0;i<4;i++)await db.query('insert into match_players(match_id,participant_id,team) values($1,$2,$3)',[m,e.participants[i],i<2?'A':'B']);e.rid=r;await as(1);const unknown=await f.snap(e);assert.match(unknown.blocked_reason,/生成時/);await assert.rejects(f.edit(e,unknown,swapped(f,unknown,e.participants[0],e.participants[4])),/生成時/);
  });
  await t.test('異常な固定監査はfail closed',async()=>{
   for(const bad of [{effective_pairs:[{id:id(91),a:'bad',b:id(92)}]},{effective_pairs:[{id:id(91),a:id(92),b:id(92)}]},{effective_pairs:[],applied_pairs:[{id:id(91),a:id(92),b:id(93),match_id:id(94)}]}]){
    const e=await f.seed(9,[[0,1]]);await db.exec('reset role');for(const [k,v]of Object.entries(bad))await db.query(`update event_fixed_pair_rounds set ${k}=$1 where round_id=$2`,[JSON.stringify(v),e.rid]);await as();const s=await f.snap(e);assert.match(s.blocked_reason,/履歴を確認/);await assert.rejects(f.edit(e,s,swapped(f,s,e.participants[2],e.participants[8])),/履歴を確認/);
   }
  });
 }finally{await db.close();}
});
