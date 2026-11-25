// 現行不具合と生成時履歴の再現。修正版の受入PASSとは区別する。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixedPairDatabase,id}=require('./fixtures/fixed-pair-db.cjs');
test('OTHER-02契約調査：適用/片方休憩/両方休憩の履歴が非固定入替も一律拒否することを再現',async t=>{
 const {db,as,event,rpc}=await fixedPairDatabase();let seq=900000;
 const req=()=>id(seq++);
 try{
  for(const n of ['0041_atomic_round_lineups.sql','0042_round_lineup_safety.sql','0043_match_results_one_per_match.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+n,'utf8'));
  await db.exec('update lineup_private.release_control set editing_enabled=true');
  const cases=[['両者出場',[0,1,2,3],1,0],['片方自動休憩',[0,2,3,4],0,1],['両方自動休憩',[2,3,4,5],0,0]];
  for(const [i,[label,slots,applied,split]] of cases.entries())await t.test(label,async()=>{
   const e=await event(700+i,7);await as();
   await rpc('replace_event_fixed_pairs',[e.eid,0,JSON.stringify([{id:req(),a:e.participants[0],b:e.participants[1]}]),req()]);
   const st=await rpc('get_event_fixed_pair_state',[e.eid,true]);
   const generated=await rpc('create_friendly_round',[JSON.stringify({eventId:e.eid,lineupRevision:0,revision:st.revision,lastRound:0,courtCount:1,mode:'normal',activeIds:e.participants,matches:[{court:1,teamA:slots.slice(0,2).map(n=>e.participants[n]),teamB:slots.slice(2).map(n=>e.participants[n])}],requestId:req()})]);
   const snap=()=>rpc('get_friendly_round_lineup',[e.eid,generated.round_id]);
   const s=await snap();assert.equal(s.audit.effective_pairs.length,1);assert.equal(s.audit.applied_pairs.length,applied);assert.equal(s.audit.split_pairs.length,split);assert.match(s.blocked_reason,/固定ペア/);
   const cards=s.cards.map(c=>({id:c.id,players:structuredClone(c.players)}));const a=cards[0].players.find(p=>p.participant_id===e.participants[2]),b=cards[0].players.find(p=>p.participant_id===e.participants[3]);[a.participant_id,b.participant_id]=[b.participant_id,a.participant_id];
   await assert.rejects(rpc('replace_friendly_round_lineup',[e.eid,generated.round_id,JSON.stringify(s),JSON.stringify(cards),req()]),/固定ペア/);assert.deepEqual(await snap(),s);
   await rpc('replace_event_fixed_pairs',[e.eid,st.revision+1,'[]',req()]);
   const after=await snap();assert.deepEqual(after.audit,s.audit);assert.match(after.blocked_reason,/固定ペア/);
  });
 }finally{await db.close();}
});
