const {test}=require('node:test'),assert=require('node:assert/strict');
const base=require('./fixtures/friendly-round-helpers.cjs');
const {generateFriendlyRoundWithFixedPairs:generate,fixedRestFeasible,fixedPairAvailability}=require('../lib/friendly-fixed-pairs.ts');
const {idsFor,seededRandom,neutralHistory,card,friendlyPairKey}=base;
const params=(n,extra={})=>{const ids=idsFor(n);return{eventId:'event',participantIds:ids,knownParticipantIds:new Set(ids),courtCount:Math.min(5,Math.floor(n/4)),lastRound:12,history:neutralHistory(ids),mode:'normal',fixedPairs:[],random:seededRandom(1),...extra};};
const pairs=(ids,count)=>Array.from({length:count},(_,i)=>({id:'pair'+i,a:ids[i*2],b:ids[i*2+1]}));
const paired=(result,pair)=>result.matches.some(m=>[m.teamA,m.teamB].some(t=>t.includes(pair.a)&&t.includes(pair.b)));

test('固定0組は全モード・4〜20人で既存の結果と乱数消費を完全維持し、4人では設定を一時停止する',()=>{
 for(const n of[4,5,6,8,10,12,20])for(const mode of['normal','balance','rival'])for(let seed=1;seed<=8;seed++){
  const p=params(n,{mode}),a=seededRandom(seed),b=seededRandom(seed);assert.deepEqual(generate({...p,random:a}),base.generateFriendlyRound({...p,random:b}));assert.equal(a(),b());
 }
 const p=params(4);p.fixedPairs=pairs(p.participantIds,1);const snapshot=JSON.stringify(p.fixedPairs);assert(fixedPairAvailability(p.participantIds,p.fixedPairs).suspended);
 assert.deepEqual(generate(p),base.generateFriendlyRound({...p,random:seededRandom(1)}));assert.equal(JSON.stringify(p.fixedPairs),snapshot);
});

test('5人・1/2組固定で50Roundを生成し、片方の休憩・復帰と全員の公平な出場を確認する',()=>{
 for(const mode of['normal','balance','rival'])for(const count of[1,2]){
  const p=params(5,{mode}),ids=p.participantIds;p.fixedPairs=pairs(ids,count);p.eligibleRounds=[];
  const initial=JSON.stringify(p.fixedPairs),rests=new Map(ids.map(id=>[id,0]));let splits=0,applied=0,rejoined=false,previousSplit=false,consecutiveRest=0,lastRest;
  for(let step=0;step<50;step++){
   const r=generate({...p,random:seededRandom(90+step)}),playing=r.matches.flatMap(m=>[...m.teamA,...m.teamB]);assert.equal(r.resters.length,1);assert.equal(new Set(playing).size,4);
   if(!step)assert(!p.fixedPairs.some(pair=>r.resters.includes(pair.a)||r.resters.includes(pair.b)));
   if(lastRest===r.resters[0])consecutiveRest++;lastRest=r.resters[0];rests.set(lastRest,rests.get(lastRest)+1);
   for(const pair of p.fixedPairs)if(playing.includes(pair.a)&&playing.includes(pair.b)){assert(paired(r,pair));applied++;if(previousSplit)rejoined=true;}
   const split=p.fixedPairs.filter(pair=>playing.includes(pair.a)!==playing.includes(pair.b)).length;splits+=split;previousSplit=split>0;
   p.lastRound++;p.eligibleRounds.push({round:p.lastRound,eligible:[...ids],played:playing});for(const m of r.matches)p.history.push(card([...m.teamA,...m.teamB],p.lastRound));
   assert.equal(JSON.stringify(p.fixedPairs),initial);
  }
  assert(splits>0);assert(applied>0);assert(rejoined);assert.equal(consecutiveRest,0);assert.deepEqual([...rests.values()],[10,10,10,10,10]);
 }
});

test('6人以上はペア単位で出場・休憩し、未固定メンバーに休憩を集中させない',()=>{
 for(const[n,courts,count]of[[6,1,1],[6,1,3],[8,2,1],[8,1,2],[10,2,1],[10,2,3],[12,3,2],[20,5,2]])for(const mode of['normal','balance','rival']){
  const p=params(n,{courtCount:courts,mode}),ids=p.participantIds;p.fixedPairs=pairs(ids,count);p.eligibleRounds=[];
  const rests=new Map(ids.map(id=>[id,0]));
  for(let step=0;step<18;step++){
   const r=generate({...p,random:seededRandom(step+300)}),playing=new Set(r.matches.flatMap(m=>[...m.teamA,...m.teamB]));assert.equal(playing.size,r.matches.length*4);
   for(const pair of p.fixedPairs){assert.equal(playing.has(pair.a),playing.has(pair.b));if(playing.has(pair.a))assert(paired(r,pair));}
   for(const id of r.resters)rests.set(id,rests.get(id)+1);
   p.lastRound++;p.eligibleRounds.push({round:p.lastRound,eligible:[...ids],played:[...playing]});for(const m of r.matches)p.history.push(card([...m.teamA,...m.teamB],p.lastRound));
  }
  assert(Math.max(...rests.values())-Math.min(...rests.values())<=2,JSON.stringify({n,courts,count,mode,rests:[...rests]}));
 }
});

