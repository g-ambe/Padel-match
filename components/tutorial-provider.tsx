"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { isTutorialStatus, savePreference, type TutorialStatus } from "@/lib/user-preferences";
import { tutorialSteps, type DemoStep } from "@/lib/tutorial-content";
import { useSessionAccount } from "./use-session-account";
import { AppDialog } from "./app-dialog";
import { TutorialDemo } from "./tutorial-demo";

type TutorialContextValue = { start: (steps?: readonly DemoStep[]) => Promise<void>; begin: () => Promise<void>; complete: (full: boolean) => Promise<void>; error: string };
const Context = createContext<TutorialContextValue | null>(null);
export const useTutorial = () => { const value = useContext(Context); if (!value) throw new Error("TutorialProvider is required"); return value; };

export function TutorialProvider({ children }: { children: ReactNode }) {
  const account = useSessionAccount(), pathname = usePathname();
  const [status, setStatus] = useState<TutorialStatus | null>(null), [loaded, setLoaded] = useState<string | null>(null);
  const [view, setView] = useState<"welcome" | "demo" | null>(null), [steps, setSteps] = useState<readonly DemoStep[]>(tutorialSteps);
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const demoOwner = useRef<string | null>(null);
  const current = useRef(account.id), shown = useRef(new Set<string>()), lock = useRef(false);
  current.current = account.id;
  useEffect(() => {
    let active = true;
    setView(null); setStatus(null); setLoaded(null); setError("");
    if (!account.ready || !account.id) return;
    const owner = account.id, db = getSupabaseClient();
    if (!db) return;
    void (async () => {
      try {
        const result = await db.from("user_preferences").select("tutorial_status").eq("auth_user_id", owner).maybeSingle();
        if (result.error) throw result.error;
        if (active && current.current === owner) setStatus(!result.data ? "unseen" : isTutorialStatus(result.data.tutorial_status) ? result.data.tutorial_status : null);
      } catch { /* 取得失敗をunseenとして扱わず、この利用中は自動表示しない。 */ }
      finally { if (active && current.current === owner) setLoaded(owner); }
    })();
    return () => { active = false; };
  }, [account.ready, account.id]);

  useEffect(() => {
    if (pathname !== "/home" || !account.id || loaded !== account.id || status !== "unseen" || shown.current.has(account.id)) return;
    const owner = account.id;
    let frame = 0;
    const inspect = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const modal = Array.from(document.querySelectorAll<HTMLElement>('dialog[open], [aria-modal="true"]')).some(el => el.getClientRects().length > 0);
        if (!modal && document.body.style.overflow !== "hidden" && current.current === owner && !shown.current.has(owner)) { shown.current.add(owner); setView("welcome"); }
      });
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "aria-modal", "style"] });
    inspect();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [pathname, account.id, loaded, status]);

  const save = async (value: TutorialStatus) => {
    const owner = current.current, db = getSupabaseClient();
    if (!owner || !db) return;
    try { await savePreference(db, owner, "tutorial_status", value); if (current.current === owner) { setStatus(value); setError(""); } }
    catch { if (current.current === owner) setError("案内の状態を保存できませんでした。この利用中は再表示しません。再体験はヘルプから利用できます。"); }
  };
  const begin = async () => {
    demoOwner.current = current.current;
    if (current.current) shown.current.add(current.current);
    if (status === "unseen" && loaded === current.current) await save("dismissed");
  };
  const complete = async (full: boolean) => { if (full && demoOwner.current === current.current) await save("completed"); };
  const start = async (ids: readonly DemoStep[] = tutorialSteps) => { const owner = current.current; await begin(); if (current.current === owner) { setSteps(ids); setView("demo"); } };
  const welcome = async (experience: boolean) => {
    if (lock.current) return;
    lock.current = true; setSaving(true);
    const owner = current.current;
    try { await begin(); if (current.current === owner) { setSteps(tutorialSteps); setView(experience ? "demo" : null); } }
    finally { lock.current = false; setSaving(false); }
  };
  return <Context.Provider value={{ start, begin, complete, error }}>{children}
    <AppDialog open={view !== null} title={view === "welcome" ? "パデルアプリへようこそ！" : "基本操作を体験"} busy={saving} onClose={() => { if (view === "welcome") void welcome(false); else setView(null); }}>
      {view === "welcome" ? <div className="space-y-4 overflow-y-auto p-4"><p className="text-sm leading-7">グループ作成から試合結果の記録まで、基本操作を約1分で体験できます。</p><button disabled={saving} className="min-h-11 w-full rounded-xl bg-accent p-3 font-bold text-black" onClick={() => void welcome(true)}>体験してみる</button><button disabled={saving} className="min-h-11 w-full rounded-xl border border-zinc-600 p-3" onClick={() => void welcome(false)}>今はしない</button></div>
        : <TutorialDemo key={steps.join()} steps={steps} notice={error} onClose={() => setView(null)} onComplete={() => { if (lock.current) return; lock.current = true; setSaving(true); void complete(steps.length === 8).finally(() => { setView(null); setSaving(false); lock.current = false; }); }} />}
    </AppDialog>
    {error && view === null && <aside role="status" className="fixed inset-x-4 top-16 z-40 mx-auto max-w-sm rounded-xl border border-amber-600 bg-card p-3 text-xs">{error}<button className="ml-2 min-h-11 underline" onClick={() => setError("")}>閉じる</button></aside>}
  </Context.Provider>;
}
