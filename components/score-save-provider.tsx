"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createScoreSaveQueue } from "@/lib/score-save-queue";

const ScoreSaves = createContext<ReturnType<typeof createScoreSaveQueue> | null>(null);
export function ScoreSaveProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(createScoreSaveQueue);
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const pathname = usePathname();
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!queue.hasUnsaved()) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [queue]);
  const otherPages = [...new Set(Object.keys(snapshot).filter(key => !key.startsWith(`${pathname}#`)).map(key => key.split("#")[0]))];
  return <ScoreSaves.Provider value={queue}>
    {children}
    {otherPages.length > 0 && <aside role="status" className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md space-y-2 rounded-xl border border-amber-500 bg-card p-3 text-sm shadow-xl">
      <p>別のイベントに保存中、または未保存のスコアがあります。</p>
      {otherPages.map(path => <Link key={path} href={path} className="block min-h-11 rounded border border-zinc-500 px-3 py-3 text-center underline">入力画面へ戻る</Link>)}
    </aside>}
  </ScoreSaves.Provider>;
}

export function useScoreSaves() {
  const queue = useContext(ScoreSaves);
  if (!queue) throw new Error("スコア保存の準備ができていません");
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  return { queue, snapshot };
}
