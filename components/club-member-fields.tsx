"use client";
import { useEffect, useRef, useState } from "react";
import type { ClubNameMember, ClubNameContext } from "@/lib/club-display-name";
import { saveClubMemberField, validMemberFieldState, type MemberFieldState } from "@/lib/club-member-fields";
import { getSupabaseClient } from "@/lib/supabase";
import { GroupActionIcon } from "./group-action-icon";
export function ClubMemberFields({member,context,state,onSaved,onReload}: {
 member:ClubNameMember; context:ClubNameContext; state:MemberFieldState|null;
 onSaved:(next:MemberFieldState)=>void; onReload:()=>Promise<MemberFieldState|null>;
}) {
 const [editing,setEditing]=useState(false),[name,setName]=useState(member.club_display_name??""),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[saved,setSaved]=useState(false),[snapshot,setSnapshot]=useState(state);
 const inFlight=useRef(false),alive=useRef(true),composing=useRef(false),confirmed=useRef(state),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(timer.current)clearTimeout(timer.current);};},[]);
 useEffect(()=>{if(!inFlight.current&&!error){confirmed.current=state;setSnapshot(state);}},[state,error]);
 const apply=(value:MemberFieldState)=>{confirmed.current=value;setSnapshot(value);onSaved(value);};
 const save=async(change:{field:"name";name:string}|{field:"public";enabled:boolean})=>{
  const db=getSupabaseClient(),base=confirmed.current;
  if(inFlight.current||error||!db||!base)return;
  if(change.field==="name"&&change.name.trim()===base.club_display_name){setEditing(false);return;}
  inFlight.current=true;setBusy(true);setSaved(false);
  try{
   let result=await saveClubMemberField(db,member,context,base,change);
   if(!alive.current)return;apply(result);
   // A toggle prevents input blur. Persist OFF first, then the pending name:
   // initializing a NULL alias must never briefly expose it while choosing OFF.
   if(change.field==="public"&&editing&&name.trim()!==result.club_display_name){
    result=await saveClubMemberField(db,member,context,result,{field:"name",name});
    if(!alive.current)return;apply(result);
   }
   setEditing(false);setName(result.club_display_name??"");setSaved(true);
   if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setSaved(false),2500);
  }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"保存結果を確認できません。最新の状態を確認してください");}
  finally{inFlight.current=false;if(alive.current)setBusy(false);}
 };
 const reload=async()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);try{const latest=await onReload();if(!alive.current)return;if(!latest||!validMemberFieldState(latest))throw Error("最新の表示設定を確認できませんでした");apply(latest);setError("");}catch{if(alive.current)setError("最新の状態を取得できませんでした。入力は保持しています");}finally{inFlight.current=false;if(alive.current)setBusy(false);}};
 const valid=!!snapshot&&validMemberFieldState(snapshot);
 const initializesPublic=!!snapshot&&snapshot.club_display_name===null&&snapshot.public_name_choice===null&&!snapshot.public_name_confirmed&&context.visibility==="public";
 const selectedPublic=initializesPublic||!!snapshot?.public_name_enabled;
 return <div className="space-y-2" aria-busy={busy}>
  <div className="flex items-center gap-2"><span className="text-xs text-zinc-400">グループ内表示名</span>{saved&&<span role="status" aria-label="保存しました" className="text-emerald-500"><GroupActionIcon name="check"/></span>}{busy&&<span className="text-xs text-zinc-400">保存中…</span>}</div>
  {editing?<input aria-label="グループ内表示名" autoFocus value={name} disabled={busy} className="min-h-11 w-full rounded-xl bg-zinc-700 p-3" onChange={e=>setName(e.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onBlur={e=>{if((e.relatedTarget as HTMLElement|null)?.getAttribute("role")==="switch")return;if(!composing.current)void save({field:"name",name});}} onKeyDown={e=>{if(e.key==="Enter"&&!e.nativeEvent.isComposing&&!composing.current){e.preventDefault();void save({field:"name",name});}if(e.key==="Escape"){setEditing(false);setName(snapshot?.club_display_name??"");}}}/>:<div className="flex items-center justify-between gap-2"><span className="min-w-0 break-words">{snapshot?.club_display_name??"未設定"}</span><button type="button" aria-label="グループ内表示名を編集" disabled={busy||!valid||!!error} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg disabled:opacity-40" onClick={()=>setEditing(true)}><GroupActionIcon name="pencil"/></button></div>}
  {member.linked_auth_user_id===context.userId&&context.visibility==="public"&&<div className="flex items-center justify-between gap-3 text-sm"><span>{initializesPublic?"名前の設定後：公開":"未所属者への表示："+(snapshot?.public_name_enabled?"公開":"非公開")}</span><button type="button" role="switch" aria-label="グループ内表示名を公開" aria-checked={selectedPublic} disabled={busy||!valid||!!error} onPointerDown={e=>e.preventDefault()} onClick={()=>void save({field:"public",enabled:!selectedPublic})} className={`flex min-h-11 min-w-16 items-center justify-center rounded-xl border px-3 disabled:opacity-40 ${selectedPublic?"border-emerald-600 text-emerald-500":"border-zinc-500 text-zinc-400"}`}>{selectedPublic?"ON":"OFF"}</button></div>}
  {(!valid||error)&&<div><p role="alert" className="text-sm text-red-400">{error||"最新の表示設定を読み込んでください"}</p><button type="button" disabled={busy} className="min-h-11 text-sm underline" onClick={()=>void reload()}>最新の状態を確認</button></div>}
 </div>;
}
