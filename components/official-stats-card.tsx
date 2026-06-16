"use client";

import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import type { OfficialStats, OfficialStatsRow } from "@/lib/official-matches";

type SectionKey = "summary" | "opponents" | "players" | "pairs";

const sectionButtonClass = "flex min-h-12 w-full items-center rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-3 text-left text-sm font-bold text-zinc-100 shadow-sm shadow-black/20 active:bg-zinc-800";

function StatsSection({ title, isOpen, onToggle, children }: { title: string; isOpen: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <button type="button" className={sectionButtonClass} onClick={onToggle} aria-expanded={isOpen}>
        <span className="mr-2 text-accent">{isOpen ? "▼" : "◀"}</span>
        <span>{title}</span>
      </button>
      {isOpen && <div>{children}</div>}
    </section>
  );
}

export function OfficialStatsCard({ stats }: { stats: OfficialStats | null }) {
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({ summary: false, opponents: false, players: false, pairs: false });
  if (!stats) return null;

  const toggleSection = (key: SectionKey) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  const table = (rows: OfficialStatsRow[]) => rows.length === 0
    ? <p className="text-sm text-zinc-400">公式戦績はまだありません</p>
    : <div className="space-y-2">{rows.map((row) => <div key={row.name} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-bold">{row.name}</p><p className="text-zinc-300">{row.matches}試合 {row.wins}勝 {row.losses}敗 {row.draws}分 / 勝率 {row.winRate}%</p></div>)}</div>;

  const summaryContent = !stats.hasMatches
    ? <p className="text-sm text-zinc-400">公式戦績はまだありません</p>
    : stats.countedMatches === 0
      ? <p className="text-sm text-zinc-400">集計対象の試合結果がありません</p>
      : (
        <div className="rounded-xl bg-zinc-800 p-3 text-sm">
          <p className="font-bold">{stats.summary.name}</p>
          <p>所属グループ名: {stats.summary.groupName}</p>
          <p>対戦相手数: {stats.summary.opponentCount}</p>
          <p>{stats.summary.matches}試合 {stats.summary.wins}勝 {stats.summary.losses}敗 {stats.summary.draws}分 / 勝率 {stats.summary.winRate}%</p>
        </div>
      );

  return (
    <Card title="公式戦績">
      <div className="space-y-3">
        <StatsSection title="結果サマリ" isOpen={openSections.summary} onToggle={() => toggleSection("summary")}>
          {summaryContent}
        </StatsSection>
        <StatsSection title="対戦チーム別戦績" isOpen={openSections.opponents} onToggle={() => toggleSection("opponents")}>
          {table(stats.opponents)}
        </StatsSection>
        <StatsSection title="個人戦績" isOpen={openSections.players} onToggle={() => toggleSection("players")}>
          {table(stats.players)}
        </StatsSection>
        <StatsSection title="ペア戦績" isOpen={openSections.pairs} onToggle={() => toggleSection("pairs")}>
          {table(stats.pairs)}
        </StatsSection>
      </div>
    </Card>
  );
}
