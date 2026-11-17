"use client";
import type { ReactNode } from "react";
import type { ProfileMediaState } from "./profile-media-provider";
import { ProfileAvatar } from "./profile-avatar";
import { facilityDisplayName } from "@/lib/padel-facilities";
import { avatarPosition } from "@/lib/profile-media/position";
import { instagramHref } from "@/lib/profile-media/shared";

export function ProfileMediaPanel({name,level,area,bio,hand,position,state,onEdit,canEdit,children}:{name:string;level:string;area:string;bio:string;hand:string;position:string;state:ProfileMediaState;onEdit:()=>void;canEdit:boolean;children?:ReactNode}){
 const facts=[["レベル",level],["活動エリア",area],["利き手",hand?`${hand}利き`:""],["得意サイド",position]];
 const homeCourt=facilityDisplayName(state.profile);
 const details=!!(bio||state.profile?.instagram_username);
 return <section className="relative overflow-hidden rounded-2xl border border-zinc-700 bg-card p-4" aria-label="プロフィール概要">
  <div className="flex items-center gap-3"><ProfileAvatar image={state.image} name={name} position={avatarPosition(state.profile)}/><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h2 className="min-w-0 break-words text-xl font-bold">{name||"プロフィール未選択"}</h2><button type="button" aria-label="プロフィールを編集" title="プロフィールを編集" disabled={!canEdit} onClick={onEdit} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-zinc-300 disabled:opacity-40"><svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16 4a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button></div><p className="mt-1 text-xs text-zinc-400">プレイヤープロフィール</p></div></div>
  <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4">{facts.map(([label,value])=><div key={label} className="min-w-0"><dt className="mb-1 text-[11px] text-zinc-400">{label}</dt><dd className={`break-words text-sm font-semibold ${label==="レベル"&&value?"text-accent":""}`}>{value||"未設定"}</dd></div>)}{homeCourt&&<div className="col-span-2 min-w-0"><dt className="mb-1 text-[11px] text-zinc-400">ホームコート</dt><dd className="break-words text-sm font-semibold">{homeCourt}</dd></div>}</dl>
  {details&&<div className="mt-3 space-y-2 border-t border-zinc-700 pt-3">{bio&&<div><p className="mb-1 text-[11px] text-zinc-400">ひとこと</p><p className="whitespace-pre-wrap break-words text-sm text-zinc-300">{bio}</p></div>}{state.profile?.instagram_username&&<a className="inline-flex min-h-11 max-w-full items-center gap-2 break-all text-xs text-accent" href={instagramHref(state.profile.instagram_username)} target="_blank" rel="noopener noreferrer"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/></svg>@{state.profile.instagram_username}</a>}</div>}
  {state.busy&&<p role="status" className="mt-2 text-xs text-accent">画像を処理中です。画面を移動しても処理を続けます。</p>}
  {state.error&&<p role="alert" className="mt-2 text-xs text-red-400">{state.error}</p>}{children}
 </section>;
}
