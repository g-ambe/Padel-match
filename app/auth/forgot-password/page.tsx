"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { recoveryRedirect } from "@/lib/password-recovery";

export default function ForgotPassword() {
 const [email,setEmail]=useState(""),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[remaining,setRemaining]=useState(0);
 const inFlight=useRef(false),lastSent=useRef(0);
 useEffect(()=>{try{lastSent.current=Number(localStorage.getItem("padel-recovery-sent-at"))||0;}catch{}const timer=setInterval(()=>setRemaining(Math.max(0,Math.ceil((lastSent.current+60000-Date.now())/1000))),500);return()=>clearInterval(timer);},[]);
 const send=async(e:React.FormEvent)=>{e.preventDefault();if(inFlight.current||Date.now()-lastSent.current<60000)return;
  const db=getSupabaseClient(),redirect=recoveryRedirect(window.location.origin);if(!db||!redirect){setError("送信できません。時間をおいてお試しください。");return;}
  inFlight.current=true;setBusy(true);setError("");lastSent.current=Date.now();try{localStorage.setItem("padel-recovery-sent-at",String(lastSent.current));}catch{}setRemaining(60);
  try{const {error:failure}=await db.auth.resetPasswordForEmail(email.trim(),{redirectTo:redirect});
   if(failure && failure.status !== 400 && failure.status !== 422)throw failure;
   setSent(true);
  }catch{setError("送信できませんでした。時間をおいてからもう一度お試しください。");}
  finally{inFlight.current=false;setBusy(false);}
 };
 return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-4"><h1 className="text-2xl font-bold">パスワードを再設定</h1><p className="text-sm">登録したメールアドレスを入力してください。</p>
 <form onSubmit={send} className="space-y-4"><label className="block text-sm">メールアドレス<input aria-label="メールアドレス" type="email" required autoComplete="email" className="mt-2 min-h-11 w-full rounded-xl bg-zinc-800 p-3" value={email} onChange={e=>setEmail(e.target.value)}/></label>
 {sent&&<p role="status" className="text-sm">登録されている場合、再設定メールを送信しました。届かない場合は迷惑メールもご確認ください。</p>}{error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
 <button disabled={busy||remaining>0} className="min-h-11 w-full rounded-xl bg-accent p-3 font-semibold text-black disabled:opacity-50">{busy?"送信中…":remaining?`再送まで${remaining}秒`:sent?"再送する":"再設定メールを送信"}</button></form><Link href="/login" className="min-h-11 rounded-xl border border-zinc-500 p-3 text-center">ログイン画面へ戻る</Link></main>;
}
