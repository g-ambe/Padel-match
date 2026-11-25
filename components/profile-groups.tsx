"use client";
import Link from "next/link";
import { GroupActionIcon } from "./group-action-icon";
import { GroupEntryLink, useGroupOriginRestore } from "@/components/group-entry-link";
import { useEffect, useState } from "react";
import { Card } from "./ui";
import { AppDialog } from "./app-dialog";
import { PROFILE_GROUP_ACTIONS } from "@/lib/padel-facilities";
import { profileGroupPreview } from "@/lib/profile-options";
import { getSupabaseClient } from "@/lib/supabase";
import { readMemberGroups } from "@/lib/member-groups";
import { orderProfileGroups, type ProfileGroupUsage } from "@/lib/profile-group-usage";

export function ProfileGroups({ owner }: { owner: string | null }) {
  const [expanded,setExpanded]=useState(false);
  const [groups,setGroups]=useState<{id:string;name:string}[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  useEffect(()=>{
    let active=true;setExpanded(false);setGroups([]);setError("");setLoading(true);
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
  useGroupOriginRestore(owner,!loading,setExpanded);
  const preview=profileGroupPreview(groups);
  const list=(rows:typeof groups)=><div className="divide-y divide-zinc-700">{rows.map(group=><GroupEntryLink origin="profile" expanded={expanded} groupId={group.id} key={group.id} onClick={()=>setExpanded(false)} className="flex min-h-14 items-center gap-3 py-2"><span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 font-semibold text-accent">{Array.from(group.name.trim())[0]??"G"}</span><span className="min-w-0 flex-1 break-words text-sm font-semibold">{group.name}</span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-zinc-400"><path d="m9 5 7 7-7 7"/></svg></GroupEntryLink>)}</div>;
  const actions=PROFILE_GROUP_ACTIONS;
  return <><Card title="所属グループ">
    {preview.hasMore&&<div className="-mt-1 flex justify-end"><button type="button" className="min-h-11 px-1 text-xs text-zinc-400 hover:underline" onClick={()=>setExpanded(true)}>すべて見る<GroupActionIcon name="right" className="inline-block"/></button></div>}
    {loading&&<p role="status" className="py-3 text-sm text-zinc-400">読み込み中…</p>}
    {list(preview.visible)}
    {!loading&&!groups.length&&!error&&<p className="py-3 text-sm text-zinc-400">まだ所属グループがありません</p>}
    {error&&<p role="alert" className="py-2 text-xs text-zinc-400">{error}</p>}
  </Card>
  {owner&&<div aria-label="グループ操作" className="mt-3 grid grid-cols-2 gap-2">{actions.map(action=><Link key={action.href} href={action.href} className="flex min-h-20 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-card px-1 py-2 text-center text-[11px] font-semibold leading-snug hover:bg-zinc-800"><span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-accent"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={action.path}/>{action.kind==="search"&&<circle cx="10" cy="10" r="6"/>}</svg></span><span className="flex min-h-[2.75em] items-center justify-center break-words">{action.label}</span></Link>)}</div>}
  <AppDialog open={expanded&&!!owner} title="所属グループ一覧" onClose={()=>setExpanded(false)}><div data-group-scroll className="min-h-0 overflow-y-auto overscroll-contain p-4"><p className="mb-2 text-xs text-zinc-400">直近90日のイベント利用が多い順</p>{list(preview.all)}<button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-zinc-600 text-sm" onClick={()=>setExpanded(false)}>閉じる</button></div></AppDialog></>;
}
