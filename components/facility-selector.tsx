"use client";
import { useId, useState } from "react";
import { PREFECTURES } from "@/lib/profile-options";
import { FACILITY_REGIONS,filterFacilities,facilityPrefecture,facilityAvailability,type Facility } from "@/lib/padel-facilities";

export function FacilitySelector({facilities,value,onChange,disabled=false,other=false,loading=false,error=""}:{facilities:readonly Facility[];value:string|null;onChange:(id:string|null)=>void;disabled?:boolean;other?:boolean;loading?:boolean;error?:string}){
 const id=useId(),[area,setArea]=useState(""),[query,setQuery]=useState("");
 const candidates=filterFacilities(facilities,area,query),current=facilities.find(f=>f.id===value),visible=candidates.some(f=>f.id===value);
 const label=(f:Facility)=>[f.name,facilityPrefecture(f.prefecture),facilityAvailability(f)].filter(Boolean).join(" / ");
 return <fieldset disabled={disabled} className="space-y-2 text-sm disabled:opacity-40"><div className="grid grid-cols-2 gap-2"><label className="min-w-0"><span className="mb-1 block text-xs text-zinc-400">地域・都道府県</span><select className="min-h-11 w-full rounded-xl bg-zinc-800 p-2" value={area} onChange={e=>setArea(e.target.value)}><option value="">全国</option><optgroup label="地域">{Object.keys(FACILITY_REGIONS).map(r=><option key={r} value={`region:${r}`}>{r}</option>)}</optgroup><optgroup label="都道府県">{PREFECTURES.map(p=><option key={p} value={`pref:${p}`}>{p}</option>)}</optgroup></select></label><label className="min-w-0"><span className="mb-1 block text-xs text-zinc-400">施設名で検索</span><input className="min-h-11 w-full rounded-xl bg-zinc-800 p-2" value={query} placeholder="施設名" onChange={e=>setQuery(e.target.value)}/></label></div>
 <label htmlFor={id} className="block text-xs text-zinc-400">施設を選択</label><select id={id} aria-label="施設を選択" className="min-h-11 w-full rounded-xl bg-zinc-800 p-2" value={value??""} onChange={e=>onChange(e.target.value||null)}><option value="">未設定・選択解除</option>{current&&!visible&&<option value={current.id} disabled={current.availability==="closed"}>{label(current)}（現在の登録）</option>}{value&&value!=="other"&&!current&&<option value={value}>現在の施設（候補未取得）</option>}{candidates.map(f=><option key={f.id} value={f.id}>{label(f)}</option>)}{other&&<option value="other">その他・自由入力</option>}</select>
 {loading&&<p role="status" className="text-xs text-zinc-400">施設を読み込み中…</p>}{error&&<p role="alert" className="text-xs text-red-400">{error}</p>}{!loading&&!error&&!candidates.length&&<p className="text-xs text-zinc-400">条件に合う施設がありません</p>}{current?.usage_note&&<p className="text-xs text-zinc-400">{current.usage_note}</p>}
 </fieldset>;
}
