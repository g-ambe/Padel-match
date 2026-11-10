"use client";
import { useState } from "react";
import { manualTopics, type DemoStep } from "@/lib/tutorial-content";
import { useTutorial } from "./tutorial-provider";

export function HelpManual({ onExperience }: { onExperience?: (steps: readonly DemoStep[]) => void }) {
  const tutorial = useTutorial(), [topic, setTopic] = useState<string | null>(null);
  const selected = manualTopics.find(t => t.id === topic);
  const experience = (steps: readonly DemoStep[]) => { if (onExperience) onExperience(steps); else void tutorial.start(steps); };
  return <div className="space-y-3">
    <p className="text-sm leading-6">知りたい項目を選ぶと、説明と安全な操作体験を利用できます。</p>
    <button className="min-h-11 w-full rounded-xl bg-accent p-3 text-sm font-bold text-black" onClick={() => experience(manualTopics[0].steps)}>基本操作を最初から体験</button>
    {selected ? <section className="space-y-3"><button className="min-h-11 text-sm underline" onClick={() => setTopic(null)}>項目一覧へ戻る</button><h3 className="font-bold">{selected.title}</h3>{selected.text.map(text => <p key={text} className="text-sm leading-7">{text}</p>)}<button className="min-h-11 w-full rounded-xl border border-accent p-3 text-sm text-accent" onClick={() => experience(selected.steps)}>この項目の操作を体験する</button></section>
      : manualTopics.map(t => <section key={t.id} className="space-y-2 rounded-xl border border-zinc-700 p-3"><h3 className="text-sm font-bold">{t.title}</h3><div className="grid grid-cols-2 gap-2 text-xs"><button className="min-h-11 rounded-lg bg-zinc-800 px-2" onClick={() => setTopic(t.id)}>説明を見る</button><button className="min-h-11 rounded-lg border border-zinc-600 px-2" onClick={() => experience(t.steps)}>操作を体験する</button></div></section>)}
    {tutorial.error && <p role="status" className="text-xs text-amber-300">{tutorial.error}</p>}
  </div>;
}
