import { balancePairPenalty, friendlyBalanceStrengths, friendlyFormScores, friendlyHistory, friendlyPairKey, friendlyRivalContext, generateFriendlyRound, scoredFriendlyMatches, FRIENDLY_MODE_UNLOCK_MATCHES, type FriendlyRoundMatch } from "./friendly-rounds";

export type FixedPair = { id: string; a: string; b: string };
export type EligibleRound = { round: number; eligible: readonly string[]; played: readonly string[]; split_pairs?: readonly FixedPair[] };
type Params = Parameters<typeof generateFriendlyRound>[0] & { fixedPairs: readonly FixedPair[]; eligibleRounds?: readonly EligibleRound[] };
type Team = [string, string];
const compareCost = (a: readonly number[], b: readonly number[]) => {
  for (let i=0;i<a.length;i++) if (Math.abs(a[i]-b[i])>1e-8) return a[i]-b[i];
  return 0;
};

export type FixedRestStat = { eligibleRounds: number; rests: number; expectedRests: number; consecutiveRests: number };
export function fixedRestHistory(ids: readonly string[], rows: readonly EligibleRound[], lastRound: number) {
  const stats = new Map(ids.map(id=>[id,{eligibleRounds:0,rests:0,expectedRests:0,consecutiveRests:0}]));
  let previous = 0;
  for (const row of [...rows].sort((a,b)=>a.round-b.round)) {
    const eligible = new Set(row.eligible), played = new Set(row.played);
    if (!Number.isSafeInteger(row.round) || row.round<1 || row.round>lastRound || row.round===previous || eligible.size!==row.eligible.length || played.size!==row.played.length || eligible.size<4 || played.size<4 || played.size%4 || [...played].some(id=>!eligible.has(id))) throw new Error("参加可能者・休憩履歴に不整合があります。再取得してください");
    const chance = (eligible.size-played.size)/eligible.size;
    for (const [id,stat] of stats) {
      if (row.round!==previous+1 || !eligible.has(id)) stat.consecutiveRests=0;
      if (!eligible.has(id)) continue;
      stat.eligibleRounds++; stat.expectedRests+=chance;
      if (played.has(id)) stat.consecutiveRests=0;
      else { stat.rests++; stat.consecutiveRests++; }
    }
    previous=row.round;
  }
  if (previous!==lastRound) for (const stat of stats.values()) stat.consecutiveRests=0;
  return stats;
}

