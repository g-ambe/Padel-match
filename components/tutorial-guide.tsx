"use client";
import { useEffect, useState, type RefObject } from "react";
import styles from "./tutorial-demo.module.css";

// Lucide mouse-pointer-2: https://lucide.dev/icons/mouse-pointer-2
const pointerLicense = `ISC License

Copyright (c) 2026 Lucide Icons and Contributors
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.
THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

// デモ内の案内のみ。操作対象は覆わず、スクロール後も同じ対象に追従する。
export function TutorialGuide({ root, scroller, target, label, id }: {
  root: RefObject<HTMLDivElement | null>; scroller: RefObject<HTMLDivElement | null>;
  target: string | null; label: string; id: string;
}) {
  const [point, setPoint] = useState<{ target: string; top: number; left: number; fallback?: boolean; visible?: boolean } | null>(null);
  useEffect(() => {
    const container = root.current, content = scroller.current;
    const control = container?.querySelector<HTMLElement>('[data-tutorial-current="true"]');
    if (!container || !content || !control || !target) { setPoint(null); return; }
    let frame = 0, fallback = false;
    const measure = () => {
      const box = control.getBoundingClientRect(), bounds = container.getBoundingClientRect(), area = content.getBoundingClientRect();
      const top = Math.max(area.top, 0), bottom = Math.min(area.bottom, window.visualViewport?.height ?? innerHeight);
      if (box.bottom < top || box.top > bottom) { setPoint({ target, top: 0, left: 0, fallback, visible: false }); return; }
      const left = Math.max(12, Math.min(box.left - bounds.left, bounds.width - 300)), width = Math.min(288, bounds.width - 24), height = 36;
      // Tips・数値キー・入力欄も覆わない。空きがなければ下部の独立した案内行へ。
      const obstacles = Array.from(content.querySelectorAll<HTMLElement>('button,input,select,textarea,p,h3,h4,table,[data-tutorial-tip]')).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
      const candidates = [box.top - height - 4, box.bottom + 4, ...obstacles.flatMap(r => [r.top - height - 4, r.bottom + 4])];
      const fits = (y: number) => y >= top + 2 && y + height <= bottom - 2 && !obstacles.some(r => bounds.left + left < r.right + 2 && bounds.left + left + width > r.left - 2 && y < r.bottom + 2 && y + height > r.top - 2);
      const position = candidates.filter(fits).sort((a, b) => Math.abs(a - box.top) - Math.abs(b - box.top))[0];
      if (position === undefined) fallback = true;
      setPoint({ target, top: fallback ? 0 : position - bounds.top, left: fallback ? 0 : left, fallback });
      if (fallback && (box.top < top || box.bottom > bottom)) control.scrollIntoView({ block: "nearest", behavior: "auto" });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const box = control.getBoundingClientRect(), area = content.getBoundingClientRect();
    if (box.top < Math.max(area.top, 0) + 42 || box.bottom > Math.min(area.bottom, innerHeight) - 12) {
      control.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    schedule();
    const mutations = new MutationObserver(schedule); mutations.observe(content, { childList: true, subtree: true, characterData: true });
    const observer = new ResizeObserver(schedule); observer.observe(container); observer.observe(content); observer.observe(control);
    container.addEventListener("scroll", schedule, true); window.addEventListener("resize", schedule); window.visualViewport?.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); mutations.disconnect(); observer.disconnect(); container.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("resize", schedule); };
  }, [root, scroller, target, label]);
  return <p id={id} role="status" className={styles.guide} style={{ position: point?.fallback ? "relative" : "absolute", flexShrink: 0, margin: point?.fallback ? "4px 12px 8px" : 0, top: point?.top, left: point?.left, visibility: point?.target === target && target && point.visible !== false ? "visible" : "hidden" }}><svg data-lucide="mouse-pointer-2" className={styles.pointer} aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><metadata>{pointerLicense}</metadata><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" /></svg>{label}</p>;
}
