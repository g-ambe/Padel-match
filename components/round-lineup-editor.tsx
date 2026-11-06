"use client";
import { useState } from 'react';
import { AppDialog } from './app-dialog';
import { sameLineups, swapRoundPlayers, type RoundCard } from '@/lib/guest-round-lineup';

export type LineupEditorData = { round: number; cards: (RoundCard & { court_number: number })[]; people: {id:string;name:string}[]; eligible: string[]; blocked_reason?:string|null };
export function RoundLineupEditor({ data, target, busy, onClose, onSave }: { data:LineupEditorData;target:string;busy:boolean;onClose:()=>void;onSave:(cards:RoundCard[])=>Promise<void> }) {
 const [cards,setCards]=useState<RoundCard[]>(()=>structuredClone(data.cards));
 const [selected,setSelected]=useState<{matchId:string;participantId:string}|null>(null),[error,setError]=useState(''),[attempted,setAttempted]=useState(false);
 const name=(id:string)=>data.people.find(p=>p.id===id)?.name??'選手を確認してください';
 const editable=(c:RoundCard)=>!data.blocked_reason&&!c.completed&&c.result==null;
 const choose=(matchId:string,id:string)=>{
  if(!selected){setSelected({matchId,participantId:id});setError('');return;}
  try{setCards(swapRoundPlayers(cards,selected.matchId,selected.participantId,id));setSelected(null);setError('');}catch(cause){setError(cause instanceof Error?cause.message:'変更できません');}
 };
 const positions=new Map(cards.flatMap(c=>c.players.map(p=>[p.participant_id,c] as const)));
 const save=async()=>{setAttempted(true);setError('');try{await onSave(cards);}catch(cause){setError(cause instanceof Error?cause.message:'保存に失敗しました。同じ内容で再試行してください。');}};
 return <AppDialog open title={`Round ${data.round} のメンバー変更`} busy={busy} onClose={onClose}>
  <div className="friendly-scoreboard-input min-h-0 space-y-3 overflow-y-auto p-4">
   <p aria-live="polite" className="break-all text-sm">{selected?`${name(selected.participantId)} の入替相手を選択`:'選手 → 入替相手をタップ'}</p>
   {data.blocked_reason&&<p role="alert" className="text-sm text-amber-300">{data.blocked_reason}</p>}
   {cards.map(c=><section key={c.id} className={`rounded-xl border p-3 ${c.id===target?'border-accent':'border-zinc-600'}`}>
    <h3 className="mb-2 text-sm font-bold">コート{data.cards.find(m=>m.id===c.id)?.court_number}{!editable(c)&&'（変更不可）'}</h3>
    <div className="grid grid-cols-2 gap-2">{(['A','B'] as const).map(team=><div key={team}><p className="mb-1 text-xs">ペア{team}</p>{c.players.filter(p=>p.team===team).map(p=><button key={p.participant_id} type="button" disabled={busy||attempted||!editable(c)||!!selected&&!data.eligible.includes(p.participant_id)} aria-pressed={selected?.participantId===p.participant_id} className={`friendly-scoreboard-pair pair-${team.toLowerCase()} mb-1 min-h-11 w-full break-all rounded-xl border p-2 text-sm ${selected?.participantId===p.participant_id?'ring-2 ring-accent':'border-zinc-500'} disabled:opacity-40`} onClick={()=>choose(c.id,p.participant_id)}>{name(p.participant_id)}</button>)}</div>)}</div>
   </section>)}
   <section><h3 className="mb-2 text-sm font-bold">このRoundの休憩者</h3><div className="flex flex-wrap gap-2">{data.people.filter(p=>data.eligible.includes(p.id)&&!positions.has(p.id)).map(p=><button key={p.id} type="button" disabled={!selected||busy||attempted||!!data.blocked_reason} className="min-h-11 break-all rounded-xl border border-zinc-500 p-2 text-sm disabled:opacity-40" onClick={()=>{if(selected)choose(selected.matchId,p.id);}}>{p.name}</button>)}</div></section>
   {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
   {attempted&&error&&<p className="text-xs text-zinc-400">同じ内容で再試行できます。別の変更は閉じて最新データを確認してから操作してください。</p>}
  </div>
  <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-zinc-700 p-4"><button type="button" disabled={busy} className="min-h-12 rounded-xl border border-zinc-500" onClick={onClose}>{attempted?"閉じる":"キャンセル"}</button><button type="button" disabled={busy||!!data.blocked_reason||sameLineups(data.cards,cards)} className="min-h-12 rounded-xl bg-accent font-bold text-black disabled:opacity-40" onClick={()=>void save()}>{busy?'保存中…':attempted?'再試行':'保存'}</button></div>
 </AppDialog>;
}
