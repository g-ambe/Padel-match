import type { SupabaseClient } from "@supabase/supabase-js";
import type { EligibleRound, FixedPair } from "./friendly-fixed-pairs";
import type { FriendlyRoundMatch, FriendlyRoundMode } from "./friendly-rounds";

export type FixedPairState = { event_id:string;revision:number;used_fixed_pairs:boolean;pairs:FixedPair[];eligible_rounds:EligibleRound[] };
export type FixedRoundRequest = { eventId:string;revision:number;lastRound:number;courtCount:number;mode:FriendlyRoundMode;activeIds:string[];matches:FriendlyRoundMatch[];requestId:string };
export class FixedPairRequestError extends Error {
  readonly definitelyRejected: boolean;
  constructor(message:string,definitelyRejected=false){super(message);this.definitelyRejected=definitelyRejected;}
}
const pairSignature=(pairs:readonly FixedPair[])=>JSON.stringify(pairs.map(p=>({id:p.id,a:[p.a,p.b].sort()[0],b:[p.a,p.b].sort()[1]})).sort((a,b)=>a.id.localeCompare(b.id)));
function fail(error:{code?:string;message?:string}|null,fallback:string):never{
 const rejected=!!error?.code&&['40001','42501','P0001','22023','23505','23503','22P02'].includes(error.code);
 throw new FixedPairRequestError(rejected&&error?.message&&/[\u3000-\u9fff]/.test(error.message)?error.message:fallback,rejected);
}
function state(data:unknown,eventId:string):FixedPairState{
 const d=data as FixedPairState|null;
 if(!d||d.event_id!==eventId||!Number.isSafeInteger(d.revision)||d.revision<0||typeof d.used_fixed_pairs!=='boolean'||!Array.isArray(d.pairs)||!Array.isArray(d.eligible_rounds))throw new FixedPairRequestError('固定ペア設定の確認応答を取得できませんでした');
 const people=d.pairs.flatMap(p=>[p?.a,p?.b]);
 if(d.pairs.length>10||d.pairs.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.a!=='string'||!p.a||typeof p.b!=='string'||!p.b||p.a===p.b)||new Set(d.pairs.map(p=>p.id)).size!==d.pairs.length||new Set(people).size!==people.length)throw new FixedPairRequestError('固定ペア設定に不整合があります。再取得してください');
 if(d.eligible_rounds.some(r=>!Number.isInteger(r.round)||r.round<1||!Array.isArray(r.eligible)||!Array.isArray(r.played)||[...r.eligible,...r.played].some(id=>typeof id!=='string')))throw new FixedPairRequestError('参加状況の履歴を確認できませんでした');
 return d;
}
export async function readEventFixedPairs(s:SupabaseClient,eventId:string,history=false){
 const {data,error}=await s.rpc('get_event_fixed_pair_state',{p_event_id:eventId,p_include_history:history});
 if(error)fail(error,'固定ペア設定を取得できませんでした。権限・通信状況を確認して再試行してください');
 return state(data,eventId);
}
export async function saveEventFixedPairs(s:SupabaseClient,previous:FixedPairState,pairs:FixedPair[],requestId:string){
 const {data,error}=await s.rpc('replace_event_fixed_pairs',{p_event_id:previous.event_id,p_expected_revision:previous.revision,p_pairs:pairs,p_request_id:requestId});
 if(error)fail(error,'固定ペアを保存できませんでした。設定を再取得して結果を確認してください');
 const saved=state(data,previous.event_id);
 if(saved.revision<=previous.revision||pairSignature(saved.pairs)!==pairSignature(pairs)||(previous.used_fixed_pairs&&!saved.used_fixed_pairs))throw new FixedPairRequestError('固定ペアの保存を確認できませんでした。設定を再取得してください');
 return saved;
}
export async function createEventFixedRound(s:SupabaseClient,request:FixedRoundRequest){
 const {eventId,revision,lastRound,courtCount,mode,activeIds,matches,requestId}=request;
 const {data,error}=await s.rpc('create_fixed_pair_round',{p_event_id:eventId,p_expected_revision:revision,p_last_round:lastRound,p_court_count:courtCount,p_mode:mode,p_active_ids:activeIds,p_matches:matches,p_request_id:requestId});
 if(error)fail(error,'Round生成の保存結果を確認できませんでした。同じ操作で再試行すると前回の結果を確認します');
 if(!data||data.event_id!==eventId||data.request_id!==requestId||typeof data.round_id!=='string'||!data.round_id||data.round_number!==lastRound+1)throw new FixedPairRequestError('Round生成の確認応答が不正です。再試行して結果を確認してください');
 return data as {event_id:string;request_id:string;round_id:string;round_number:number};
}
export async function finishEventWithFixedPairs(s:SupabaseClient,previous:FixedPairState,close:boolean,mode?:'official'|'record_only'){
 if(close&&previous.used_fixed_pairs&&!mode)throw new FixedPairRequestError('イベント内だけに保存するか、通算へ反映するかを選択してください',true);
 const {data,error}=await s.rpc('finish_fixed_pair_event',{p_event_id:previous.event_id,p_expected_revision:previous.revision,p_close:close,p_stats_mode:mode??null});
 if(error)fail(error,close?'イベントを終了できませんでした':'イベントを再開できませんでした');
 const expected=close?(previous.used_fixed_pairs?mode:'official'):(previous.used_fixed_pairs?'undecided':'official');
 if(!data||data.event_id!==previous.event_id||data.status!==(close?'closed':'active')||data.stats_mode!==expected)throw new FixedPairRequestError('終了・再開の保存結果を確認できませんでした。再読み込みしてください');
 return data as {event_id:string;status:'active'|'closed';stats_mode:'official'|'record_only'|'undecided'};
}

const pendingKey=(userId:string,eventId:string)=>`padel-fixed-round:${userId}:${eventId}`;
export function readPendingFixedRound(userId:string,eventId:string):FixedRoundRequest|null{
 if(!userId||typeof window==='undefined')return null;
 try{const value=JSON.parse(window.sessionStorage.getItem(pendingKey(userId,eventId))??'null');if(!value||value.eventId!==eventId||typeof value.requestId!=='string'||!Number.isSafeInteger(value.revision)||!Number.isInteger(value.lastRound)||!Array.isArray(value.activeIds)||!Array.isArray(value.matches))return null;return value;}catch{return null;}
}
export function storePendingFixedRound(userId:string,eventId:string,request:FixedRoundRequest|null){
 if(!userId||typeof window==='undefined')return;
 try{if(request)window.sessionStorage.setItem(pendingKey(userId,eventId),JSON.stringify(request));else window.sessionStorage.removeItem(pendingKey(userId,eventId));}catch{/* 同じ画面内ではrefにも保持する。 */}
}
