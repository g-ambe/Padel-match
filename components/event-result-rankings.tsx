"use client";
import { useId, useMemo, useState, type ReactNode } from "react";
import { AppDialog } from "./app-dialog";
import { compactRankingGroups, groupResultRanking, rankingValue, type RankingMetric, type ResultRankingRow } from "@/lib/result-ranking";

export function ResultExpandButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" aria-label={label} title={label} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-600" onClick={onClick}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" /></svg></button>;
}
const tabs = [["wins", "勝利数"], ["winRate", "勝率"], ["diff", "得失G差"]] as const;
export function EventResultRankings({ wins, winRate, diff, details }: { wins: readonly ResultRankingRow[]; winRate: readonly ResultRankingRow[]; diff: readonly ResultRankingRow[]; details?: ReactNode }) {
  const rankingId = useId();
  const [expanded, setExpanded] = useState(true), [open, setOpen] = useState(false), [metric, setMetric] = useState<RankingMetric>("wins");
  const groups = useMemo(() => groupResultRanking({ wins, winRate, diff }[metric], metric), [wins, winRate, diff, metric]);
  const winGroups = useMemo(() => groupResultRanking(wins, "wins"), [wins]);
  return <section className="rounded-xl border border-zinc-700 bg-card p-2" data-result-rankings>
    <div className="flex items-center gap-2"><button type="button" aria-expanded={expanded} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm font-bold" onClick={() => setExpanded(value => !value)}><span aria-hidden="true" className="event-disclosure-icon">{expanded ? "▼" : "▶"}</span>勝利数ランキング</button><ResultExpandButton label="ランキングを拡大" onClick={() => { setMetric("wins"); setOpen(true); }} /></div>
    {expanded && <>{winGroups.length ? <ol className="text-sm">{compactRankingGroups(winGroups).map(group => <li key={group.rank} className="flex min-h-9 items-center gap-2 border-t border-zinc-700 py-1"><span className="w-14 shrink-0 text-xs text-zinc-400">{group === winGroups.at(-1) && group.rank > 2 ? "最下位" : `${group.rank}位`}</span><span className="min-w-0 flex-1 truncate" title={group.rows.map(row => row.name).join("、")}>{group.rows.map(row => row.name).join("、")}</span><strong className="shrink-0 text-accent">{group.value}勝</strong></li>)}</ol> : <p className="py-2 text-sm text-zinc-400">試合結果がありません</p>}</>}
    <AppDialog open={open} title="ランキング詳細" wide onClose={() => setOpen(false)}>
      <div role="tablist" aria-label="ランキング指標" className="grid shrink-0 grid-cols-3 border-b border-zinc-700 px-3">{tabs.map(([value, label], index) => <button key={value} id={`${rankingId}-${value}`} role="tab" aria-selected={metric === value} aria-controls={`${rankingId}-panel`} tabIndex={metric === value ? 0 : -1} className={`min-h-11 border-b-2 px-1 text-sm font-bold ${metric === value ? "border-accent text-accent" : "border-transparent"}`} onClick={() => setMetric(value)} onKeyDown={event => { const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null; if (next !== null) { event.preventDefault(); setMetric(tabs[next][0]); document.getElementById(`${rankingId}-${tabs[next][0]}`)?.focus(); } }}>{label}</button>)}</div>
      <div id={`${rankingId}-panel`} role="tabpanel" aria-labelledby={`${rankingId}-${metric}`} className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-3">
        {!groups.length && <p className="text-sm text-zinc-400">試合結果がありません</p>}
        <ol className="space-y-2">{groups.map(group => <li key={group.rank} className="rounded-xl bg-zinc-800 p-2 text-sm"><div className="flex justify-between gap-2 font-bold"><span>{group.rank}位</span><span className="text-accent">{rankingValue(metric, group.value)}</span></div><p className="break-words py-1">{group.rows.map(row => row.name).join("、")}</p><details><summary className="min-h-9 cursor-pointer text-xs text-zinc-400">戦績内訳</summary>{group.rows.map((row, index) => <p key={index} className="break-words py-1 text-xs text-zinc-300">{row.name}：{row.wins}勝{row.losses}敗{row.draws}分／{row.played ?? row.matches ?? 0}試合／得点{row.scored}・失点{row.conceded}／勝点{row.matchPoints ?? row.points ?? row.wins * 3 + row.draws}／勝率{row.winRate}%／得失G差{row.diff}</p>)}</details></li>)}</ol>
        {details}
      </div>
    </AppDialog>
  </section>;
}
