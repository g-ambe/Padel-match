const {test}=require('node:test');
const assert=require('node:assert/strict');
const now=require('./fixtures/friendly-round-helpers.cjs');
const before=require('./fixtures/before-balance.cjs');
const reference=require('./fixtures/balance-event-261029.json');
const {compareBalance}=require('../scripts/analyze-balance-pairs.cjs');
const {generateFriendlyRound,friendlyFormScore,friendlyBalanceStrengths,friendlyHistory,friendlyPairKey,idsFor,card,neutralHistory,seededRandom}=now;
const pairsOf=r=>r.matches.flatMap(m=>[m.teamA,m.teamB]);
const keys=r=>pairsOf(r).map(p=>friendlyPairKey(...p)).sort();
const params=(ids,extra={})=>({eventId:'event',participantIds:ids,knownParticipantIds:new Set(ids),courtCount:Math.floor(ids.length/4),history:neutralHistory(ids),lastRound:12,mode:'balance',random:seededRandom(1),...extra});
function allMatchings(ids){if(!ids.length)return[[]];const[a,...rest]=ids;return rest.flatMap((b,i)=>allMatchings(rest.filter((_,j)=>j!==i)).map(tail=>[[a,b],...tail]));}

test('当日80%・過去20%は各々の中立値補正後に合成し、過去なし・未出場は当日だけを使う',()=>{
 const today=new Map([['member',90],['guest',50],['new',60],['one-game',50]]),past=new Map([['member',{played:12,wins:12,draws:0,diff:15}],['one-game',{played:1,wins:1,draws:0,diff:4}],['new',{played:0,wins:0,draws:0,diff:0}]]);
 const snapshot=JSON.stringify([...past]);const strength=friendlyBalanceStrengths(today,past);
 assert.equal(friendlyFormScore(past.get('member')),90);assert.equal(strength.get('member'),90);
 assert.equal(strength.get('guest'),50);assert.equal(strength.get('new'),60);assert.equal(strength.get('one-game'),53.6);
 assert.equal(JSON.stringify([...past]),snapshot);assert.deepEqual([...today],[['member',90],['guest',50],['new',60],['one-game',50]]);
 const s=friendlyBalanceStrengths(new Map([['member',50]]),past);assert.equal(s.get('member'),58);
 assert.equal(friendlyBalanceStrengths(new Map([['member',50]]),past,new Set()).get('member'),50);
 assert.throws(()=>friendlyBalanceStrengths(today,new Map([['member',{played:1,wins:2,draws:0,diff:0}]])),/過去戦績/);
});

test('90+30・80+40相当の強弱ペアを選び、古いペア再登場より実力差を優先する',()=>{
 const ids=idsFor(4),history=Array.from({length:10},(_,i)=>card(ids,i+1,{result:{score_a:0,score_b:0}}));
 for(let i=0;i<8;i++)history.push(card([ids[0],ids[3],ids[1],ids[2]],0,{completed:false,result:null}));
 const past=new Map(ids.map((id,i)=>[id,[{played:12,wins:12,draws:0,diff:15},{played:16,wins:14,draws:0,diff:0},{played:6,wins:2,draws:0,diff:0},{played:6,wins:1,draws:0,diff:0}][i]]));
 const result=generateFriendlyRound(params(ids,{history,lastRound:10,pastFormStats:past}));
 assert.deepEqual([...result.form.values()],[58,56,48,46]);
 assert.deepEqual(keys(result),[friendlyPairKey(ids[0],ids[3]),friendlyPairKey(ids[1],ids[2])].sort());
 assert.equal(result.consecutive,0);assert.equal(result.opponent,0);assert(result.pair>0);
 const[a,b]=[result.matches[0].teamA,result.matches[0].teamB].map(t=>t.reduce((s,id)=>s+result.form.get(id),0));assert.equal(a,b);
});

test('8人の全105ペア構成を独立全探索し、連続回避・強弱差・ペア総合力の優先順位を検算する',()=>{
 const ids=reference.participantIds.slice(0,8),result=generateFriendlyRound({...reference,knownParticipantIds:new Set(reference.knownParticipantIds),participantIds:ids,courtCount:2,mode:'balance',pastFormStats:new Map(Object.entries(reference.pastFormStats)),random:seededRandom(7)});
 const history=friendlyHistory(reference.eventId,reference.history,new Set(reference.knownParticipantIds),reference.lastRound),score=id=>result.form.get(id),mean=ids.reduce((s,id)=>s+score(id),0)/ids.length;
 const cost=pairs=>[pairs.filter(p=>history.lastPairs.has(friendlyPairKey(...p))).length,-pairs.reduce((s,[a,b])=>s+Math.abs(score(a)-score(b)),0),pairs.reduce((s,[a,b])=>s+(score(a)+score(b)-2*mean)**2,0)];
 const order=(a,b)=>{for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-8)return a[i]-b[i];return 0;};
 const expected=allMatchings(ids).map(cost).sort(order)[0],actual=cost(pairsOf(result));for(let i=0;i<3;i++)assert(Math.abs(expected[i]-actual[i])<1e-7);
 const teams=pairsOf(result),gaps=allMatchings([0,1,2,3]).map(matches=>matches.reduce((s,[a,b])=>s+Math.abs(teams[a].reduce((v,id)=>v+score(id),0)-teams[b].reduce((v,id)=>v+score(id),0)),0));
 const selected=result.matches.reduce((s,m)=>s+Math.abs(m.teamA.reduce((v,id)=>v+score(id),0)-m.teamB.reduce((v,id)=>v+score(id),0)),0);assert(Math.abs(selected-Math.min(...gaps))<1e-8);
});

