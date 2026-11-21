"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { useSessionAccount } from "@/components/use-session-account";
import { groupOrigins, readGroupOrigin, saveGroupOrigin, type GroupOrigin } from "@/lib/group-detail-navigation";

export function GroupEntryLink({ groupId, origin, stats=false, expanded=false, children, ...props }: Omit<ComponentProps<typeof Link>,"href"> & {groupId:string;origin:GroupOrigin;stats?:boolean;expanded?:boolean}) {
  const account=useSessionAccount(),router=useRouter();
  return <Link {...props} href={`/groups/${groupId}?from=${origin}${stats?"&tab=stats":""}`} onClick={async event=>{
    props.onClick?.(event);
    if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    try{
      const token=crypto.randomUUID(), fixed=document.body.style.position==="fixed",y=location.pathname===groupOrigins[origin]?(fixed?-(parseFloat(document.body.style.top)||0):scrollY):(document.querySelector<HTMLElement>(`nav[aria-label="通知"]`)?.scrollTop??0);
      const inside=document.querySelector<HTMLElement>('dialog[open] [data-group-scroll]')?.scrollTop??0;
      const identity=account.id??(await getSupabaseClient()?.auth.getSession())?.data.session?.user.id;
      if(!identity){router.push(`/groups/${groupId}?from=${origin}${stats?"&tab=stats":""}`);return;}
      saveGroupOrigin(sessionStorage,token,{account:identity,path:groupOrigins[origin],y,expanded,inside});
      if(location.pathname===groupOrigins[origin]){const url=new URL(location.href);url.searchParams.set("groupRestore",token);history.replaceState(history.state,"",url.pathname+url.search+url.hash);}
      event.preventDefault();router.push(`/groups/${groupId}?from=${origin}&entry=${token}${stats?"&tab=stats":""}`);
    }catch{router.push(`/groups/${groupId}?from=${origin}${stats?"&tab=stats":""}`);}
  }}>{children}</Link>;
}
export function useGroupOriginRestore(account:string|null, ready:boolean, onExpanded?:(open:boolean)=>void){
  const applied=useRef<string|null>(null), callback=useRef(onExpanded);callback.current=onExpanded;
  useEffect(()=>{
    if(!ready||!account)return;
    const token=new URLSearchParams(location.search).get("groupRestore"),r=readGroupOrigin(sessionStorage,token,account);
    if(!token||!r||r.path!==location.pathname||applied.current===token)return;
    let frame=0,tries=0,cancelled=false;
    const restore=()=>{
      if(cancelled)return;
      window.scrollTo(0,r.y);
      if(++tries<90&&document.documentElement.scrollHeight-innerHeight<r.y-2){frame=requestAnimationFrame(restore);return;}
      applied.current=token;callback.current?.(r.expanded);
      frame=requestAnimationFrame(()=>{const scroller=document.querySelector<HTMLElement>('dialog[open] [data-group-scroll]');if(scroller)scroller.scrollTop=r.inside;});
    };
    frame=requestAnimationFrame(restore);
    return()=>{cancelled=true;cancelAnimationFrame(frame);};
  },[account,ready]);
}
