"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AppDialog } from "./app-dialog";
import { eventFormats } from "@/lib/event-formats";

export function EventFormatCards({ group = "", guest = false, onSelect, highlight }: { group?: string; guest?: boolean; onSelect?: (id: string) => boolean | void; highlight?: (id: string) => Record<string, string | undefined> }) {
  const [info, setInfo] = useState<(typeof eventFormats)[number] | null>(null);
  return <>
    <div className="space-y-3" data-event-formats>
      {eventFormats.map(format => {
        const unavailable = guest && format.id === "team";
        const content = <><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-accent"><FormatIcon id={format.id}/></span><span className="min-w-0"><strong className="block text-lg">{format.title}</strong><span className="mt-1 block text-xs leading-5 text-zinc-300">{format.description}</span>{unavailable && <span className="block text-xs text-zinc-400">ログイン後に利用できます</span>}</span></>;
        const cls = "flex min-h-24 min-w-0 flex-1 items-center gap-3 rounded-xl p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
        return <div key={format.id} className="flex items-center rounded-2xl border border-zinc-700 bg-card">
          {onSelect ? <button type="button" {...highlight?.(format.id)} aria-label={format.title} className={cls} onClick={()=>{if(onSelect(format.id)===false)setInfo(format);}}>{content}</button> : unavailable ? <div className={cls}>{content}</div> : <Link aria-label={format.title} className={cls} href={format.href + (format.id !== "team" && group ? `&group=${encodeURIComponent(group)}` : "")}>{content}</Link>}
          <button type="button" aria-label={`${format.title}の説明`} title={`${format.title}の説明`} className="mr-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={()=>setInfo(format)}><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></svg></button>
        </div>;
      })}
    </div>
    <AppDialog open={!!info} title={info?.title ?? "形式の説明"} onClose={()=>setInfo(null)}><p className="p-4 text-sm leading-7">{info?.detail}</p></AppDialog>
  </>;
}

function FormatIcon({ id }: { id: string }): ReactNode {
  return <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{id === "auto" ? <><path d="m3 7 3-3 3 3M6 4v12m9 1 3 3 3-3m-3 3V8M6 16c0 3 12-11 12-8"/></> : id === "manual" ? <><path d="m16 3 5 5-12 12H4v-5L16 3Zm-2 2 5 5M4 4h5M4 8h2"/></> : <><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M2 21v-5a5 5 0 0 1 10 0v5m0 0v-5a5 5 0 0 1 10 0v5"/></>}</svg>;
}
