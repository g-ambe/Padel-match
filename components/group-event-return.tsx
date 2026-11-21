"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSessionAccount } from "@/components/use-session-account";
import { readGroupEventReturn } from "@/lib/group-detail-navigation";
export function GroupEventReturn(){
  const account=useSessionAccount(),[href,setHref]=useState<string|null>(null);
  useEffect(()=>{setHref(null);if(!account.ready)return;const token=new URLSearchParams(location.search).get("groupReturn"),r=readGroupEventReturn(sessionStorage,token,account.id);if(r&&r.path===location.pathname)setHref(`${r.group}${r.group.includes("?")?"&":"?"}groupView=${token}`);},[account.id,account.ready]);
  return href?<Link href={href} scroll={false} className="block min-h-11 py-3 text-sm underline">グループへ戻る</Link>:null;
}
