"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyRecoveryUpdateError, createRecoveryClient, finishRecoverySignOut, recoveryPasswordError, recoveryRedirect, takeRecoveryToken } from "@/lib/password-recovery";
import { getSupabaseClient } from "@/lib/supabase";

type Stage = "loading"|"confirm"|"form"|"invalid"|"done"|"uncertain";
export default function ResetPassword() {
 const [stage,setStage]=useState<Stage>("loading"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [password,setPassword]=useState(""),[confirmation,setConfirmation]=useState(""),[show,setShow]=useState(false);
 const token=useRef<string|null>(null),client=useRef<SupabaseClient|null>(null),userId=useRef<string|null>(null),inFlight=useRef(false),initialized=useRef(false),generation=useRef(0);
 useEffect(()=>{const capture=()=>{const hash=window.location.hash;if(!hash&&initialized.current)return;if(inFlight.current){window.history.replaceState(window.history.state,"",window.location.pathname);return;}initialized.current=true;generation.current++;setPassword("");setConfirmation("");setError("");
  window.history.replaceState(window.history.state,"",window.location.pathname);token.current=takeRecoveryToken(hash);client.current=null;userId.current=null;
  if(!token.current||!recoveryRedirect(window.location.origin)){setStage("invalid");return;}setStage("confirm");};
  capture();window.addEventListener("hashchange",capture);return()=>window.removeEventListener("hashchange",capture);},[]);
 const verify=async()=>{if(inFlight.current||!token.current)return;const db=createRecoveryClient();if(!db){setStage("invalid");return;}
  inFlight.current=true;setBusy(true);setError("");const version=generation.current;try{const value=token.current;token.current=null;const {data,error:failure}=await db.auth.verifyOtp({token_hash:value,type:"recovery"});
   if(version!==generation.current)return;if(failure||!data.session||!data.user||data.session.user.id!==data.user.id)throw Error();client.current=db;userId.current=data.user.id;setStage("form");
  }catch{if(version===generation.current)setStage("invalid");}finally{inFlight.current=false;setBusy(false);}};
 const update=async(e:React.FormEvent)=>{e.preventDefault();if(inFlight.current)return;if(password.length<8){setError("パスワードは8文字以上で入力してください");return;}if(password!==confirmation){setError("パスワード確認が一致しません");return;}
  const db=client.current,id=userId.current;if(!db||!id){setStage("invalid");return;}inFlight.current=true;setBusy(true);setError("");const version=generation.current;
  try{const {data:identity,error:identityError}=await db.auth.getUser();if(version!==generation.current)return;if(identityError||identity.user?.id!==id){setStage("invalid");return;}
   const {data,error:failure}=await db.auth.updateUser({password});
   if(failure){if(version!==generation.current)return;const kind=classifyRecoveryUpdateError(failure);if(kind==="retry")setError(recoveryPasswordError(failure.code));else if(kind==="expired")setStage("invalid");else {setPassword("");setConfirmation("");setStage("uncertain");}return;}
   // A successful update requires cleanup even if navigation or another link changes the UI.
   let shared:SupabaseClient|null=null, sharedUnavailable=false;
   try {shared=getSupabaseClient();if(!shared)sharedUnavailable=true;} catch {sharedUnavailable=true;}
   const cleanupSucceeded=await finishRecoverySignOut(db,shared,id);
   const cleanupFailed=data.user?.id!==id||!cleanupSucceeded||sharedUnavailable;
   if(version===generation.current){setPassword("");setConfirmation("");if(cleanupFailed)setNotice("パスワードは変更されました。他の端末のログアウトを確認できませんでした。再ログインしてください。");setStage("done");}
  }catch{if(version===generation.current){setPassword("");setConfirmation("");setStage("uncertain");}}
  finally{inFlight.current=false;setBusy(false);}};
 return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-4"><h1 className="text-2xl font-bold">パスワードを再設定</h1>
 {stage==="loading"&&<p role="status">確認中…</p>}{stage==="confirm"&&<><p className="text-sm">再設定を始めるには、以下のボタンを押してください。</p><button disabled={busy} onClick={()=>void verify()} className="min-h-11 rounded-xl bg-accent p-3 text-black">{busy?"確認中…":"再設定を始める"}</button></>}
 {stage==="invalid"&&<><p role="alert">リンクが無効、使用済み、または期限切れです。もう一度メールをお申し込みください。</p><Link className="min-h-11 rounded-xl border border-zinc-500 p-3 text-center" href="/auth/forgot-password">再設定メールを申し込む</Link></>}
 {stage==="form"&&<form onSubmit={update} className="space-y-4"><label className="block text-sm">新しいパスワード<input aria-label="新しいパスワード" required autoComplete="new-password" type={show?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl bg-zinc-800 p-3"/></label><label className="block text-sm">パスワード確認<input aria-label="パスワード確認" required autoComplete="new-password" type={show?"text":"password"} value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl bg-zinc-800 p-3"/></label><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={show} onChange={e=>setShow(e.target.checked)}/>パスワードを表示</label><p className="text-xs text-zinc-400">8文字以上で入力してください。</p>{error&&<p role="alert">{error}</p>}<button disabled={busy} className="min-h-11 w-full rounded-xl bg-accent p-3 text-black">{busy?"変更中…":"パスワードを変更"}</button></form>}
 {stage==="uncertain"&&<><p role="alert">通信結果を確認できません。再送せず、新しいパスワードでログインをお試しください。</p><Link href="/login" className="min-h-11 rounded-xl border border-zinc-500 p-3 text-center">ログイン画面へ</Link></>}
 {stage==="done"&&<><p role="status">パスワードを変更しました。再ログインしてください。</p>{notice&&<p role="alert">{notice}</p>}<Link href="/login" className="min-h-11 rounded-xl border border-zinc-500 p-3 text-center">ログイン画面へ</Link></>}
 </main>;
}
