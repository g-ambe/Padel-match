import { balancePairPenalty, friendlyBalanceStrengths, friendlyFormScores, friendlyHistory, friendlyPairKey, friendlyRivalContext, generateFriendlyRound, scoredFriendlyMatches, FRIENDLY_MODE_UNLOCK_MATCHES, type FriendlyRoundMatch } from "./friendly-rounds";

export type FixedPair = { id: string; a: string; b: string };
export type EligibleRound = { round: number; eligible: readonly string[]; played: readonly string[] };
type Params = Parameters<typeof generateFriendlyRound>[0] & { fixedPairs: readonly FixedPair[]; eligibleRounds?: readonly EligibleRound[] };
type Team = [string, string];
const compareCost = (a: readonly number[], b: readonly number[]) => {
  for (let i=0;i<a.length;i++) if (Math.abs(a[i]-b[i])>1e-8) return a[i]-b[i];
  return 0;
};

export function fixedRestFeasible(n: number, fixed: number, courts: number) {
  const rest = n - 4 * Math.min(courts, Math.floor(n/4));
  if (!rest || n===5 || !fixed) return true;
  const singles=n-2*fixed, min=Math.max(0,Math.ceil((rest-singles)/2)), max=Math.min(fixed,Math.floor(rest/2));
  // 一人あたり同じ休憩率を実現するために必要な、休むペア数の期待値が実現可能範囲にあるか。
  return min<=max && fixed*rest>=min*n && fixed*rest<=max*n;
}

export function fixedPairAvailability(activeIds: readonly string[], pairs: readonly FixedPair[]) {
  const active=new Set(activeIds);
  return { suspended:activeIds.length<=4, incomplete:pairs.filter(p=>active.has(p.a)!==active.has(p.b)), available:pairs.filter(p=>active.has(p.a)&&active.has(p.b)) };
}

function matchTeams(ids: readonly string[], costs: (a:number,b:number)=>number[], allowed: (a:number,b:number)=>boolean=()=>true) {
  if (!ids.length) return { teams:[] as Team[], evaluated:0, states:1 };
  const memo=new Map<number,{cost:number[];partner:number}|null>();
  const dimensions=costs(0,1).length;memo.set(0,{cost:Array(dimensions).fill(0),partner:-1});
  let evaluated=0;
  const visit=(mask:number):{cost:number[];partner:number}|null=>{
    if(memo.has(mask))return memo.get(mask)!;
    const a=31-Math.clz32(mask&-mask),rest=mask^(1<<a);let best:{cost:number[];partner:number}|null=null;
    for(let bits=rest;bits;bits&=bits-1){const b=31-Math.clz32(bits&-bits);if(!allowed(a,b))continue;const tail=visit(rest^(1<<b));if(!tail)continue;const cost=costs(a,b).map((n,i)=>n+tail.cost[i]);evaluated++;if(!best||compareCost(cost,best.cost)<0)best={cost,partner:b};}
    memo.set(mask,best);return best;
  };
  let mask=(1<<ids.length)-1;if(!visit(mask))throw new Error("固定条件では未固定選手の連続ペアを避けられません。固定数・参加人数・面数を調整してください");
  const teams:Team[]=[];
  while(mask){const a=31-Math.clz32(mask&-mask),b=memo.get(mask)!.partner;teams.push([ids[a],ids[b]]);mask^=(1<<a)|(1<<b);}
  return {teams,evaluated,states:memo.size};
}

