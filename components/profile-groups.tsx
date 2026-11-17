"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "./ui";
import { getSupabaseClient } from "@/lib/supabase";
import { readMemberGroups } from "@/lib/member-groups";
import { orderProfileGroups, type ProfileGroupUsage } from "@/lib/profile-group-usage";

export function ProfileGroups({ owner }: { owner: string | null }) {
  const [groups,setGroups]=useState<{id:string;name:string}[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  useEffect(()=>{
    let active=true;setGroups([]);setError("");setLoading(true);
    if(!owner){setLoading(false);return;}
    const s=getSupabaseClient();if(!s){setError("所属グループを取得できませんでした");setLoading(false);return;}
    void(async()=>{
      try{
        const access=await readMemberGroups(s);if(!active||access.uid!==owner)return;
        setGroups(orderProfileGroups(access.groups,[]));setLoading(false);
        if(!access.groups.length)return;
        try{
          const result=await s.rpc("get_my_profile_group_usage");if(result.error)throw result.error;
          if(active)setGroups(orderProfileGroups(access.groups,(result.data??[]) as ProfileGroupUsage[]));
        }catch{if(active)setError("利用順を取得できなかったため、グループ名順で表示しています");}
      }catch{if(active)setError("所属グループを取得できませんでした");}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;};
  },[owner]);
  return <Card title="所属グループ"><div className="divide-y divide-zinc-700">
    {loading&&<p role="status" className="py-3 text-sm text-zinc-400">読み込み中…</p>}
    {groups.map(group=><Link key={group.id} href={`/groups/${group.id}`} className="flex min-h-14 items-center gap-3 py-2"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 font-semibold text-accent">{Array.from(group.name.trim())[0]??"G"}</span><span className="min-w-0 flex-1 break-words text-sm font-semibold">{group.name}</span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-zinc-400"><path d="m9 5 7 7-7 7"/></svg></Link>)}
    {!loading&&!groups.length&&!error&&<p className="py-3 text-sm text-zinc-400">まだ所属グループがありません</p>}
  </div>{error&&<p role="alert" className="py-2 text-xs text-zinc-400">{error}</p>}{owner&&<div className="mt-2 flex flex-wrap gap-x-4 text-xs text-zinc-400"><Link className="flex min-h-11 items-center underline" href="/groups/discover">グループを探す</Link><Link className="flex min-h-11 items-center underline" href="/groups/new">作成</Link><Link className="flex min-h-11 items-center underline" href="/groups">管理</Link></div>}</Card>;
}
