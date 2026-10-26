"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";

export function SharedPageHeader({ title }: { title: string }) {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  const titleId = useId();

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) { setHasSession(false); return; }
    // 初期セッションとログイン／ログアウトの変化を同じ通知で確認する。
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
      if (session) setOpen(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    const body = document.body;
    const root = document.documentElement;
    const x = window.scrollX, y = window.scrollY;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow, rootOverflow: root.style.overflow };
    Object.assign(body.style, { position: "fixed", top: `${-y}px`, left: `${-x}px`, width: "100%", overflow: "hidden" });
    root.style.overflow = "hidden";
    return () => {
      dialog.close();
      Object.assign(body.style, { position: previous.position, top: previous.top, left: previous.left, width: previous.width, overflow: previous.overflow });
      root.style.overflow = previous.rootOverflow;
      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(x, y);
      root.style.scrollBehavior = behavior;
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  return <header className="flex items-center justify-between gap-3">
    <h1 className="min-w-0 text-xl font-bold">{title}</h1>
    {hasSession === false && <>
      <button ref={triggerRef} type="button" className="min-h-11 max-w-[40%] shrink-0 px-1 py-2 text-right text-xs text-zinc-400 underline underline-offset-4" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} onClick={() => setOpen(true)}>ログイン・アカウント登録はこちら</button>
      <dialog ref={dialogRef} id={dialogId} aria-labelledby={titleId} className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto rounded-2xl border border-zinc-700 bg-card p-5 text-zinc-100 shadow-xl backdrop:bg-black/70" onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
        <h2 id={titleId} className="text-lg font-bold">ログイン・新規アカウント作成</h2>
        <p className="mt-3 text-sm text-zinc-300">ログイン、または新規登録しますか？</p>
        <div className="mt-5 grid gap-3">
          <Link href="/login" className="rounded-xl bg-accent px-4 py-3 text-center text-sm font-bold text-black" onClick={() => setOpen(false)}>ログイン</Link>
          <Link href="/login?mode=signup" className="rounded-xl border border-zinc-500 px-4 py-3 text-center text-sm font-bold" onClick={() => setOpen(false)}>新規アカウント作成</Link>
          <button type="button" className="rounded-xl px-4 py-3 text-sm text-zinc-400" onClick={() => setOpen(false)}>閉じる</button>
        </div>
      </dialog>
    </>}
  </header>;
}
