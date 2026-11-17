"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ProfileAvatar } from "./profile-avatar";
import type { useProfileMedia } from "./profile-media-provider";
import { avatarPosition, CENTERED_AVATAR, clampAvatarPosition, MAX_AVATAR_ZOOM, moveAvatarPosition, sameAvatarPosition, type AvatarPosition } from "@/lib/profile-media/position";

export function ProfilePhotoEditor({owner,id,name,media,onBack,onSaved,onBusy}:{owner:string;id:string;name:string;media:ReturnType<typeof useProfileMedia>;onBack:()=>void;onSaved:(message:string)=>void;onBusy:(busy:boolean)=>void}){
 const {state,change,retry,savePosition,load}=media;
 const [baseline,setBaseline]=useState(()=>({profile:state.profile!,image:state.image}));
 const [position,setPosition]=useState<AvatarPosition>(()=>avatarPosition(state.profile));
 const [file,setFile]=useState<File>(),[preview,setPreview]=useState<string>(),[deleting,setDeleting]=useState(false);
 const [size,setSize]=useState<{w:number;h:number}|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const alive=useRef(true),localSaving=useRef(false),drag=useRef<{id:number;x:number;y:number}|undefined>(undefined),back=useRef<HTMLButtonElement>(null),input=useRef<HTMLInputElement>(null),inputId=useId();
 useEffect(()=>{alive.current=true;back.current?.focus({preventScroll:true});return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!file){setPreview(undefined);return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
 const stale=!!state.profile&&(state.profile.avatar_version!==baseline.profile.avatar_version||(state.profile.avatar_pose_version??0)!==(baseline.profile.avatar_pose_version??0));
 const locked=!!state.busy||saving||!!state.uncertain;
 const source=deleting?undefined:file?preview:baseline.image;
 useEffect(()=>{if(!file&&!deleting&&!baseline.image&&state.image&&state.profile?.avatar_version===baseline.profile.avatar_version)setBaseline(b=>({...b,image:state.image}));},[state.image,state.profile?.avatar_version,file,deleting,baseline.image,baseline.profile.avatar_version]);
 const canMove=!!source&&!!size&&!locked&&!stale;
 const changed=file||deleting||!sameAvatarPosition(position,avatarPosition(baseline.profile));
 const resetBaseline=(profile:NonNullable<typeof state.profile>,image?:string)=>{setBaseline({profile,image});setPosition(avatarPosition(profile));setFile(undefined);setDeleting(false);setSize(null);setError("");};
 const reload=async()=>{if(locked)return;await load(owner,id);/* 次の描画の最新値を明示操作で採用する。 */};
 const save=async()=>{
  if(localSaving.current||locked||stale||!changed)return;
  localSaving.current=true;setSaving(true);setError("");
  // 画像処理はProviderで継続する。位置だけの保存中は二重操作と閉じる操作を止める。
  if(!file&&!deleting)onBusy(true);
  try{
   if(file||deleting){
    if(deleting&&!window.confirm("プロフィール写真を削除しますか？"))return;
    const actual=await change(owner,id,file,baseline.profile.avatar_version);
    if(!actual){if(alive.current)setError("画像の変更は確認できていません。再確認してください。確定していなければ以前の画像はそのまま保存されています。");return;}
    if(!deleting&&!sameAvatarPosition(position,CENTERED_AVATAR)){
     try{await savePosition(owner,id,position,actual.avatar_version,actual.avatar_pose_version??0);}
     catch(cause){if(alive.current){setBaseline({profile:actual,image:undefined});setFile(undefined);setError(`写真は保存済みですが、表示位置は未保存です。${(cause as Error).message}`);}return;}
    }
    if(alive.current)onSaved(deleting?"写真を削除しました":"写真を変更しました");
   }else{
    await savePosition(owner,id,position,baseline.profile.avatar_version,baseline.profile.avatar_pose_version??0);
    if(alive.current)onSaved("写真の表示位置を保存しました");
   }
  }catch(cause){if(alive.current)setError((cause as Error).message);}
  finally{localSaving.current=false;if(alive.current){setSaving(false);onBusy(false);}}
 };
 const endDrag=(e:React.PointerEvent<HTMLDivElement>)=>{if(drag.current?.id===e.pointerId){drag.current=undefined;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}};
 return <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
  <button ref={back} type="button" disabled={saving&&!state.busy} className="mb-3 min-h-11 text-sm text-zinc-400 disabled:opacity-40" onClick={onBack}>‹ プロフィール編集に戻る</button>
  <p className="mb-3 text-center text-xs text-zinc-400">写真をドラッグして位置を調整</p>
  <div className="mx-auto w-[min(100%,16rem)]">
   <ProfileAvatar image={source} name={name} position={position} className="aspect-square w-full touch-none select-none border-2 border-accent/60" tabIndex={canMove?0:-1} role="group" aria-label="写真の表示位置。ドラッグまたは矢印キーで調整" onSize={(w,h)=>{setSize({w,h});if(w*h>40_000_000){setError("4000万画素以下の写真を選択してください");setFile(undefined);return;}setPosition(p=>clampAvatarPosition(w,h,p));}}
    onPointerDown={e=>{if(!canMove||e.button!==0||drag.current)return;e.preventDefault();drag.current={id:e.pointerId,x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const d=drag.current;if(!canMove||!size||!d||d.id!==e.pointerId)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;d.x=e.clientX;d.y=e.clientY;const side=e.currentTarget.clientWidth;setPosition(p=>moveAvatarPosition(size.w,size.h,side,p,dx,dy));}}
    onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={()=>{drag.current=undefined;}}
    onKeyDown={e=>{if(!canMove||!size||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const dx=e.key==='ArrowLeft'?-5:e.key==='ArrowRight'?5:0,dy=e.key==='ArrowUp'?-5:e.key==='ArrowDown'?5:0;const side=e.currentTarget.clientWidth;setPosition(p=>moveAvatarPosition(size.w,size.h,side,p,dx,dy));}}/>
  </div>
  <fieldset disabled={!canMove} className="mt-4 space-y-2 disabled:opacity-40"><label className="flex items-center justify-between text-xs" htmlFor={`${inputId}-zoom`}><span>拡大・縮小</span><output>{Math.round(position.zoom*100)}%</output></label><input id={`${inputId}-zoom`} aria-label="写真の拡大率" className="min-h-11 w-full accent-accent" type="range" min="1" max={MAX_AVATAR_ZOOM} step="0.05" value={position.zoom} onChange={e=>{if(size)setPosition(p=>clampAvatarPosition(size.w,size.h,{...p,zoom:Number(e.target.value)}));}}/><button type="button" className="min-h-11 text-xs text-accent" onClick={()=>setPosition({...CENTERED_AVATAR})}>中央に戻す</button></fieldset>
  <div className="flex gap-2 text-xs"><button type="button" disabled={locked||stale||!state.imageEnabled} className="min-h-11 flex-1 rounded-xl border border-zinc-600 px-2 disabled:opacity-40" onClick={()=>input.current?.click()}>写真を変更</button>{(baseline.profile.avatar_key||file)&&<button type="button" disabled={locked||stale||!state.imageEnabled} className="min-h-11 flex-1 rounded-xl border border-zinc-600 px-2 text-red-400 disabled:opacity-40" onClick={()=>{setDeleting(true);setFile(undefined);setPosition({...CENTERED_AVATAR});}}>写真を削除</button>}</div>
  <input ref={input} aria-label="プロフィール写真を選択" type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" disabled={locked||stale||!state.imageEnabled} onChange={e=>{const next=e.target.files?.[0];e.target.value="";if(!next)return;if(!/^image\/(jpeg|png|webp|avif)$/.test(next.type)||next.size>20*1024*1024){setError("20MB以下のJPEG・PNG・WebP・AVIFを選択してください");return;}setError("");setFile(next);setDeleting(false);setSize(null);setPosition({...CENTERED_AVATAR});}}/>
  {deleting&&<p className="mt-2 text-xs text-red-400">保存すると写真を削除します</p>}
  {state.busy&&<p role="status" className="mt-2 text-xs text-accent">画像を処理中です。閉じても処理を続けます。</p>}
  {!state.imageEnabled&&<p className="mt-2 text-xs text-zinc-400">写真変更は現在利用できません</p>}
  {(error||state.error)&&<p role="alert" className="mt-2 text-xs text-red-400">{error||state.error}</p>}
  {(state.error||state.uncertain)&&<button type="button" disabled={!!state.busy||saving} className="min-h-11 text-xs text-accent underline disabled:opacity-40" onClick={async()=>{const actual=await retry(owner,id,true);if(alive.current&&actual)onSaved("画像の変更を確認しました");}}>再確認・再試行</button>}
  {stale&&!state.busy&&!saving&&<div className="mt-2 text-xs"><p role="alert" className="text-amber-300">写真または表示位置が更新されています。最新の状態から調整し直してください。</p><button type="button" className="min-h-11 text-accent underline" onClick={()=>{if(state.profile)resetBaseline(state.profile,state.image);}}>最新の表示位置を使う</button></div>}
  {state.error&&!state.busy&&<button type="button" className="min-h-11 text-xs text-accent underline" onClick={()=>void reload()}>最新の情報を再取得</button>}
  <div className="mt-3 flex gap-2 text-sm"><button type="button" disabled={saving&&!state.busy} className="min-h-11 flex-1 rounded-xl border border-zinc-600 disabled:opacity-40" onClick={onBack}>{state.busy?"閉じる（処理は続行）":"キャンセル"}</button><button type="button" disabled={locked||stale||!changed||(!deleting&&(!source||!size))} className="min-h-11 flex-1 rounded-xl bg-accent px-2 font-semibold text-black disabled:opacity-40" onClick={()=>void save()}>{saving?"保存中…":file?"写真を保存":deleting?"削除を確定":"この位置で保存"}</button></div>
  <p className="mt-3 text-[11px] text-zinc-400">位置だけの保存では元画像・画像変更回数は変わりません。写真の変更・削除はこの画面の保存で確定します。</p>
 </div>;
}