test('直前ペアを避けられない制約でも最少で生成し、休憩していた過去ペアを連続扱いしない',()=>{
 const ids=idsFor(4),history=neutralHistory(ids);
 for(const p of [[ids[0],ids[1],ids[2],ids[3]],[ids[0],ids[2],ids[1],ids[3]],[ids[0],ids[3],ids[1],ids[2]]])history.push(card(p,99));
 const result=generateFriendlyRound(params(ids,{history,lastRound:99}));assert.equal(result.consecutive,2);assert.equal(result.matches.length,1);
 const all=idsFor(8),h=[...neutralHistory(all),card([all[4],all[5],all[6],all[7]],13),card(all.slice(0,4),14)];
 const context=friendlyHistory('event',h,new Set(all),14);assert(!context.lastPairs.has(friendlyPairKey(all[4],all[5])));
 const r=generateFriendlyRound(params(all,{history:h,lastRound:14}));assert.equal(r.consecutive,0);
});

test('通常・ライバルは4〜20人の固定シードで変更前と結果・診断・乱数消費まで一致する',()=>{
 for(const n of[4,8,10,12,20])for(const mode of['normal','rival'])for(let seed=1;seed<=16;seed++){
  const ids=idsFor(n),past=new Map(ids.map(id=>[id,{played:100,wins:100,draws:0,diff:400}]));
  const options=params(ids,{mode,courtCount:Math.min(5,Math.floor(n/4)),pastFormStats:past});
  const currentRandom=seededRandom(seed),oldRandom=seededRandom(seed);
  assert.deepEqual(generateFriendlyRound({...options,random:currentRandom}),before.generateFriendlyRound({...options,random:oldRandom}));
  assert.equal(currentRandom(),oldRandom());
 }
 for(const mode of['normal','rival'])for(let seed=1;seed<=128;seed++){
  const options={...reference,knownParticipantIds:new Set(reference.knownParticipantIds),pastFormStats:new Map(Object.entries(reference.pastFormStats)),mode};
  const a=seededRandom(seed),b=seededRandom(seed);assert.deepEqual(generateFriendlyRound({...options,random:a}),before.generateFriendlyRound({...options,random:b}));assert.equal(a(),b());
 }
});

test('過去100試合を持っていても当日10試合の解放条件へ加算せず、未出場者は50で扱う',()=>{
 const ids=idsFor(8),past=new Map(ids.map(id=>[id,{played:100,wins:100,draws:0,diff:400}]));
 for(const count of[0,9])assert.throws(()=>generateFriendlyRound(params(ids,{history:Array.from({length:count},(_,i)=>card(ids.slice(0,4),i+1)),pastFormStats:past})),/10試合達成後/);
 const result=generateFriendlyRound(params(ids,{pastFormStats:past}));for(const id of ids.slice(4))assert.equal(result.form.get(id),50);
});

test('当日・過去・人数・面数が同じ比較で強弱ペアと接戦評価が改善し、休憩と連続回避は維持される',()=>{
 const snapshot=JSON.stringify(reference),report=compareBalance(reference,Array.from({length:16},(_,i)=>i+1));
 assert(report.sameResters);assert.equal(JSON.stringify(reference),snapshot);
 const old=report.summaries.before80,next=report.summaries.after80;
 assert(next.strongWeakRate>old.strongWeakRate);assert(next.withinPairGap>old.withinPairGap);assert(next.teamGap<old.teamGap);assert(next.balancePenalty<old.balancePenalty);
 assert.equal(next.consecutivePairs,0);assert.equal(next.restSpread,old.restSpread);assert(next.repeatedPairs>old.repeatedPairs);
});

test('4/8/10/12/20人、1〜5面、途中の面数変更でも重複せず、履歴・入力を変更しない',()=>{
 for(const[n,courts]of[[4,1],[8,2],[10,2],[12,3],[20,5]]){
  const ids=idsFor(n),options=params(ids,{courtCount:courts}),snapshot=JSON.stringify(options.history);
  for(const count of[1,courts,5]){
   const r=generateFriendlyRound({...options,courtCount:count,random:seededRandom(30)}),players=r.matches.flatMap(m=>[...m.teamA,...m.teamB]);
   assert.equal(players.length,Math.min(count,Math.floor(n/4))*4);assert.equal(new Set(players).size,players.length);assert.equal(players.length+r.resters.length,n);assert.equal(JSON.stringify(options.history),snapshot);
   assert(r.diagnostics.pairingStates<=2**20);assert(r.diagnostics.opponentStates<=2**10);
   const baseline=before.generateFriendlyRound({...options,courtCount:count,mode:'normal',random:seededRandom(30)});assert.deepEqual(r.resters,baseline.resters);
  }
 }
});
