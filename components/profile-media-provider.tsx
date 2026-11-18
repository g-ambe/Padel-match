"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { compressProfileImage } from "@/lib/profile-media/compress";
import { instagramUsername, mergePrivateProfile, type PrivateProfile } from "@/lib/profile-media/shared";
import type { HomeCourtSelection } from "@/lib/padel-facilities";
import { homeCourtName } from "@/lib/profile-options";
import { avatarPosition, sameAvatarPosition, type AvatarPosition } from "@/lib/profile-media/position";
export type ProfileMediaState = { profile?: PrivateProfile; image?: string; imageEnabled?: boolean; loading?: boolean; busy?: boolean; error?: string; message?: string; uncertain?: boolean };
type State = ProfileMediaState;
type Job = { owner: string; profile: string; request: string; version: number; kind: "upload"|"delete"; blob?: Blob; file?: File; uncertain?: boolean };
type MediaContext = { saveHomeCourt:(owner:string,profile:string,value:string|HomeCourtSelection,version:number)=>Promise<PrivateProfile>; states: Record<string,State>; load: (owner:string,profile:string)=>Promise<void>; change:(owner:string,profile:string,file?:File,expectedVersion?:number)=>Promise<PrivateProfile|null>; retry:(owner:string,profile:string,reconcileOnly?:boolean)=>Promise<PrivateProfile|null>; saveInstagram:(owner:string,profile:string,value:string,expectedVersion?:number)=>Promise<void>; savePosition:(owner:string,profile:string,position:AvatarPosition,avatarVersion:number,poseVersion:number)=>Promise<PrivateProfile> };
const Context = createContext<MediaContext|null>(null);
const keyFor=(owner:string,profile:string)=>`${owner}:${profile}`;
export function ProfileMediaProvider({children}:{children:ReactNode}){
 const [states,setStates]=useState<Record<string,State>>({}),[banner,setBanner]=useState("");
 const current=useRef<string|null>(null),cache=useRef<Record<string,State>>({}),jobs=useRef(new Map<string,Job>()),loading=useRef(new Map<string,Promise<void>>()),images=useRef(new Map<string,string>());
 const clear=()=>{for(const url of images.current.values())URL.revokeObjectURL(url);images.current.clear();jobs.current.clear();loading.current.clear();cache.current={};setStates({});setBanner("");};
 useEffect(()=>{const db=getSupabaseClient();if(!db)return;
  const {data}=db.auth.onAuthStateChange((_event,session)=>{const next=session?.user.id??null;if(current.current!==next){current.current=next;clear();}});
  return()=>{data.subscription.unsubscribe();for(const url of images.current.values())URL.revokeObjectURL(url);};
 },[]);
 const update=(owner:string,id:string,patch:Partial<State>)=>{if(current.current!==owner)return;const key=keyFor(owner,id);if(patch.profile)patch={...patch,profile:mergePrivateProfile(cache.current[key]?.profile,patch.profile)};const value={...cache.current[key],...patch};cache.current={...cache.current,[key]:value};setStates(cache.current);};
 const request=async(owner:string,path:string,init?:RequestInit)=>{
  const db=getSupabaseClient();const auth=await db?.auth.getSession();
  if(!auth?.data.session||auth.data.session.user.id!==owner)throw new Error("ログイン情報が変わりました");
  if(current.current!==owner){current.current=owner;clear();}
  const response=await fetch(path,{...init,headers:{...init?.headers,Authorization:`Bearer ${auth.data.session.access_token}`}});
  const result=await response.json();
  if(!response.ok){const error=new Error(result.error||"処理できませんでした") as Error&{uncertain?:boolean};error.uncertain=!!result.uncertain;throw error;}
  return result;
 };
 const showImage=async(owner:string,id:string,profile:PrivateProfile)=>{
  if(current.current!==owner||cache.current[keyFor(owner,id)]?.profile?.avatar_version!==profile.avatar_version)return;
  if(!profile.avatar_key){for(const [key,url] of images.current)if(key.startsWith(keyFor(owner,id)+":")){URL.revokeObjectURL(url);images.current.delete(key);}update(owner,id,{image:undefined});return;}
  const versionKey=`${keyFor(owner,id)}:${profile.avatar_version}`,existing=images.current.get(versionKey);
  if(existing){update(owner,id,{image:existing});return;}
  const db=getSupabaseClient(),session=(await db?.auth.getSession())?.data.session;
  if(!session||session.user.id!==owner)return;
  const response=await fetch(`/api/profile-media/${id}/image?version=${profile.avatar_version}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:"default"});
  if(!response.ok)throw new Error("画像を取得できませんでした。再表示してください");
  const blob=await response.blob();if(current.current!==owner||cache.current[keyFor(owner,id)]?.profile?.avatar_version!==profile.avatar_version)return;
  const url=URL.createObjectURL(blob);images.current.set(versionKey,url);
  for(const [key,old] of images.current)if(key.startsWith(keyFor(owner,id)+":")&&key!==versionKey){URL.revokeObjectURL(old);images.current.delete(key);}
  update(owner,id,{image:url});
 };
 const read=async(owner:string,id:string,operation?:string)=>{
  const result=await request(owner,`/api/profile-media/${id}${operation?`?request=${operation}`:""}`);
  update(owner,id,{profile:result.profile,imageEnabled:result.imageEnabled,loading:false,error:""});
  try{await showImage(owner,id,result.profile);}catch(error){update(owner,id,{error:(error as Error).message});}
  return result;
 };
 const load=async(owner:string,id:string)=>{
  const key=keyFor(owner,id),inflight=loading.current.get(key);if(inflight)return inflight;
  const work=(async()=>{update(owner,id,{loading:true});try{await read(owner,id);}catch(error){update(owner,id,{loading:false,error:(error as Error).message});}})();
  loading.current.set(key,work);try{await work;}finally{loading.current.delete(key);}
 };
 const run=async(job:Job):Promise<PrivateProfile|null>=>{
  const {owner,profile:id}=job,key=keyFor(owner,id);
  update(owner,id,{busy:true,error:"",message:"",uncertain:false});if(current.current===owner)setBanner(job.file&&!job.blob?"プロフィール画像を圧縮中…":"プロフィール画像を変更中…");
  try{
   if(job.kind==="upload"&&!job.blob)job.blob=await compressProfileImage(job.file!);
   if(current.current===owner)setBanner(job.kind==="upload"?"プロフィール画像をアップロード中…":"プロフィール画像を削除中…");
   const result=await request(owner,`/api/profile-media/${id}`,{method:job.kind==="upload"?"PUT":"DELETE",headers:{"Content-Type":"image/webp","X-Profile-Request":job.request,"X-Profile-Version":String(job.version)},body:job.blob});
   update(owner,id,{profile:result.profile,busy:false,message:job.kind==="delete"?"画像を削除しました":"画像を変更しました",uncertain:false});jobs.current.delete(key);
   try{await showImage(owner,id,result.profile);}catch{update(owner,id,{error:"画像は保存済みですが、表示を取得できませんでした。再表示してください"});}
   if(current.current===owner)setBanner(job.kind==="delete"?"プロフィール画像を削除しました":"プロフィール画像を変更しました");
   return result.profile;
  }catch(error){
   job.uncertain=!!(error as Error&{uncertain?:boolean}).uncertain;
   // サーバーの応答自体が失われた場合も、操作IDからDBの確定状態を問い合わせる。
   try{const actual=await read(owner,id,job.request);if(actual.operation?.status==="committed"){
    update(owner,id,{busy:false,uncertain:false,message:"画像の変更を確認しました",error:""});jobs.current.delete(key);if(current.current===owner)setBanner("画像の変更を確認しました");return actual.profile;
   }job.uncertain=actual.operation?.status==="pending";}catch{job.uncertain=true;}
   update(owner,id,{busy:false,error:(error as Error).message,uncertain:job.uncertain});if(current.current===owner)setBanner((error as Error).message);
   return null;
  }
 };
 const change=async(owner:string,id:string,file?:File,expectedVersion?:number)=>{
  const key=keyFor(owner,id);if(cache.current[key]?.busy||jobs.current.has(key)&&jobs.current.get(key)?.uncertain)return null;
  const job:Job={owner,profile:id,kind:file?"upload":"delete",file,request:crypto.randomUUID(),version:expectedVersion??cache.current[key]?.profile?.avatar_version??0};jobs.current.set(key,job);return run(job);
 };
 const retry=async(owner:string,id:string,reconcileOnly=false)=>{
  const key=keyFor(owner,id),job=jobs.current.get(key);if(cache.current[key]?.busy)return null;
  if(!job){try{return (await read(owner,id)).profile;}catch(error){update(owner,id,{error:(error as Error).message});}return null;}
  try{
   const actual=await read(owner,id,job.request);
   if(actual.operation?.status==="committed"){jobs.current.delete(key);update(owner,id,{error:"",uncertain:false,message:"画像の変更を確認しました"});return actual.profile;}
   if(reconcileOnly&&actual.operation?.status!=="pending"){jobs.current.delete(key);update(owner,id,{uncertain:false,error:"画像の変更は確定していません。内容を確認して保存してください"});return null;}
   if(actual.operation?.status!=="pending"){job.request=crypto.randomUUID();job.version=actual.profile.avatar_version;}
   return run(job);
  }catch(error){update(owner,id,{error:(error as Error).message});return null;}
 };
 const saveInstagram=async(owner:string,id:string,value:string,expectedVersion?:number)=>{
  const username=instagramUsername(value),version=expectedVersion??cache.current[keyFor(owner,id)]?.profile?.instagram_version??0;
  try{
   const result=await request(owner,`/api/profile-media/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:username??"",version})});
   update(owner,id,{profile:result.profile});
  }catch(error){
   const actual=await read(owner,id).catch(()=>null);
   if(actual?.profile.instagram_version>version&&actual.profile.instagram_username===username)return;
   throw error;
  }
 };
 const savePosition=async(owner:string,id:string,position:AvatarPosition,avatarVersion:number,poseVersion:number)=>{
  const check=(profile:PrivateProfile)=>profile.avatar_version===avatarVersion&&(profile.avatar_pose_version??0)>poseVersion&&sameAvatarPosition(avatarPosition(profile),position);
  try{
   const result=await request(owner,`/api/profile-media/${id}/position`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({position,avatarVersion,poseVersion})});
   if(current.current!==owner)throw new Error("ログイン情報が変わりました");
   update(owner,id,{profile:result.profile});
   const actual=cache.current[keyFor(owner,id)]?.profile??result.profile;
   if(!check(actual))throw new Error("写真または表示位置が別の画面で変更されています。再読み込みしてください");
   return actual;
  }catch(error){
   const actual=await read(owner,id).catch(()=>null);
   if(actual&&check(actual.profile))return actual.profile;
   throw error;
  }
 };
 const saveHomeCourt=async(owner:string,id:string,value:string|HomeCourtSelection,version:number)=>{
  const facilityId=typeof value==="string"?null:value.facilityId,name=homeCourtName(typeof value==="string"?value:value.name);
  const confirmed=(profile:PrivateProfile)=>(profile.home_court_version??0)>version&&(profile.home_facility_id??null)===facilityId&&(facilityId!==null||profile.home_court_name===name);
  try{
   const result=await request(owner,`/api/profile-media/${id}/home-court`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(typeof value==="string"?{name:name??"",version}:{name:name??"",version,facilityId})});
   if(current.current!==owner)throw new Error("ログイン情報が変わりました");
   update(owner,id,{profile:result.profile});
   const actual=cache.current[keyFor(owner,id)]?.profile??result.profile;
   if(!confirmed(actual))throw new Error("ホームコートが別の画面で変更されています。再読み込みしてください");
   return actual;
  }catch(error){const actual=await read(owner,id).catch(()=>null);if(actual&&confirmed(actual.profile))return actual.profile;throw error;}
 };
 return <Context.Provider value={{states,load,change,retry,saveInstagram,savePosition,saveHomeCourt}}>{children}{banner&&<aside className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-2 rounded-xl border border-zinc-600 bg-card p-3 text-sm shadow-lg"><p role="status" className="min-w-0 flex-1">{banner}</p><button type="button" aria-label="画像の通知を閉じる" className="min-h-11 min-w-11" onClick={()=>setBanner("")}>×</button></aside>}</Context.Provider>;
}
export function useProfileMedia(owner:string|null,id:string|null){
 const value=useContext(Context);if(!value)throw new Error("ProfileMediaProviderが必要です");
 useEffect(()=>{if(owner&&id)void value.load(owner,id);},[owner,id]);
 return {...value,state:owner&&id?value.states[keyFor(owner,id)]??{}:{}};
}
