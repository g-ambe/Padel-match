"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

let locks = 0;
let restoreScroll: (() => void) | null = null;
function lockScroll() {
  if (locks++ === 0) {
    const body = document.body, root = document.documentElement, x = scrollX, y = scrollY;
    const before = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow, rootOverflow: root.style.overflow };
    Object.assign(body.style, { position: "fixed", top: `${-y}px`, left: `${-x}px`, width: "100%", overflow: "hidden" }); root.style.overflow = "hidden";
    restoreScroll = () => {
      Object.assign(body.style, { position: before.position, top: before.top, left: before.left, width: before.width, overflow: before.overflow }); root.style.overflow = before.rootOverflow;
      const behavior = root.style.scrollBehavior; root.style.scrollBehavior = "auto"; window.scrollTo(x, y); root.style.scrollBehavior = behavior;
    };
  }
  return () => { if (--locks === 0) { restoreScroll?.(); restoreScroll = null; } };
}

export function AppDialog({ open, title, onClose, busy = false, wide = false, children }: { open: boolean; title: string; onClose: () => void; busy?: boolean; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId(), busyRef = useRef(busy);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  busyRef.current = busy;
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null, unlock = lockScroll();
    dialog.showModal();
    dialog.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => { dialog.close(); unlock(); if (previous?.isConnected) previous.focus({ preventScroll: true }); else document.querySelector<HTMLElement>('dialog[open] button:not(:disabled)')?.focus({preventScroll:true}); };
  }, [open]);
  if (!open) return null;
  return <dialog ref={ref} aria-labelledby={id} aria-modal="true" className={`app-dialog m-auto overflow-hidden rounded-2xl border border-zinc-700 bg-card p-0 text-zinc-100 shadow-xl backdrop:bg-black/70 ${wide ? "w-[calc(100%_-_1rem)] max-w-2xl" : "w-[calc(100%_-_2rem)] max-w-sm"}`}
    onCancel={e => { e.preventDefault(); e.stopPropagation(); if (!busyRef.current) onClose(); }}
    onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget && !busyRef.current) onClose(); }}
    onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key !== "Tab") return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
      if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0]?.focus(); }
    }}>
    <div className={`flex flex-col ${wide ? "h-[92dvh] max-h-[calc(100dvh_-_1rem)]" : "max-h-[calc(100dvh_-_2rem)]"}`}>
      {wide && <div data-dialog-handle className="flex min-h-6 shrink-0 touch-none items-center justify-center md:hidden" aria-hidden="true"
        onTouchStart={e => { const point=e.touches[0]; dragStart.current=e.touches.length===1 ? {x:point.clientX,y:point.clientY}:null; }}
        onTouchEnd={e => { const start=dragStart.current, point=e.changedTouches[0];dragStart.current=null;if(start&&point&&point.clientY-start.y>80&&Math.abs(point.clientX-start.x)<50&&!busyRef.current)onClose(); }}
        onTouchCancel={() => {dragStart.current=null;}}><span className="h-1 w-10 rounded-full bg-zinc-500" /></div>}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-700 p-4"><h2 id={id} className="min-w-0 break-words text-lg font-bold">{title}</h2><button type="button" aria-label="閉じる" disabled={busy} className="min-h-11 min-w-11 shrink-0 rounded-xl border border-zinc-600 disabled:opacity-40" onClick={onClose}>×</button></div>
      {children}
    </div>
  </dialog>;
}
