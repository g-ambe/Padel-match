// 匿名化したローカル履歴だけを使う。ネットワーク・DB書込みは行わない。
const fs=require('node:fs'),path=require('node:path');
const current=require('../tests/fixtures/friendly-round-helpers.cjs');
const before=require('../tests/fixtures/before-balance.cjs');
const {generateFriendlyRound,friendlyHistory,friendlyPairKey,friendlyFormScores,friendlyBalanceStrengths,balancePairPenalty,seededRandom}=current;
const signatures=result=>result.matches.flatMap(m=>[friendlyPairKey(...m.teamA),friendlyPairKey(...m.teamB)]).sort().join('|');
const matchup=result=>result.matches.map(m=>[friendlyPairKey(...m.teamA),friendlyPairKey(...m.teamB)].sort().join(' vs ')).sort().join('|');
const avg=rows=>rows.reduce((a,b)=>a+b,0)/rows.length;
function compareBalance(input,seeds=Array.from({length:128},(_,i)=>i+1)){
 const known=new Set(input.knownParticipantIds),past=new Map(Object.entries(input.pastFormStats??{}));
 const today=friendlyFormScores(input.eventId,input.history,known),played=new Set(current.scoredFriendlyMatches(input.eventId,input.history,known).flatMap(m=>m.players.map(p=>p.participant_id))),strength=friendlyBalanceStrengths(today,past,played);
 const context=friendlyHistory(input.eventId,input.history,known,input.lastRound);
 const options={...input,knownParticipantIds:known,pastFormStats:past},outputs={normal:[],before100:[],before80:[],after100:[],after80:[]};
 function metrics(result){
  const form=id=>strength.get(id)??50,players=result.matches.flatMap(m=>[...m.teamA,...m.teamB]);
  const values=players.map(form).sort((a,b)=>a-b),median=(values[values.length/2-1]+values[values.length/2])/2;
  const pairs=result.matches.flatMap(m=>[m.teamA,m.teamB]);
  const opponents=result.matches.flatMap(m=>m.teamA.flatMap(a=>m.teamB.map(b=>friendlyPairKey(a,b))));
  const rests=input.participantIds.map(id=>[...context.roundPlayers].filter(([r,p])=>r>0&&!p.has(id)).length+Number(result.resters.includes(id)));
  return{strongWeakRate:avg(pairs.map(([a,b])=>Number((form(a)-median)*(form(b)-median)<0))),withinPairGap:avg(pairs.map(([a,b])=>Math.abs(form(a)-form(b)))),teamGap:avg(result.matches.map(m=>Math.abs(m.teamA.reduce((s,id)=>s+form(id),0)-m.teamB.reduce((s,id)=>s+form(id),0))/2)),consecutivePairs:pairs.filter(p=>context.lastPairs.has(friendlyPairKey(...p))).length,repeatedPairs:pairs.filter(p=>context.pairs.has(friendlyPairKey(...p))).length,consecutiveOpponentEdges:opponents.filter(key=>context.lastOpponents.has(key)).length,sameBothOpponents:result.matches.reduce((s,m)=>s+[...m.teamA.map(a=>m.teamB.every(b=>context.lastOpponents.has(friendlyPairKey(a,b)))),...m.teamB.map(b=>m.teamA.every(a=>context.lastOpponents.has(friendlyPairKey(a,b))))].filter(Boolean).length,0),restSpread:Math.max(...rests)-Math.min(...rests),balancePenalty:avg(result.matches.map(m=>balancePairPenalty(m,strength))),evaluated:result.diagnostics.evaluated,searchStates:result.diagnostics.pairingStates??0,partitions:result.diagnostics.partitions??0};
 }
 for(const seed of seeds){
  const cases={normal:()=>generateFriendlyRound({...options,mode:'normal',random:seededRandom(seed)}),before100:()=>before.generateFriendlyRound({...options,mode:'balance',random:seededRandom(seed)}),before80:()=>before.generateWithStrengths({...options,comparisonForm:strength,mode:'balance',random:seededRandom(seed)}),after100:()=>generateFriendlyRound({...options,pastFormStats:undefined,mode:'balance',random:seededRandom(seed)}),after80:()=>generateFriendlyRound({...options,mode:'balance',random:seededRandom(seed)})};
  for(const [version,run]of Object.entries(cases)){
   const start=performance.now(),result=run(),elapsedMs=performance.now()-start;
   outputs[version].push({seed,result,metrics:{...metrics(result),elapsedMs}});
  }
 }
 const summaries=Object.fromEntries(Object.entries(outputs).map(([version,rows])=>[version,Object.fromEntries(Object.keys(rows[0].metrics).map(key=>[key,avg(rows.map(r=>r.metrics[key]))]))]));
 const sameResters=seeds.every((_,i)=>Object.values(outputs).every(rows=>JSON.stringify(rows[i].result.resters)===JSON.stringify(outputs.normal[i].result.resters)));
 const changed=Object.fromEntries(Object.entries(outputs).map(([version,rows])=>[version,{pairs:rows.filter((r,i)=>signatures(r.result)!==signatures(outputs.normal[i].result)).length,matchups:rows.filter((r,i)=>matchup(r.result)!==matchup(outputs.normal[i].result)).length}]));
 return{read_at:input.read_at,seeds:seeds.length,meta:input.meta,forms:Object.fromEntries([...today].map(([id,score])=>[id,{today:score,past:past.has(id)?current.friendlyFormScore(past.get(id)):null,mixed:strength.get(id)}])),summaries,sameResters,changed,example:Object.fromEntries(Object.entries(outputs).map(([k,rows])=>[k,rows[0]])),outputs};
}
function measureSizes(seeds=16){
 return[4,8,10,12,20].map(n=>{
  const ids=current.idsFor(n),courtCount=Math.floor(n/4),history=[];
  for(let round=1;round<=12;round++){
   const ring=ids.map((_,i)=>ids[(i+round*3)%n]);
   for(let c=0;c<courtCount;c++)history.push(current.card(ring.slice(c*4,c*4+4),round,{result:round%3?{score_a:4,score_b:c%3}:{score_a:2,score_b:2}}));
  }
  const input={eventId:'event',participantIds:ids,knownParticipantIds:new Set(ids),courtCount,lastRound:12,history,mode:'balance'};
  const times={before:[],after:[]};let states=0,evaluated=0,restersAgree=true;
  for(let seed=-4;seed<seeds;seed++){
   let old;
   for(const[name,generate]of[['before',before.generateFriendlyRound],['after',generateFriendlyRound]]){
    const start=performance.now(),result=generate({...input,random:seededRandom(seed)}),ms=performance.now()-start;
    if(seed>=0)times[name].push(ms);
    if(name==='before')old=result.resters;else{restersAgree&&=JSON.stringify(old)===JSON.stringify(result.resters);states=result.diagnostics.pairingStates;evaluated=result.diagnostics.evaluated;}
   }
  }
  return{participants:n,courts:courtCount,seeds,restersAgree,pairingStates:states,evaluated,times:Object.fromEntries(Object.entries(times).map(([k,t])=>[k,{mean:avg(t),p95:[...t].sort((a,b)=>a-b)[Math.ceil(t.length*.95)-1],max:Math.max(...t)}]))};
 });
}
if(require.main===module){const input=JSON.parse(fs.readFileSync(path.join(__dirname,'../tests/fixtures/balance-event-261029.json'),'utf8'));const{outputs,...report}=compareBalance(input);process.stdout.write(JSON.stringify({...report,performance:measureSizes()},null,2)+'\n');}
module.exports={compareBalance,measureSizes};
