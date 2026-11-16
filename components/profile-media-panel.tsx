"use client";
import { useEffect, useId, useState } from "react";
import { useProfileMedia } from "./profile-media-provider";
import { instagramHref } from "@/lib/profile-media/shared";
export function ProfileMediaPanel({owner,id,name,level,area,ambiguous}:{owner:string|null;id:string|null;name:string;level:string;area:string;ambiguous:boolean}){
 const {state,change,retry,saveInstagram}=useProfileMedia(owner,id),inputId=useId();
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(""),[saving,setSaving]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 useEffect(()=>{setEditing(false);setDraft("");setError("");setMessage("");},[owner,id]);
 const save=async(value:string)=>{if(!owner||!id||saving)return;setSaving(true);setError("");setMessage("");try{await saveInstagram(owner,id,value);setEditing(false);setMessage("Instagram IDを更新しました");}catch(e){setError((e as Error).message);}finally{setSaving(false);}};
 const canEdit=!!(owner&&id&&state.profile&&!ambiguous);
 return <>
 <section className="rounded-2xl bg-card p-4" aria-label="プロフィール概要"><div className="flex items-center gap-4">
  {state.image?<img src={state.image} alt="プロフィール画像" width={80} height={80} className="h-20 w-20 rounded-full object-contain bg-zinc-800"/>:<div aria-label="既定のプロフィール画像" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-3xl text-accent">{name.trim().slice(0,1)||"P"}</div>}
  <div className="min-w-0"><h2 className="break-words text-xl font-bold">{name||"プロフィール未選択"}</h2><p className="mt-1 text-sm text-accent">{level||"レベル未設定"}</p><p className="break-words text-sm text-zinc-400">{area||"活動地域未設定"}</p></div>
 </div>
 {ambiguous&&<p role="alert" className="mt-2 text-xs text-amber-300">複数の連携プロフィールがあります。画像・Instagramの変更には正規プロフィールの確認が必要です。</p>}
 {id&&<div className="mt-2 flex flex-wrap gap-2 text-xs">
  <label htmlFor={inputId} aria-disabled={!canEdit||!state.imageEnabled||state.busy||state.uncertain} className={`flex min-h-11 items-center rounded-lg border border-zinc-600 px-3 ${!canEdit||!state.imageEnabled||state.busy||state.uncertain?"opacity-40":"cursor-pointer"}`}>画像を変更</label>
  <input id={inputId} aria-label="プロフィール画像を選択" type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" disabled={!canEdit||!state.imageEnabled||state.busy||state.uncertain} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value="";if(file&&owner)void change(owner,id,file);}}/>
  {state.profile?.avatar_key&&<button type="button" disabled={!canEdit||!state.imageEnabled||state.busy||state.uncertain} className="min-h-11 px-3 text-zinc-400 disabled:opacity-40" onClick={()=>{if(owner&&window.confirm("プロフィール画像を削除しますか？"))void change(owner,id);}}>画像を削除</button>}
  {(state.error||state.uncertain)&&<button type="button" disabled={state.busy} className="min-h-11 px-3 text-accent underline" onClick={()=>{if(owner)void retry(owner,id);}}>再確認・再試行</button>}
 </div>}
 {state.busy&&<p role="status" className="text-xs text-accent">画像を処理中です。他の項目や画面も利用できます。</p>}
 {state.error&&<p role="alert" className="mt-1 text-xs text-red-400">{state.error}</p>}{state.message&&<p role="status" className="text-xs text-accent">{state.message}</p>}
 {state.profile&&!state.imageEnabled&&<p className="text-xs text-zinc-400">プロフィール画像の設定は準備中です</p>}
 </section>
 <section className="space-y-2 rounded-2xl bg-card p-4" aria-label="Instagram"><div className="flex min-h-11 items-center gap-2">
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-accent"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/></svg>
  {state.profile?.instagram_username?<a className="min-w-0 flex-1 break-all text-sm text-accent underline" href={instagramHref(state.profile.instagram_username)} target="_blank" rel="noopener noreferrer">@{state.profile.instagram_username}</a>:<span className="min-w-0 flex-1 text-sm text-zinc-400">Instagram未登録</span>}
  {!editing&&canEdit&&<button type="button" className="min-h-11 px-2 text-xs underline" onClick={()=>{setDraft(state.profile?.instagram_username??"");setEditing(true);setError("");setMessage("");}}>Instagramを編集</button>}
 </div>
 {editing&&<fieldset disabled={saving} className="space-y-2"><input aria-label="Instagram ID" maxLength={31} autoCapitalize="none" autoCorrect="off" placeholder="ユーザーネーム（@は任意）" className="min-h-11 w-full rounded-xl bg-zinc-800 p-2 text-sm" value={draft} onChange={e=>setDraft(e.target.value)}/><div className="flex gap-2 text-sm"><button type="button" className="min-h-11 flex-1 rounded-lg bg-accent px-2 text-black" onClick={()=>void save(draft)}>Instagramを保存</button><button type="button" className="min-h-11 px-3" onClick={()=>setEditing(false)}>キャンセル</button>{state.profile?.instagram_username&&<button type="button" className="min-h-11 px-2 text-red-300" onClick={()=>void save("")}>IDを削除</button>}</div></fieldset>}
 {error&&<p role="alert" className="text-xs text-red-400">{error}</p>}{message&&<p role="status" className="text-xs text-accent">{message}</p>}
 </section>
 </>;
}
