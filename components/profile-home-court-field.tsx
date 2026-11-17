"use client";
import { useEffect, useId, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
export function ProfileHomeCourtField({value,onChange,disabled}:{value:string;onChange:(value:string)=>void;disabled:boolean}){
 const id=useId(),[names,setNames]=useState<string[]>([]),[error,setError]=useState(false);
 useEffect(()=>{let active=true;const db=getSupabaseClient();if(!db){setError(true);return;}
  void(async()=>{const result=await db.from("padel_facilities").select("name").order("name").limit(500);if(!active)return;if(result.error){setError(true);return;}setNames([...new Set((result.data??[]).map(row=>String(row.name)))]);})().catch(()=>{if(active)setError(true);});return()=>{active=false;};
 },[]);
 return <div><label htmlFor={id} className="mb-1 block text-xs text-zinc-400">ホームコート（任意）</label><input id={id} aria-label="ホームコート" disabled={disabled} list={`${id}-courts`} className="min-h-11 w-full rounded-xl bg-zinc-800 p-3 text-sm disabled:opacity-40" placeholder="よく利用するコート名" value={value} onChange={e=>onChange(e.target.value)}/><datalist id={`${id}-courts`}>{names.map(name=><option key={name} value={name}/>)}</datalist><p className="mt-1 text-[11px] text-zinc-400">{error?"施設候補を取得できませんでした。":"既存施設の候補から選べます。"}未掲載のコートは80文字以内で直接入力できます。</p></div>;
}
