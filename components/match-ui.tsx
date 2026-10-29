"use client";

import { useState, type ReactNode } from "react";
import { AppDialog } from "@/components/app-dialog";

export function GuestName({ name, guest = false, compact = false }: { name: string; guest?: boolean; compact?: boolean }) {
  return <span className={`inline-flex min-w-0 max-w-full items-center gap-1 align-middle ${compact ? "flex-nowrap" : "flex-wrap"}`}><span title={compact ? name : undefined} className={`min-w-0 ${compact ? "truncate" : "break-all"}`}>{name}</span>{guest && <span className="app-badge badge-guest">ゲスト</span>}</span>;
}

export function ResultBadge({ result, team }: { result?: "A" | "B" | "draw" | null; team: "A" | "B" }) {
  if (!result) return null;
  const label = result === "draw" ? "DRAW" : result === team ? "WIN" : "LOSE";
  return <span className={`app-badge result-${label.toLowerCase()}`} aria-label={label === "WIN" ? "勝利" : label === "LOSE" ? "敗北" : "引き分け"}>{label}</span>;
}

export function MatchHistoryList({ children, title = "全試合履歴", heading }: { children: ReactNode; title?: string; heading?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <div className="mb-2 flex items-center justify-between gap-2"><div className="min-w-0">{heading && <p className="text-sm font-bold">{heading}</p>}<p className="text-xs text-zinc-400">一覧内をスクロールして確認</p></div><button type="button" aria-label="全試合履歴を拡大" title="全試合履歴を拡大" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-600" onClick={() => setOpen(true)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" /></svg></button></div>
    <div data-match-list="normal" className="max-h-[min(25rem,50dvh)] space-y-3 overflow-y-auto overscroll-contain pr-1">{children}</div>
    <AppDialog open={open} title={title} onClose={() => setOpen(false)} wide><div data-match-list="all" className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4">{children}</div></AppDialog>
  </>;
}

export function YoutubeDisclosure({ registered = false, children }: { registered?: boolean; children: ReactNode }) {
  return <details className="mt-2 rounded-xl border border-zinc-700"><summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-semibold">{registered ? "YouTube登録済み" : "＋ YouTubeを追加"}</summary><div className="space-y-2 px-3 pb-3">{children}</div></details>;
}
