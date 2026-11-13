"use client";
import { useRef, useState, type ReactNode } from "react";
import { AppDialog } from "./app-dialog";
import { TeamMatchCards } from "./team-match-cards";
import { ResultExpandButton } from "./event-result-rankings";

export function ResultMatchCard({ title, names, score, youtubeUrl, onVideoClick, videoEditor, children }: { title: string; names: [string[], string[]]; score: { a: number; b: number } | null; youtubeUrl?: string | null; onVideoClick?: () => void; videoEditor?: ReactNode; children?: ReactNode }) {
  return <article data-result-match className="space-y-1 rounded-xl bg-zinc-800 p-2 text-sm">
    <p className="text-xs font-bold text-zinc-400">{title}</p>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"><div className="min-w-0 rounded-lg p-1" style={{ background: "var(--friendly-pair-a-bg)", color: "var(--friendly-pair-a-text)" }}>{names[0].map((name, index) => <p key={index} className="truncate" title={name}>{name || "未設定"}</p>)}</div><p className="whitespace-nowrap text-lg font-bold" aria-label={score ? `スコア ${score.a} 対 ${score.b}` : "スコア未入力"}>{score ? `${score.a} - ${score.b}` : "—"}</p><div className="min-w-0 rounded-lg p-1" style={{ background: "var(--friendly-pair-b-bg)", color: "var(--friendly-pair-b-text)" }}>{names[1].map((name, index) => <p key={index} className="truncate" title={name}>{name || "未設定"}</p>)}</div></div>
    {children}
    {youtubeUrl && <a className="inline-flex min-h-11 items-center text-xs text-accent underline" href={youtubeUrl} target="_blank" rel="noreferrer" onClick={onVideoClick}>動画を見る</a>}
    {videoEditor}
  </article>;
}
export function EventResultHistory({ cards }: { cards: { id: string; content: ReactNode }[] }) {
  const [open, setOpen] = useState(false), normal = useRef<HTMLDivElement>(null), expanded = useRef<HTMLDivElement>(null), unused = useRef<HTMLDivElement>(null);
  return <section className="rounded-xl border border-zinc-700 bg-card p-2" data-result-history>
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-bold">過去の試合 · {cards.length}件</h2><ResultExpandButton label="過去の試合を拡大" onClick={() => setOpen(true)} /></div>
    {!cards.length && <p className="py-2 text-sm text-zinc-400">過去の試合はありません</p>}
    <div ref={normal} data-result-list="normal" className="max-h-[17rem] space-y-2 overflow-y-auto overscroll-contain" />
    <AppDialog open={open} title={`過去の試合 · ${cards.length}件`} wide onClose={() => setOpen(false)}><div ref={expanded} data-result-list="expanded" className="min-h-0 space-y-2 overflow-y-auto overscroll-contain p-3" /></AppDialog>
    <TeamMatchCards cards={cards.map(card => ({ ...card, id: `result:${card.id}` }))} latestCount={0} latestHost={unused} pastHost={normal} expandedHost={expanded} expanded={open} />
  </section>;
}
