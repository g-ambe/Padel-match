"use client";
import { useEffect,useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { FacilitySelector } from "./facility-selector";
import type { Facility,HomeCourtSelection } from "@/lib/padel-facilities";
export function ProfileHomeCourtField({value,onChange,disabled}:{value:HomeCourtSelection;onChange:(value:HomeCourtSelection)=>void;disabled:boolean}){
 const [rows,setRows]=useState<Facility[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 useEffect(()=>{let active=true;const db=getSupabaseClient();if(!db){setError("施設候補を取得できませんでした。登録済みの値は保持しています。");setLoading(false);return;}
  void(async()=>{const result=await db.from("padel_facilities").select("id,name,prefecture,address,aliases,availability,usage_note").order("name").limit(500);if(!active)return;if(result.error)setError("施設候補を取得できませんでした。登録済みの値は保持しています。");else setRows((result.data??[]) as Facility[]);setLoading(false);})().catch(()=>{if(active){setLoading(false);setError("施設候補を取得できませんでした。登録済みの値は保持しています。");}});return()=>{active=false;};
 },[]);
 return <div className="space-y-2"><p className="text-xs text-zinc-400">ホームコート（任意）</p><FacilitySelector facilities={rows} value={value.facilityId} groupByPrefecture loading={loading} error={error} disabled={disabled} onChange={selected=>onChange({facilityId:selected,name:rows.find(f=>f.id===selected)?.name??""})}/>
 {!value.facilityId&&value.name&&<div className="text-xs text-zinc-400"><p className="break-words">現在の登録：{value.name}</p><button type="button" disabled={disabled} className="mt-1 min-h-11 rounded-xl border border-zinc-600 px-3 disabled:opacity-40" onClick={()=>onChange({facilityId:null,name:""})}>登録解除</button></div>}</div>;
}
