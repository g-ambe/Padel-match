"use client";
import type { ReactNode } from "react";
import type { ProfileMediaState } from "./profile-media-provider";
import { ProfileAvatar } from "./profile-avatar";
import { avatarPosition } from "@/lib/profile-media/position";
import { instagramHref } from "@/lib/profile-media/shared";

export function ProfileMediaPanel({name,level,area,bio,hand,position,state,onEdit,canEdit,children}:{name:string;level:string;area:string;bio:string;hand:string;position:string;state:ProfileMediaState;onEdit:()=>void;canEdit:boolean;children?:ReactNode}){
 const details=!!(bio||hand||position||state.profile?.instagram_username);
 return <section className="relative overflow-hidden rounded-2xl border border-zinc-700 bg-card p-4" aria-label="プロフィール概要">
  <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-accent to-transparent"/>
  <div className="flex items-center gap-3"><ProfileAvatar image={state.image} name={name} position={avatarPosition(state.profile)}/><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h2 className="min-w-0 break-words text-xl font-bold">{name||"プロフィール未選択"}</h2><button type="button" aria-label="プロフィールを編集" title="プロフィールを編集" disabled={!canEdit} onClick={onEdit} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-zinc-300 disabled:opacity-40"><svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16 4a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button></div>{(level||area)&&<p className="mt-1 break-words text-xs text-zinc-400">{level&&<span className="font-semibold text-accent">{level}</span>}{level&&area&&" ・ "}{area}</p>}</div></div>
  {details&&<div className="mt-3 space-y-2 border-t border-zinc-700 pt-3">{(hand||position)&&<p className="text-xs text-zinc-400">{[hand?`${hand}利き`:"",position].filter(Boolean).join(" ・ ")}</p>}{bio&&<p className="whitespace-pre-wrap break-words text-sm text-zinc-300">{bio}</p>}{state.profile?.instagram_username&&<a className="inline-flex min-h-11 max-w-full items-center gap-2 break-all text-xs text-accent" href={instagramHref(state.profile.instagram_username)} target="_blank" rel="noopener noreferrer"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8"/></svg>@{state.profile.instagram_username}</a>}</div>}
  {state.busy&&<p role="status" className="mt-2 text-xs text-accent">画像を処理中です。画面を移動しても処理を続けます。</p>}
  {state.error&&<p role="alert" className="mt-2 text-xs text-red-400">{state.error}</p>}{children}
 </section>;
}
