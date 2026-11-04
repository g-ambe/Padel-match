const base=require('./friendly-round-helpers.cjs');
const {generateFriendlyRoundWithFixedPairs:generate}=require('../../lib/friendly-fixed-pairs.ts');
const pairs=(ids,count)=>Array.from({length:count},(_,i)=>({id:'pair'+i,a:ids[i*2],b:ids[i*2+1]}));
const groups=[[5,1,2],[6,1,3],[7,1,3],[8,2,4],[9,2,4],[10,2,5],[11,2,5],[12,3,6],[13,3,6],[17,4,8],...[1,2,3,4,5].map(c=>[20,c,10])];
function simulate(n,courts,count,mode,rounds=50,seed=1,availability){
 const ids=base.idsFor(n),fixed=pairs(ids,count),history=base.neutralHistory(ids),audit=[],random=base.seededRandom(seed);
 const stats=new Map(ids.map(id=>[id,{eligible:0,rests:0,expected:0,streak:0,maxStreak:0}]));
 const report={n,courts,fixed:count,mode,rounds,success:0,opportunities:0,formed:0,bothRest:0,split:0,bothPlayed:0,freeConsecutive:0,consecutiveOpponents:0,repeatedOpponents:0,maxMs:0,totalMs:0,rests:[],expected:[],eligible:[],maxDeviation:0,maxStreak:0,maintenanceRate:0};
 let lastPairs=new Set(),lastOpponents=new Set(),allOpponents=new Set();
 for(let step=0;step<rounds;step++){
  const active=availability?availability(step,ids):ids,activeSet=new Set(active),activeFixed=active.length>=5?fixed.filter(p=>activeSet.has(p.a)&&activeSet.has(p.b)):[];
  const start=performance.now(),r=generate({eventId:'event',participantIds:active,knownParticipantIds:new Set(ids),courtCount:courts,lastRound:12+step,history,mode,fixedPairs:fixed,eligibleRounds:audit,random});
  const elapsed=performance.now()-start;report.maxMs=Math.max(report.maxMs,elapsed);report.totalMs+=elapsed;
  const played=r.matches.flatMap(m=>[...m.teamA,...m.teamB]),playing=new Set(played),rest=active.filter(id=>!playing.has(id)),expected=(active.length-played.length)/active.length;
  if(playing.size!==played.length||played.some(id=>!activeSet.has(id))||r.matches.length!==Math.min(courts,Math.floor(active.length/4)))throw Error('出場枠・参加者重複の不整合');
  for(const id of ids){const s=stats.get(id);if(!activeSet.has(id)){s.streak=0;continue;}s.eligible++;s.expected+=expected;if(!playing.has(id)){s.rests++;s.streak++;s.maxStreak=Math.max(s.maxStreak,s.streak);}else s.streak=0;}
  const split=[];
  for(const pair of activeFixed){report.opportunities++;if(playing.has(pair.a)&&playing.has(pair.b)){report.bothPlayed++;if(!r.matches.some(m=>[m.teamA,m.teamB].some(t=>t.includes(pair.a)&&t.includes(pair.b))))throw Error('両名出場時の固定ペア違反');report.formed++;}else if(!playing.has(pair.a)&&!playing.has(pair.b))report.bothRest++;else{report.split++;split.push(pair);}}
  const currentPairs=new Set(),currentOpponents=new Set();
  for(const m of r.matches){for(const team of [m.teamA,m.teamB]){const key=base.friendlyPairKey(...team);currentPairs.add(key);if(!activeFixed.some(p=>base.friendlyPairKey(p.a,p.b)===key)&&lastPairs.has(key))report.freeConsecutive++;}for(const a of m.teamA)for(const b of m.teamB){const key=base.friendlyPairKey(a,b);currentOpponents.add(key);report.consecutiveOpponents+=Number(lastOpponents.has(key));report.repeatedOpponents+=Number(allOpponents.has(key));}}
  lastPairs=currentPairs;lastOpponents=currentOpponents;for(const key of currentOpponents)allOpponents.add(key);
  audit.push({round:13+step,eligible:[...active],played,split_pairs:split});for(const m of r.matches)history.push(base.card([...m.teamA,...m.teamB],13+step));report.success++;
 }
 report.rests=ids.map(id=>stats.get(id).rests);report.expected=ids.map(id=>+stats.get(id).expected.toFixed(6));report.eligible=ids.map(id=>stats.get(id).eligible);report.maxDeviation=Math.max(...ids.map(id=>Math.abs(stats.get(id).rests-stats.get(id).expected)));report.maxStreak=Math.max(...ids.map(id=>stats.get(id).maxStreak));report.maintenanceRate=report.opportunities?100*(report.formed+report.bothRest)/report.opportunities:100;
 return report;
}
module.exports={simulate,groups,pairs};
