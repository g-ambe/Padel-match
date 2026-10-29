"use client";

import { useState, type ReactNode } from "react";
import { AppDialog } from "@/components/app-dialog";

export function GuestName({ name, guest = false }: { name: string; guest?: boolean }) {
  return <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 align-middle"><span className="min-w-0 break-all">{name}</span>{guest && <span className="app-badge badge-guest">ゲスト</span>}</span>;
}

export function ResultBadge({ result, team }: { result?: "A" | "B" | "draw" | null; team: "A" | "B" }) {
  if (!result) return null;
  const label = result === "draw" ? "DRAW" : result === team ? "WIN" : "LOSE";
  return <span className={`app-badge result-${label.toLowerCase()}`} aria-label={label === "WIN" ? "勝利" : label === "LOSE" ? "敗北" : "引き分け"}>{label}</span>;
}

export function MatchHistoryList({ children, title = "全試合履歴" }: { children: ReactNode; title?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <div data-match-list="normal" className="max-h-[min(40rem,75dvh)] space-y-3 overflow-y-auto overscroll-contain pr-1">{children}</div>
    <button type="button" className="mt-3 min-h-11 w-full rounded-xl border border-zinc-600 py-2 text-sm" onClick={() => setOpen(true)}>すべて表示</button>
    <AppDialog open={open} title={title} onClose={() => setOpen(false)} wide><div data-match-list="all" className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4">{children}</div></AppDialog>
  </>;
}

export function YoutubeDisclosure({ registered = false, children }: { registered?: boolean; children: ReactNode }) {
  return <details className="mt-2 rounded-xl border border-zinc-700"><summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-semibold">{registered ? "YouTube登録済み" : "＋ YouTubeを追加"}</summary><div className="space-y-2 px-3 pb-3">{children}</div></details>;
}
