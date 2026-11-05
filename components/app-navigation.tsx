"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { isGuestModeEnabled } from "@/lib/guest-events";
import { appSection, isGuestAppPath } from "@/lib/app-navigation";
import { useScoreSaves } from "./score-save-provider";
import { AppDialog } from "./app-dialog";

const items = [
  { section: "matches", href: "/home", label: "試合", icon: "court" },
  { section: "ranking", href: "/ranking", label: "ランキング", icon: "ranking" },
  { section: "my", href: "/profile", label: "マイ", icon: "person" }
] as const;

function NavIcon({ kind }: { kind: typeof items[number]["icon"] }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "court" ? <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16M3 12h18M3 8h9M12 16h9" /></> : kind === "ranking" ? <><path d="M3 20h18M5 20V11h4v9M10 20V4h4v16M15 20v-6h4v6" /></> : <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>}
  </svg>;
}

export function AppNavigation() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { queue } = useScoreSaves();
  const [authenticated, setAuthenticated] = useState(false);
  const [guest, setGuest] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const navRef = useRef<HTMLElement>(null);
  const selected = pathname.startsWith("/groups/") && search.get("tab") === "stats" ? "ranking" : appSection(pathname);
  const visible = !!selected && (authenticated || (guest && isGuestAppPath(pathname)));

  useEffect(() => {
    let active = true;
    setNotice(""); setLoginOpen(false); setGuest(isGuestModeEnabled());
    const s = getSupabaseClient();
    if (!s) { setAuthenticated(false); return; }
    void s.auth.getSession().then(({ data }) => { if (active) setAuthenticated(!!data.session); });
    const { data } = s.auth.onAuthStateChange((_event, session) => { if (active) setAuthenticated(!!session); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [pathname]);

  useEffect(() => {
    if (!visible) return;
    document.body.classList.add("app-navigation-active");
    // 保存キューや既存ダイアログには手を加えず、実際の表示・フォーカスから重なりを避ける。
    const inspect = () => setFocused(!!document.querySelector('dialog[open], [aria-modal="true"], .fixed.inset-0.z-50')
      || document.body.style.overflow === "hidden"
      || !!document.activeElement?.matches('input, textarea, [contenteditable="true"]'));
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "class", "style", "aria-modal"] });
    const measure = () => {
      const nav = navRef.current;
      if (!nav || nav.offsetHeight === 0) return;
      const contentHeight = nav.getBoundingClientRect().height - parseFloat(getComputedStyle(nav).paddingBottom);
      document.body.style.setProperty("--app-navigation-height", `${Math.ceil(contentHeight)}px`);
    };
    const resize = new ResizeObserver(measure);
    if (navRef.current) resize.observe(navRef.current);
    let frame = 0;
    const focus = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(inspect); };
    document.addEventListener("focusin", focus); document.addEventListener("focusout", focus); inspect();
    measure();
    return () => {
      observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame);
      document.removeEventListener("focusin", focus); document.removeEventListener("focusout", focus);
      document.body.classList.remove("app-navigation-active"); document.body.style.removeProperty("--app-navigation-height");
    };
  }, [visible]);

  const navigate = (event: MouseEvent<HTMLAnchorElement>, section: string) => {
    if (queue.hasUnsaved(`${pathname}#`)) {
      event.preventDefault(); setNotice("未保存のスコアがあります。保存完了または再試行後に移動してください。"); return;
    }
    if (!authenticated && section !== "matches") { event.preventDefault(); setLoginOpen(true); }
  };
  if (!visible) return null;

  return <>
    <nav ref={navRef} aria-label="下部ナビゲーション" data-app-navigation className="app-bottom-navigation fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md border-t border-zinc-700 bg-card shadow-lg" style={{ display: focused ? "none" : undefined }}>
      {notice && <p role="alert" className="border-b border-amber-500 p-3 text-sm text-amber-300">{notice}</p>}
      <div className="grid grid-cols-3">{items.map(item => <Link key={item.section} href={item.href} aria-current={selected === item.section ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] ${selected === item.section ? "font-bold text-accent" : "text-zinc-400"}`} onClick={event => navigate(event, item.section)}><NavIcon kind={item.icon} /><span>{item.label}</span></Link>)}</div>
    </nav>
    <AppDialog open={loginOpen} title="ログイン・アカウント登録" onClose={() => setLoginOpen(false)}><div className="space-y-3 p-4"><p className="text-sm">ランキング・マイを利用するにはログインしてください。ゲストの一時データは、ここを閉じても残ります。</p><Link href="/login" className="block min-h-12 rounded-xl bg-accent p-3 text-center font-bold text-black">ログイン画面へ</Link><Link href="/login?mode=signup" className="block min-h-12 rounded-xl border border-zinc-600 p-3 text-center">アカウント登録</Link><button type="button" className="min-h-11 w-full text-sm underline" onClick={() => setLoginOpen(false)}>閉じる</button></div></AppDialog>
  </>;
}
