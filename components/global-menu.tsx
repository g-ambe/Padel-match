"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SettingsContent } from "./settings-content";
import { NotificationsContent } from "./notifications-content";
import { AboutContent } from "./about-content";
import { HelpManual } from "./help-manual";
import { TutorialDemo, type DemoDestination } from "./tutorial-demo";
import { useTutorial } from "./tutorial-provider";
import { useSessionAccount } from "./use-session-account";
import { tutorialSteps, type DemoStep, type ExperienceKind } from "@/lib/tutorial-content";
import { padelBoardHref } from "@/lib/padel-board";
import { useScoreSaves } from "./score-save-provider";
import { getSupabaseClient } from "@/lib/supabase";
import styles from "./global-menu.module.css";

// Lucide menu: https://lucide.dev/icons/menu (SVG内にライセンスを保持する)。
const menuIconLicense = `ISC License
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

export function GlobalMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const { queue } = useScoreSaves();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const account = useSessionAccount(), tutorial = useTutorial();
  const hasSession = account.ready && !!account.id;
  const [panel, setPanel] = useState("menu");
  const [practiceKind, setPracticeKind] = useState<ExperienceKind>("topic");
  const [practice, setPractice] = useState<readonly DemoStep[]>(tutorialSteps);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const busyRef = useRef(false), contentRef = useRef<HTMLElement>(null), backRef = useRef<HTMLButtonElement>(null);
  const [superOwner, setSuperOwner] = useState<string | null>(null);
  const isSuperUser = !!account.id && superOwner === account.id;

  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => { if (!busyRef.current) setOpen(false); };

  const moveTo = (path: string) => { closeMenu(); router.push(path); };
  useEffect(()=>{if(!open){setPanel("menu");setError("");}else{contentRef.current?.scrollTo(0,0);if(panel!=="menu")backRef.current?.focus({preventScroll:true});}},[panel,open]);

  useEffect(() => {
    let active=true;
    setSuperOwner(null);setOpen(false);setUnreadCount(0);
    const supabase=getSupabaseClient(), owner=account.id;
    if(supabase&&owner)void supabase.auth.getUser().then(async({data})=>{
      if(!active||data.user?.id!==owner)return;
      if(data.user.email?.toLowerCase()==="testuser01@example.com"){setSuperOwner(owner);return;}
      const {data:admin}=await supabase.from("app_admins").select("id").eq("profile_id",owner).eq("is_active",true).maybeSingle();
      if(active)setSuperOwner(admin?owner:null);
    });
    return()=>{active=false;};
  },[account.id]);

  useEffect(() => {
    let active=true;
    const loadUnread = async () => {
      if(open&&panel==="notifications")return;
      if (!hasSession) {
        setUnreadCount(0);
        return;
      }
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false);
      if(active)setUnreadCount(count ?? 0);
    };
    void loadUnread();
    return()=>{active=false;};
  }, [pathname, open, hasSession, account.id, panel]);

  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const root = document.documentElement;
    const x = window.scrollX, y = window.scrollY;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow, paddingRight: body.style.paddingRight, rootOverflow: root.style.overflow };
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    if (scrollbarWidth > 0) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbarWidth}px`;
    Object.assign(body.style, { position: "fixed", top: `${-y}px`, left: `${-x}px`, width: "100%", overflow: "hidden" });
    root.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
      if (event.key !== "Tab") return;
      const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? []).filter(button => button.offsetParent !== null);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!panelRef.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      Object.assign(body.style, { position: previous.position, top: previous.top, left: previous.left, width: previous.width, overflow: previous.overflow, paddingRight: previous.paddingRight });
      root.style.overflow = previous.rootOverflow;
      const behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(x, y);
      root.style.scrollBehavior = behavior;
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  const logout = async () => {
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError("");
    try { const supabase=getSupabaseClient();if(supabase){const result=await supabase.auth.signOut();if(result.error)throw result.error;}setOpen(false);router.replace("/");router.refresh(); }
    catch{setError("ログアウトできませんでした。もう一度お試しください。");}
    finally{busyRef.current=false;setBusy(false);}
  };
  const experience = async (steps: readonly DemoStep[], kind: ExperienceKind) => {
    if(busyRef.current)return;
    const owner=account.id;
    busyRef.current=true;setBusy(true);
    try{if(kind==="full")await tutorial.begin();if(owner===account.id){setPractice(steps);setPracticeKind(kind);setPanel("practice");}}
    finally{busyRef.current=false;setBusy(false);}
  };
  const finish = async (destination?: DemoDestination) => {
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);
    try{await tutorial.complete(practiceKind==="full");setPanel("help");if(practiceKind==="full"&&destination){setOpen(false);router.push(destination==="create"?"/events/new":"/home");}}
    finally{busyRef.current=false;setBusy(false);}
  };
  const openBoard = () => {
    if (queue.hasUnsaved(`${pathname}#`)) { setError("未保存のスコアがあります。保存完了または再試行後に移動してください。"); return; }
    if (pathname === "/padel-board") closeMenu(); else moveTo(padelBoardHref(pathname + window.location.search));
  };
  const titles:Record<string,string>={menu:"メニュー",settings:"アカウント・アプリ設定",help:"使い方・ヘルプ",about:"アプリについて",notifications:"通知",admin:"スーパーユーザー管理",logout:"ログアウト",practice:"操作を体験"};

  if (!hasSession || pathname.startsWith("/share/")) return null;

  return (
    <>
      <button
        ref={triggerRef}
        aria-label="メニュー"
        aria-expanded={open}
        aria-controls="global-menu-panel"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
      >
        <svg data-lucide="menu" aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><metadata>{menuIconLicense}</metadata><path d="M4 5h16" /><path d="M4 12h16" /><path d="M4 19h16" /></svg>{unreadCount > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-black">{unreadCount}</span>}
      </button>

      {open && <button className="fixed inset-0 z-40 touch-none bg-black/60" aria-label="閉じる" onClick={closeMenu} />}

      <aside
        ref={panelRef}
        id="global-menu-panel"
        role="dialog"
        aria-modal={open ? true : undefined}
        aria-labelledby="global-menu-title"
        aria-hidden={!open}
        inert={!open}
        className={`fixed right-0 top-0 z-50 flex h-[100dvh] max-h-[100dvh] ${panel==="menu"?"w-72":"w-full max-w-md"} flex-col overflow-hidden bg-zinc-900 text-zinc-100 shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-700 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0">{panel!=="menu"&&<button ref={backRef} disabled={busy} className="min-h-11 text-sm underline" onClick={()=>setPanel("menu")}>戻る</button>}<p id="global-menu-title" className="break-words font-semibold">{titles[panel]}</p></div>
          <button ref={closeRef} disabled={busy} aria-label="閉じる" className="min-h-11 min-w-11 shrink-0 rounded-lg bg-zinc-800 px-3 py-2 text-lg leading-none" onClick={closeMenu}>×</button>
        </div>
        <nav ref={contentRef} aria-label={titles[panel]} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" style={{ WebkitOverflowScrolling: "touch" }}>
          {panel==="menu"?<>{[["settings","アカウント・アプリ設定"],["help","使い方・ヘルプ"],["board","パデルボード"],["about","アプリについて"],["notifications",`通知${unreadCount>0?` (${unreadCount})`:""}`],...(isSuperUser?[["admin","スーパーユーザー管理"]]:[]),["logout","ログアウト"]].map(([key,label])=><button key={key} data-menu-action={key==="logout"?"logout":undefined} className={`min-h-12 w-full rounded-lg px-3 py-3 text-left ${key==="logout"?"bg-red-600/80":"bg-zinc-800"}`} onClick={()=>key==="board"?openBoard():setPanel(key)}>{label}</button>)}</>:
            panel==="settings"?<SettingsContent onNavigate={closeMenu} onAbout={()=>setPanel("about")}/>:
            panel==="help"?<HelpManual onExperience={(steps,kind)=>void experience(steps,kind)}/>:
            panel==="about"?<AboutContent onNavigate={closeMenu} onHelp={()=>setPanel("help")}/>:
            panel==="notifications"?<NotificationsContent onNavigate={closeMenu} onUnreadChange={setUnreadCount}/>:
            panel==="admin"&&isSuperUser?<div className="space-y-3 text-sm"><p>グループ・開催の管理、削除済みデータの確認は、既存の管理画面から操作できます。</p><button className="min-h-11 w-full rounded-xl border border-zinc-600 p-3" onClick={()=>moveTo("/super-admin")}>管理画面を開く</button></div>:
            panel==="logout"?<div className="space-y-3 text-sm"><p>ログアウトしますか？</p><button disabled={busy} className="min-h-11 w-full rounded-xl bg-red-600 p-3 font-bold text-white" onClick={()=>void logout()}>ログアウトする</button><button disabled={busy} className="min-h-11 w-full rounded-xl border border-zinc-600 p-3" onClick={()=>setPanel("menu")}>戻る</button></div>:
            panel==="practice"?<TutorialDemo key={`${practiceKind}:${practice.join()}`} steps={practice} kind={practiceKind} notice={tutorial.error} onClose={()=>setPanel("help")} onComplete={destination=>void finish(destination)}/>:null}
          {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}

        </nav>
      </aside>
    </>
  );
}