export function generateFriendlyRoundWithFixedPairs(params: Params) {
  // この経路では元の生成器へ一切手を加えず、乱数消費と診断を含む結果を維持する。
  if (!params.fixedPairs.length || params.participantIds.length<=4) return generateFriendlyRound(params);
  const {participantIds:ids,knownParticipantIds:known,eventId,history,lastRound,mode}=params;
  if(ids.length>20||new Set(ids).size!==ids.length||!ids.every(id=>known.has(id)))throw new Error("固定ペアは重複のない5〜20人の参加者で生成してください");
  if(!Number.isInteger(params.courtCount)||params.courtCount<1||params.courtCount>5)throw new Error("コート数は1〜5面で設定してください");
  if(!["normal","balance","rival"].includes(mode))throw new Error("組み合わせモードを確認してください");
  const paired=params.fixedPairs.flatMap(p=>[p.a,p.b]);
  if(new Set(params.fixedPairs.map(p=>p.id)).size!==params.fixedPairs.length||new Set(paired).size!==paired.length||!paired.every(id=>known.has(id)))throw new Error("固定ペアの重複・参加者情報を確認してください");
  const availability=fixedPairAvailability(ids,params.fixedPairs);
  if(availability.incomplete.length)throw new Error("固定ペアの片方が欠席・休み・生成対象外です。両者を参加に戻すか、固定を解除してください");
  const pairs=availability.available;
  if(!pairs.length)return generateFriendlyRound(params);
  const scored=scoredFriendlyMatches(eventId,history,known);
  if(mode!=="normal"&&scored.length<FRIENDLY_MODE_UNLOCK_MATCHES)throw new Error("特別モードはスコア登録済みの10試合達成後に利用できます");
  const courts=Math.min(params.courtCount,Math.floor(ids.length/4)),slots=courts*4,restNeeded=ids.length-slots;
  if(!fixedRestFeasible(ids.length,pairs.length,params.courtCount))throw new Error("この人数・固定数・面数ではペア単位の公平な休憩ができません。面数を減らすか、固定ペア・参加人数を調整してください");
  const context=friendlyHistory(eventId,history,known,lastRound),random=params.random??Math.random;
  const counts=new Map(ids.map(id=>[id,0])),lastRest=new Set<string>();
  // 現在の欠席者・明示休みはidsに含めない。記録があるRoundは当時の参加可能者だけを数える。
  if(params.eligibleRounds){
    for(const row of params.eligibleRounds){const eligible=new Set(row.eligible),played=new Set(row.played);for(const id of ids)if(eligible.has(id)&&!played.has(id)){counts.set(id,counts.get(id)!+1);if(row.round===lastRound)lastRest.add(id);}}
  }else{
    for(const[round,played]of context.roundPlayers){if(round<=0)continue;for(const id of ids)if(!played.has(id)){counts.set(id,counts.get(id)!+1);if(round===lastRound)lastRest.add(id);}}
  }
  const allPaired=new Set(pairs.flatMap(p=>[p.a,p.b]));
  const units: string[][]=ids.length===5?ids.map(id=>[id]):[...pairs.map(p=>[p.a,p.b]),...ids.filter(id=>!allPaired.has(id)).map(id=>[id])];
  const positions=new Map(ids.map((id,i)=>[id,i])),canPairCache=new Map<number,boolean>([[0,true]]);
  const canPair=(mask:number):boolean=>{
    if(canPairCache.has(mask))return canPairCache.get(mask)!;
    const a=31-Math.clz32(mask&-mask),tail=mask^(1<<a);let possible=false;
    for(let bits=tail;bits;bits&=bits-1){const b=31-Math.clz32(bits&-bits);if(!context.lastPairs.has(friendlyPairKey(ids[a],ids[b]))&&canPair(tail^(1<<b))){possible=true;break;}}
    canPairCache.set(mask,possible);return possible;
  };
  let best:{rest:string[];cost:number[]}|null=null,restCandidates=0;
  const remaining=Array(units.length+1).fill(0) as number[];for(let i=units.length-1;i>=0;i--)remaining[i]=remaining[i+1]+units[i].length;
  const selected:string[]=[];
  const visit=(index:number,left:number)=>{
    if(left<0||left>remaining[index])return;
    if(index<units.length){visit(index+1,left);selected.push(...units[index]);visit(index+1,left-units[index].length);selected.splice(selected.length-units[index].length);return;}
    if(left)return;
    const rest=new Set(selected),forced=new Set(pairs.filter(p=>!rest.has(p.a)&&!rest.has(p.b)).flatMap(p=>[p.a,p.b]));
    const free=ids.filter(id=>!rest.has(id)&&!forced.has(id)).reduce((mask,id)=>mask|(1<<positions.get(id)!),0);if(!canPair(free))return;
    restCandidates++;
    const next=ids.map(id=>counts.get(id)!+Number(rest.has(id))),split=pairs.filter(p=>rest.has(p.a)!==rest.has(p.b)).length;
    const cost=[Math.max(...next)-Math.min(...next),selected.filter(id=>lastRest.has(id)).length,next.reduce((s,n)=>s+n*n,0),split,random()];
    if(!best||compareCost(cost,best.cost)<0)best={rest:[...selected],cost};
  };
  visit(0,restNeeded);
  const choice=best as {rest:string[];cost:number[]}|null;
  if(!choice)throw new Error("固定条件を満たすRoundを作成できません。固定ペア・参加人数・面数を調整してください");
  const resters=choice.rest,restSet=new Set(resters),playing=ids.filter(id=>!restSet.has(id));
  const live=pairs.filter(p=>!restSet.has(p.a)&&!restSet.has(p.b)),forced=new Set(live.flatMap(p=>[p.a,p.b])),free=playing.filter(id=>!forced.has(id)).sort();
  const today=friendlyFormScores(eventId,history,known),form=mode==="balance"?friendlyBalanceStrengths(today,params.pastFormStats,new Set(scored.flatMap(m=>m.players.map(p=>p.participant_id)))):today;
  const value=(id:string)=>form.get(id)??50,mean=playing.reduce((s,id)=>s+value(id),0)/playing.length,rival=friendlyRivalContext(playing,form);
  const hasNew=new Map(free.map(a=>[a,free.some(b=>a!==b&&!context.pairs.has(friendlyPairKey(a,b)))]));
  const pairedFree=matchTeams(free,(i,j)=>{
    const a=free[i],b=free[j],key=friendlyPairKey(a,b),old=context.pairs.get(key)??0;
    if(mode==="balance")return[-Math.abs(value(a)-value(b)),(value(a)+value(b)-2*mean)**2,Math.log1p(old)];
    return[(old&&(hasNew.get(a)||hasNew.get(b))?4000:0)+800*old,mode==="rival"?(key===rival.topPair?70:0)+(rival.auxiliary.get(key)??0)*30:0];
  },(i,j)=>!context.lastPairs.has(friendlyPairKey(free[i],free[j])));
  const teams:Team[]=[...live.map(p=>[p.a,p.b] as Team),...pairedFree.teams],teamIds=teams.map((_,i)=>String(i));
  const matchings=matchTeams(teamIds,(i,j)=>{
    const a=teams[i],b=teams[j];let old=0,top=0,weight=0,both=0;
    for(const x of a)for(const y of b){const edge=friendlyPairKey(x,y);old+=35*Math.min(4,context.opponents.get(edge)??0)+(context.lastOpponents.has(edge)?60:0);if(edge===rival.topPair)top++;weight+=rival.auxiliary.get(edge)??0;}
    if(mode==="balance"){for(const[x,other]of[...a.map(x=>[x,b] as const),...b.map(x=>[x,a] as const)])if(other.every(y=>context.lastOpponents.has(friendlyPairKey(x,y))))both++;return[Math.abs(a.reduce((s,id)=>s+value(id),0)-b.reduce((s,id)=>s+value(id),0))/2,both,old];}
    return[old-(mode==="rival"?0.6*(70*top+(rival.totalWeight?30*weight/rival.totalWeight:0)):0)];
  });
  const courtIds=Array.from({length:courts},(_,i)=>i+1).sort(()=>random()-0.5);
  const matches:FriendlyRoundMatch[]=matchings.teams.map(([a,b],i)=>({teamA:teams[Number(a)],teamB:teams[Number(b)],court:courtIds[i]}));
  return{matches,resters,form,appliedFixedPairs:live.map(p=>p.id),splitFixedPairs:pairs.filter(p=>restSet.has(p.a)!==restSet.has(p.b)).map(p=>p.id),diagnostics:{restCandidates,restCost:choice.cost,pairingStates:pairedFree.states,opponentStates:matchings.states,balance:matches.reduce((s,m)=>s+balancePairPenalty(m,form),0)/matches.length}};
}
