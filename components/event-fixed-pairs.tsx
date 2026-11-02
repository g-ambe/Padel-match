"use client";

import {useState} from "react";
import {AppDialog} from "./app-dialog";
import {GuestName} from "./match-ui";
import type {FixedPairState} from "@/lib/event-fixed-pairs";
import {fixedPairAvailability,type FixedPair} from "@/lib/friendly-fixed-pairs";

type Person={id:string;name:string;guest:boolean;status:string};
export function EventFixedPairs({people,activeIds,snapshot,error,busy,closed,onSave,onReload}:{people:Person[];activeIds:string[];snapshot:FixedPairState|null;error:string;busy:boolean;closed:boolean;onSave:(pairs:FixedPair[])=>Promise<boolean>;onReload:()=>Promise<void>}){
 const[open,setOpen]=useState(false),[a,setA]=useState(''),[b,setB]=useState('');
 const pairs=snapshot?.pairs??[],fixed=new Set(pairs.flatMap(p=>[p.a,p.b])),active=new Set(activeIds),availability=fixedPairAvailability(activeIds,pairs);
 const free=people.filter(p=>active.has(p.id)&&!fixed.has(p.id)),name=(id:string)=>people.find(p=>p.id===id);
 const person=(id:string)=>{const p=name(id);return <GuestName name={p?.name??'参加者を確認してください'} guest={!!p?.guest}/>;};
 const save=async()=>{if(!a||!b||a===b)return;if(await onSave([...pairs,{id:crypto.randomUUID(),a,b}])){setOpen(false);setA('');setB('');}};
 return <section className="mt-4 space-y-3 border-t border-zinc-600 pt-4" aria-label="固定ペア設定">
  <div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">固定ペア：{pairs.length}組</h3><p className="text-sm text-zinc-300">通常参加メンバー：{activeIds.filter(id=>!fixed.has(id)).length}人</p></div>
  {!snapshot&&<p className="text-sm text-zinc-300">固定ペア設定を確認してください</p>}
  {pairs.length>0&&<ul className="space-y-2">{pairs.map(pair=><li key={pair.id} className="rounded-xl border border-zinc-600 p-3">
   <div className="flex items-center justify-between gap-2"><div className="min-w-0 flex-1 break-words text-sm"><span aria-hidden="true">🔒 </span>{person(pair.a)} <span aria-hidden="true">×</span> {person(pair.b)}</div>{!closed&&<button type="button" className="min-h-11 shrink-0 rounded-xl border border-zinc-500 px-3 text-sm disabled:opacity-40" disabled={busy||!snapshot} onClick={()=>void onSave(pairs.filter(p=>p.id!==pair.id))}>解除</button>}</div>
   {active.has(pair.a)!==active.has(pair.b)&&<p role="status" className="mt-2 text-xs text-amber-300">片方が欠席・休み・生成対象外です。両者を参加に戻すか、固定を解除してください。</p>}
   {!active.has(pair.a)&&!active.has(pair.b)&&<p className="mt-2 text-xs text-zinc-300">両者とも生成対象外です。固定設定は保持します。</p>}
  </li>)}</ul>}
  {activeIds.length<=4&&<p role="status" className="text-sm text-amber-300">ペア固定は5人以上で設定できます。{pairs.length>0&&'現在は固定を一時停止し、従来の自動組み合わせを使用します。設定は保持し、両名が参加可能で5人以上に戻ると再適用します。'}</p>}
  {activeIds.length===5&&<p role="status" className="text-sm text-amber-300">5人での開催では、休憩の公平性を保つため、固定ペアの片方だけがお休みになる場合があります。そのRoundでは別の選手と組む可能性があります。</p>}
  {availability.incomplete.length>0&&activeIds.length>=5&&<p className="text-xs text-amber-300">片方だけが明示的に休みの場合は、そのまま生成できません。参加状態または固定設定を調整してください。</p>}
  {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
  {!closed&&<div className="flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-xl border border-accent px-4 text-sm text-accent disabled:opacity-40" disabled={busy||!snapshot||activeIds.length<5||activeIds.length>20||free.length<2} onClick={()=>{setA('');setB('');setOpen(true);}}>＋ ペアを固定</button><button type="button" className="min-h-11 rounded-xl border border-zinc-500 px-3 text-sm disabled:opacity-40" disabled={busy} onClick={()=>void onReload()}>設定を再取得</button></div>}
  {busy&&<p role="status" className="text-sm text-zinc-300">処理中…</p>}
  <AppDialog open={open&&!closed} title="ペアを固定" busy={busy} onClose={()=>setOpen(false)}><div className="space-y-4 overflow-y-auto p-4">
   <p className="text-sm text-zinc-300">2名を固定します。変更は次Roundから適用し、過去の試合は変更しません。</p>
   {activeIds.length===5&&<p className="text-sm text-amber-300">5人では公平な休憩のため、そのRoundだけ別の選手と組む場合があります。</p>}
   {[['選手A',a,setA,b],['選手B',b,setB,a]].map(([label,value,change,other])=><label key={label as string} className="block space-y-1 text-sm"><span>{label as string}</span><select aria-label={label as string} className="min-h-12 w-full rounded-xl border border-zinc-500 bg-zinc-800 p-3" value={value as string} disabled={busy} onChange={e=>(change as (value:string)=>void)(e.target.value)}><option value="">選択してください</option>{free.map(p=><option key={p.id} value={p.id} disabled={p.id===other}>{p.name}{p.guest?'（ゲスト）':''}</option>)}</select></label>)}
   {a&&b&&<div className="text-sm">{person(a)} × {person(b)}</div>}
   {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
   <div className="grid grid-cols-2 gap-2"><button type="button" className="min-h-12 rounded-xl border border-zinc-500" disabled={busy} onClick={()=>setOpen(false)}>キャンセル</button><button type="button" className="min-h-12 rounded-xl bg-accent font-bold text-black disabled:opacity-40" disabled={busy||!a||!b||a===b||activeIds.length<5||!free.some(p=>p.id===a)||!free.some(p=>p.id===b)} onClick={()=>void save()}>固定する</button></div>
  </div></AppDialog>
 </section>;
}
