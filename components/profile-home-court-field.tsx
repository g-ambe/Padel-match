"use client";
import { useEffect,useId,useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { FacilitySelector } from "./facility-selector";
import type { Facility,HomeCourtSelection } from "@/lib/padel-facilities";
export function ProfileHomeCourtField({value,onChange,disabled}:{value:HomeCourtSelection;onChange:(value:HomeCourtSelection)=>void;disabled:boolean}){
 const id=useId(),[rows,setRows]=useState<Facility[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const [free,setFree]=useState(()=>!value.facilityId&&!!value.name);
 useEffect(()=>{if(value.facilityId)setFree(false);else if(value.name)setFree(true);},[value.facilityId,value.name]);
 useEffect(()=>{let active=true;const db=getSupabaseClient();if(!db){setError("施設候補を取得できませんでした。自由入力は利用できます。");setLoading(false);return;}
  void(async()=>{const result=await db.from("padel_facilities").select("id,name,prefecture,address,aliases,availability,usage_note").order("name").limit(500);if(!active)return;if(result.error)setError("施設候補を取得できませんでした。登録済みの値は保持しています。");else setRows((result.data??[]) as Facility[]);setLoading(false);})().catch(()=>{if(active){setLoading(false);setError("施設候補を取得できませんでした。登録済みの値は保持しています。");}});return()=>{active=false;};
 },[]);
 return <div className="space-y-2"><p className="text-xs text-zinc-400">ホームコート（任意）</p><FacilitySelector facilities={rows} value={value.facilityId??(free?"other":null)} other groupByPrefecture loading={loading} error={error} disabled={disabled} onChange={selected=>{if(selected==="other"){setFree(true);onChange({facilityId:null,name:value.facilityId?"":value.name});}else{setFree(false);onChange({facilityId:selected,name:rows.find(f=>f.id===selected)?.name??""});}}}/>
 {free&&<div><label htmlFor={id} className="mb-1 block text-xs text-zinc-400">その他・自由入力</label><input id={id} aria-label="ホームコート名（自由入力）" disabled={disabled} className="min-h-11 w-full rounded-xl bg-zinc-800 p-3 text-sm disabled:opacity-40" placeholder="80文字以内のコート名" value={value.name} onChange={e=>onChange({facilityId:null,name:e.target.value})}/><p className="mt-1 text-[11px] text-zinc-400">自由入力の名前は共通施設マスターへ登録しません。</p></div>}</div>;
}
