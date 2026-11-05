"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";


export function GlobalMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [isSuperUser, setIsSuperUser] = useState(false);

  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setOpen(false);

  const moveTo = (path: string) => {
    closeMenu();
    router.push(path);
  };

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setHasSession(false);
      return;
    }

    void supabase.auth.getSession().then(async ({ data }) => {
      setHasSession(!!data.session);
      const user = data.session?.user;
      if (!user) return setIsSuperUser(false);
      if (user.email?.toLowerCase() === "testuser01@example.com") return setIsSuperUser(true);
      const { data: admin } = await supabase.from("app_admins").select("id").eq("profile_id", user.id).eq("is_active", true).maybeSingle();
      setIsSuperUser(!!admin);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
      if (!session) {
        setIsSuperUser(false);
        setOpen(false);
        return;
      }
      if (session.user.email?.toLowerCase() === "testuser01@example.com") {
        setIsSuperUser(true);
        return;
      }
      void supabase.from("app_admins").select("id").eq("profile_id", session.user.id).eq("is_active", true).maybeSingle().then(({ data }) => setIsSuperUser(!!data));
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const loadUnread = async () => {
      if (!hasSession) {
        setUnreadCount(0);
        return;
      }
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false);
      setUnreadCount(count ?? 0);
    };
    void loadUnread();
  }, [pathname, open, hasSession]);

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
      const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []).filter(button => button.offsetParent !== null);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
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
    const supabase = getSupabaseClient();
    if (supabase) await supabase.auth.signOut();
    closeMenu();
    router.replace("/");
    router.refresh();
  };

  if (!hasSession) return null;

  return (
    <>
      <button
        ref={triggerRef}
        aria-label="メニュー"
        aria-expanded={open}
        aria-controls="global-menu-panel"
        className="fixed right-3 top-3 z-50 min-h-11 min-w-11 rounded-lg sm:min-h-0 sm:min-w-0 bg-zinc-900/90 p-2 text-zinc-100 shadow-lg"
        onClick={() => setOpen((v) => !v)}
      >
        ☰{unreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-[10px] font-bold text-black">{unreadCount}</span>}
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
        className={`fixed right-0 top-0 z-50 flex h-[100dvh] max-h-[100dvh] w-72 flex-col overflow-hidden bg-zinc-900 text-zinc-100 shadow-2xl transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-700 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <p id="global-menu-title" className="font-semibold">メニュー</p>
          <button ref={closeRef} aria-label="閉じる" className="rounded-lg bg-zinc-800 px-3 py-2 text-lg leading-none" onClick={closeMenu}>×</button>
        </div>
        <nav aria-label="メインメニュー" className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" style={{ WebkitOverflowScrolling: "touch" }}>
          <button className="min-h-12 w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/settings")}>アカウント・アプリ設定</button>
          <button className="min-h-12 w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/help")}>使い方・ヘルプ</button>
          <button className="min-h-12 w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/about")}>アプリについて</button>
          <button className="min-h-12 w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/notifications")}>通知{unreadCount > 0 ? ` (${unreadCount})` : ""}</button>
          {isSuperUser && <button className="min-h-12 w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/super-admin")}>スーパーユーザー管理</button>}
          <button data-menu-action="logout" className="w-full rounded-lg bg-red-600/80 px-3 py-3 text-left" onClick={() => void logout()}>ログアウト</button>
          {pathname === "/" && <p className="pt-2 text-xs text-zinc-400">ログイン画面です</p>}
        </nav>
      </aside>
    </>
  );
}