type RestOption = { mask:number; count:number; error:number; streak:number; cost:number[]; tie:number };
function chooseResters(ids: readonly string[], pairs: readonly FixedPair[], rows: readonly EligibleRound[], lastRound:number, restCount:number, random:()=>number, diverse:(mask:number)=>boolean) {
  const stats=fixedRestHistory(ids,rows,lastRound),positions=new Map(ids.map((id,i)=>[id,i]));
  const paired=new Set(pairs.flatMap(p=>[p.a,p.b]));
  const splitCounts=new Map(pairs.map(p=>[p.id,rows.reduce((count,row)=>count+(row.split_pairs?.some(old=>old.id===p.id&&friendlyPairKey(old.a,old.b)===friendlyPairKey(p.a,p.b))?1:0),0)]));
  const units=[...pairs.map(p=>({ids:[p.a,p.b],splits:splitCounts.get(p.id)!})),...ids.filter(id=>!paired.has(id)).map(id=>({ids:[id],splits:0}))];
  const chance=restCount/ids.length;
  const options:RestOption[][]=units.map(unit=>Array.from({length:1<<unit.ids.length},(_,bits)=>{
    let mask=0,count=0,error=0,streak=0,squares=0,repeats=0;
    unit.ids.forEach((id,i)=>{
      const stat=stats.get(id)!,rest=Number(!!(bits&(1<<i))),difference=stat.rests+rest-stat.expectedRests-chance;
      if(rest){mask|=1<<positions.get(id)!;count++;streak=Math.max(streak,stat.consecutiveRests+1);repeats+=Number(stat.consecutiveRests>0);}
      error=Math.max(error,Math.abs(difference));squares+=difference*difference;
    });
    const split=Number(unit.ids.length===2&&count===1);
    return{mask,count,error,streak,cost:[squares,repeats,split,split*unit.splits],tie:random()};
  }).sort((a,b)=>a.tie-b.tie));
  // 最大偏差と最大連続休憩を先に確定。その上限内で加算可能な評価をDPする。
  // maxと合計を同じDPの単一状態にすると、後続のmaxに隠れた良い候補を捨ててしまう。
  const minimiseMax=(field:'error'|'streak',cap=Infinity)=>{
    let dp=Array(restCount+1).fill(Infinity) as number[];dp[0]=0;
    for(const group of options){const next=Array(restCount+1).fill(Infinity) as number[];for(let n=0;n<=restCount;n++)if(Number.isFinite(dp[n]))for(const option of group)if(n+option.count<=restCount&&option.error<=cap+1e-8)next[n+option.count]=Math.min(next[n+option.count],Math.max(dp[n],option[field]));dp=next;}
    return dp[restCount];
  };
  const maxError=minimiseMax('error'),maxStreak=minimiseMax('streak',maxError);
  const memo=new Map<string,number[]|null>();let evaluated=0;
  const solve=(index:number,left:number):number[]|null=>{
    if(left<0)return null;if(index===options.length)return left===0?[0,0,0,0]:null;
    const key=`${index}:${left}`;if(memo.has(key))return memo.get(key)!;let best:number[]|null=null;
    for(const option of options[index]){if(option.count>left||option.error>maxError+1e-8||option.streak>maxStreak)continue;const tail=solve(index+1,left-option.count);if(!tail)continue;evaluated++;const cost=option.cost.map((value,i)=>value+tail[i]);if(!best||compareCost(cost,best)<0)best=cost;}
    memo.set(key,best);return best;
  };
  const cost=solve(0,restCount);if(!cost)throw new Error("参加人数・固定設定に不整合があります。再取得してください");
  let selected:number|undefined,fallback:number|undefined;
  // 同じ公平性・分割数の候補に、未固定者の連続ペアを避けられる出場者集合があれば優先する。
  // 候補がなければ最初の有効候補を使い、生成を停止しない。
  const visit=(index:number,left:number,mask:number):boolean=>{
    if(index===options.length){fallback??=mask;if(diverse(mask)){selected=mask;return true;}return false;}
    const best=solve(index,left)!;
    for(const option of options[index]){if(option.count>left||option.error>maxError+1e-8||option.streak>maxStreak)continue;const tail=solve(index+1,left-option.count);if(tail&&compareCost(option.cost.map((value,i)=>value+tail[i]),best)===0&&visit(index+1,left-option.count,mask|option.mask))return true;}
    return false;
  };
  visit(0,restCount,0);const chosen=selected??fallback!;
  return{resters:ids.filter((_,i)=>!!(chosen&(1<<i))),cost:[maxError,maxStreak,...cost],evaluated,stats};
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
  let mask=(1<<ids.length)-1;if(!visit(mask))throw new Error("チームを構成できません。参加者データを確認してください");
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
  const pairs=availability.available;
  if(!pairs.length)return generateFriendlyRound(params);
  const scored=scoredFriendlyMatches(eventId,history,known);
  if(mode!=="normal"&&scored.length<FRIENDLY_MODE_UNLOCK_MATCHES)throw new Error("特別モードはスコア登録済みの10試合達成後に利用できます");
  const courts=Math.min(params.courtCount,Math.floor(ids.length/4)),slots=courts*4,restNeeded=ids.length-slots;
  const context=friendlyHistory(eventId,history,known,lastRound),random=params.random??Math.random;
  // 過去の参加可能者が不明なRoundを欠場・休憩と推測しない。
  const positions=new Map(ids.map((id,i)=>[id,i])),cache=new Map<number,boolean>([[0,true]]);
  const canPair=(mask:number):boolean=>{
    if(cache.has(mask))return cache.get(mask)!;const a=31-Math.clz32(mask&-mask),rest=mask^(1<<a);let possible=false;
    for(let bits=rest;bits;bits&=bits-1){const b=31-Math.clz32(bits&-bits);if(!context.lastPairs.has(friendlyPairKey(ids[a],ids[b]))&&canPair(rest^(1<<b))){possible=true;break;}}
    cache.set(mask,possible);return possible;
  };
  const diverse=(rest:number)=>{let fixed=0;for(const pair of pairs){const bits=(1<<positions.get(pair.a)!)|(1<<positions.get(pair.b)!);if(!(rest&bits))fixed|=bits;}return canPair(((1<<ids.length)-1)&~rest&~fixed);};
  const choice=chooseResters(ids,pairs,params.eligibleRounds??[],lastRound,restNeeded,random,diverse);
  const resters=choice.resters,restSet=new Set(resters),playing=ids.filter(id=>!restSet.has(id));
  const live=pairs.filter(p=>!restSet.has(p.a)&&!restSet.has(p.b)),forced=new Set(live.flatMap(p=>[p.a,p.b])),free=playing.filter(id=>!forced.has(id)).sort();
  const today=friendlyFormScores(eventId,history,known),form=mode==="balance"?friendlyBalanceStrengths(today,params.pastFormStats,new Set(scored.flatMap(m=>m.players.map(p=>p.participant_id)))):today;
  const value=(id:string)=>form.get(id)??50,mean=playing.reduce((s,id)=>s+value(id),0)/playing.length,rival=friendlyRivalContext(playing,form);
  const hasNew=new Map(free.map(a=>[a,free.some(b=>a!==b&&!context.pairs.has(friendlyPairKey(a,b)))]));
  const pairedFree=matchTeams(free,(i,j)=>{
    const a=free[i],b=free[j],key=friendlyPairKey(a,b),old=context.pairs.get(key)??0;
    const consecutive=Number(context.lastPairs.has(key));
    if(mode==="balance")return[consecutive,-Math.abs(value(a)-value(b)),(value(a)+value(b)-2*mean)**2,Math.log1p(old)];
    return[consecutive,(old&&(hasNew.get(a)||hasNew.get(b))?4000:0)+800*old,mode==="rival"?(key===rival.topPair?70:0)+(rival.auxiliary.get(key)??0)*30:0];
  });
  const teams:Team[]=[...live.map(p=>[p.a,p.b] as Team),...pairedFree.teams],teamIds=teams.map((_,i)=>String(i));
  const matchings=matchTeams(teamIds,(i,j)=>{
    const a=teams[i],b=teams[j];let old=0,top=0,weight=0,both=0;
    for(const x of a)for(const y of b){const edge=friendlyPairKey(x,y);old+=35*Math.min(4,context.opponents.get(edge)??0)+(context.lastOpponents.has(edge)?60:0);if(edge===rival.topPair)top++;weight+=rival.auxiliary.get(edge)??0;}
    if(mode==="balance"){for(const[x,other]of[...a.map(x=>[x,b] as const),...b.map(x=>[x,a] as const)])if(other.every(y=>context.lastOpponents.has(friendlyPairKey(x,y))))both++;return[Math.abs(a.reduce((s,id)=>s+value(id),0)-b.reduce((s,id)=>s+value(id),0))/2,both,old];}
    return[old-(mode==="rival"?0.6*(70*top+(rival.totalWeight?30*weight/rival.totalWeight:0)):0)];
  });
  const courtIds=Array.from({length:courts},(_,i)=>i+1).sort(()=>random()-0.5);
  const matches:FriendlyRoundMatch[]=matchings.teams.map(([a,b],i)=>({teamA:teams[Number(a)],teamB:teams[Number(b)],court:courtIds[i]}));
  return{matches,resters,form,appliedFixedPairs:live.map(p=>p.id),splitFixedPairs:pairs.filter(p=>restSet.has(p.a)!==restSet.has(p.b)).map(p=>p.id),diagnostics:{restCandidates:choice.evaluated,restCost:choice.cost,pairingStates:pairedFree.states,opponentStates:matchings.states,balance:matches.reduce((s,m)=>s+balancePairPenalty(m,form),0)/matches.length}};
}
