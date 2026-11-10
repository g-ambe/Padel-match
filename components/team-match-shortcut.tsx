"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

type Props = {
  enabled: boolean;
  buttons: [RefObject<HTMLButtonElement | null>, RefObject<HTMLButtonElement | null>];
  onClick: () => void;
};

// チーム戦専用。画面や得点入力の状態・保存キューには触れない。
export function TeamMatchShortcut({ enabled, buttons, onClick }: Props) {
  const [missing, setMissing] = useState(false);
  const [blocked, setBlocked] = useState(true);
  const [first, second] = buttons;
  useLayoutEffect(() => { setMissing(false); setBlocked(true); }, [enabled]);
  useEffect(() => {
    if (!enabled || !first.current || !second.current) return;
    let observer: IntersectionObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nav = document.querySelector<HTMLElement>("[data-app-navigation]");
    const measure = () => {
      observer?.disconnect();
      clearTimeout(timer);
      setMissing(false); // 初期計測・再計測中は表示しない。
      const seen = new Map<Element, boolean>();
      const bottom = nav?.getBoundingClientRect().height ?? 0;
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) seen.set(entry.target, entry.isIntersecting && entry.intersectionRatio >= 1);
        clearTimeout(timer);
        if (seen.size !== 2) return;
        if ([...seen.values()].every(Boolean)) setMissing(false);
        else timer = setTimeout(() => setMissing(true), 80);
      }, { threshold: [0, 1], rootMargin: `0px 0px -${bottom}px 0px` });
      if (first.current) observer.observe(first.current);
      if (second.current) observer.observe(second.current);
    };
    const inspect = () => setBlocked(
      !!document.querySelector('dialog[open], [aria-modal="true"]') || document.body.style.overflow === "hidden"
      || !!document.activeElement?.matches('input, textarea, select, [contenteditable="true"], [data-score-key] button')
    );
    const mutations = new MutationObserver(inspect);
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "style", "aria-modal"] });
    const resize = new ResizeObserver(measure);
    if (nav) resize.observe(nav);
    window.addEventListener("resize", measure);
    document.addEventListener("focusin", inspect);
    document.addEventListener("focusout", inspect);
    inspect(); measure();
    return () => {
      observer?.disconnect(); mutations.disconnect(); resize.disconnect(); clearTimeout(timer);
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", inspect); document.removeEventListener("focusout", inspect);
    };
  }, [enabled, first, second]);
  if (!enabled || !missing || blocked) return null;
  return <div className="team-match-shortcut pointer-events-none fixed inset-x-0 z-20 flex justify-center px-4"
    style={{ bottom: "calc(var(--app-navigation-height, 0px) + env(safe-area-inset-bottom, 0px) + 0.75rem)" }}>
    <button type="button" onClick={onClick} className="team-match-shortcut-button pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-zinc-600 bg-zinc-900 py-1 pl-1.5 pr-4 text-sm font-bold text-white shadow-lg">
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xl font-normal text-black">＋</span>試合を追加
    </button>
  </div>;
}