test('6人以上で公平性と同時休憩が両立しない構成は、5人例外を広げず調整を案内する',()=>{
 for(const[n,courts,count]of[[9,2,1],[13,3,1],[17,4,1],[11,2,4],[7,1,3]]){
  const p=params(n,{courtCount:courts});p.fixedPairs=pairs(p.participantIds,count);assert.equal(fixedRestFeasible(n,count,courts),false);assert.throws(()=>generate(p),/公平な休憩/);
 }
 assert(fixedRestFeasible(9,1,1));assert(fixedRestFeasible(10,2,2));
});

test('明示的な欠席・休みは5人の自動休憩例外にせず、4人への減少と復帰でも設定を保持する',()=>{
 const p=params(6);p.fixedPairs=pairs(p.participantIds,1);const saved=JSON.stringify(p.fixedPairs);
 assert.throws(()=>generate({...p,participantIds:p.participantIds.slice(1)}),/片方が欠席/);
 const four=p.participantIds.slice(1,5);assert.deepEqual(generate({...p,participantIds:four}),base.generateFriendlyRound({...p,participantIds:four,random:seededRandom(1)}));
 assert.equal(JSON.stringify(p.fixedPairs),saved);const resumed=generate({...p,random:seededRandom(2)});if(!resumed.resters.includes(p.fixedPairs[0].a))assert(paired(resumed,p.fixedPairs[0]));
 const bothOff=p.participantIds.slice(2);assert.equal(fixedPairAvailability(bothOff,p.fixedPairs).incomplete.length,0);
});

test('当時の参加可能者からだけ自動休憩を数え、欠席・明示休みを休憩履歴へ足さない',()=>{
 const p=params(6,{eligibleRounds:[]});p.fixedPairs=pairs(p.participantIds,1);
 for(let i=1;i<=20;i++)p.eligibleRounds.push({round:i,eligible:p.participantIds.slice(2),played:p.participantIds.slice(2)});
 const r=generate({...p,lastRound:20});assert.equal(r.diagnostics.restCost[0],1);
});

test('固定条件下でもバランス80:20・ゲスト当日評価・モード共通の休憩を維持する',()=>{
 const reference=require('./fixtures/balance-event-261029.json'),past=new Map(Object.entries(reference.pastFormStats));
 const p={...reference,knownParticipantIds:new Set(reference.knownParticipantIds),fixedPairs:[{id:'strong-pair',a:'P02',b:'P10'}],pastFormStats:past,eligibleRounds:[]};
 for(let seed=1;seed<=16;seed++){
  const results=['normal','balance','rival'].map(mode=>generate({...p,mode,random:seededRandom(seed)}));assert.deepEqual(results[0].resters,results[1].resters);assert.deepEqual(results[0].resters,results[2].resters);
  const balance=results[1],today=base.friendlyFormScores(p.eventId,p.history,p.knownParticipantIds);
  for(const[id,row]of past)assert(Math.abs(balance.form.get(id)-(.8*today.get(id)+.2*base.friendlyFormScore(row)))<1e-8);
  assert.equal(balance.form.get('P05'),today.get('P05'));for(const r of results)if(!r.resters.includes('P02'))assert(paired(r,p.fixedPairs[0]));
 }
});

test('未固定の連続ペアは固定の例外へ広げず、不正設定・未解放モードを拒否する',()=>{
 const p=params(8);p.fixedPairs=pairs(p.participantIds,3);p.history=[...p.history,card(p.participantIds.slice(0,4),13),card(p.participantIds.slice(4),13)];p.lastRound=13;assert.throws(()=>generate(p),/固定条件/);
 for(const invalid of [[{id:'a',a:'p01',b:'p01'}],[{id:'a',a:'p01',b:'foreign'}],[{id:'a',a:'p01',b:'p02'},{id:'b',a:'p02',b:'p03'}]])assert.throws(()=>generate({...params(6),fixedPairs:invalid}),/固定ペア/);
 assert.throws(()=>generate({...params(6),fixedPairs:pairs(idsFor(6),1),history:[],mode:'balance'}),/10試合/);
});

test('途中の面数変更・ゲストを含む20人でも入力を変更せず、指定面数内で生成する',()=>{
 const p=params(20,{eligibleRounds:[]});p.fixedPairs=pairs(p.participantIds,2);const snapshot=JSON.stringify({history:p.history,pairs:p.fixedPairs});
 for(const courts of[1,2,3,4,5]){
  const r=generate({...p,courtCount:courts,random:seededRandom(100)});assert.equal(r.matches.length,courts);assert.equal(new Set(r.matches.flatMap(m=>[...m.teamA,...m.teamB])).size,courts*4);assert.equal(JSON.stringify({history:p.history,pairs:p.fixedPairs}),snapshot);
 }
});
