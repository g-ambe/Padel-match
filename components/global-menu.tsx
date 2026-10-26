"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { useTheme } from "@/components/theme-provider";

const connectionItems = [{ id: "following", label: "フォロー" }, { id: "followers", label: "フォロワー" }] as const;

export function GlobalMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [friendlyOpen, setFriendlyOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [officialOpen, setOfficialOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [isSuperUser, setIsSuperUser] = useState(false);
  const { theme, saving: themeSaving, message: themeMessage, setTheme } = useTheme();

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
        className="fixed right-3 top-3 z-50 rounded-lg bg-zinc-900/90 p-2 text-zinc-100 shadow-lg"
        onClick={() => setOpen((v) => !v)}
      >
        ☰
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
          <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/profile")}>プロフィール</button>
          <div className="rounded-lg bg-zinc-800" role="group" aria-labelledby="connections-title">
            <p id="connections-title" className="px-3 py-3 font-medium">つながり</p>
            {connectionItems.map(item => <button key={item.id} type="button" disabled aria-disabled="true" className="flex w-full cursor-not-allowed items-center justify-between border-t border-zinc-700 px-6 py-3 text-left text-sm opacity-60"><span>{item.label}</span><span className="text-xs">準備中</span></button>)}
          </div>
          <div className="rounded-lg bg-zinc-800">
            <div className="px-3 py-3 font-medium">イベント作成・閲覧</div>
            <div className="border-t border-zinc-700">
              <button className="flex w-full items-center justify-between px-6 py-3 text-left text-sm" aria-expanded={friendlyOpen} onClick={() => setFriendlyOpen((v) => !v)}>
                <span>フレンドリーマッチ</span>
                <span aria-hidden="true">{friendlyOpen ? "−" : "+"}</span>
              </button>
              {friendlyOpen && (
                <div className="border-t border-zinc-700 bg-zinc-900/60">
                  <button className="w-full px-9 py-3 text-left text-sm" onClick={() => moveTo("/home")}>フレンドリーマッチ</button>
                  <button className="w-full border-t border-zinc-700 px-9 py-3 text-left text-sm" onClick={() => moveTo("/team-matches/new")}>フレンドリーチームマッチ</button>
                </div>
              )}
              <button className="flex w-full items-center justify-between border-t border-zinc-700 px-6 py-3 text-left text-sm" aria-expanded={officialOpen} onClick={() => setOfficialOpen((v) => !v)}>
                <span>オフィシャルマッチ</span>
                <span aria-hidden="true">{officialOpen ? "−" : "+"}</span>
              </button>
              {officialOpen && (
                <div className="border-t border-zinc-700 bg-zinc-900/60">
                  <button className="w-full px-9 py-3 text-left text-sm" onClick={() => moveTo("/official-matches/new")}>オフィシャルチームマッチ</button>
                  <button className="w-full border-t border-zinc-700 px-9 py-3 text-left text-sm" onClick={() => moveTo("/official-matches/individual")}>オフィシャルマッチ</button>
                </div>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-zinc-800">
            <button className="flex w-full items-center justify-between px-3 py-3 text-left" aria-expanded={groupOpen} onClick={() => setGroupOpen((v) => !v)}>
              <span>グループ</span>
              <span aria-hidden="true">{groupOpen ? "−" : "+"}</span>
            </button>
            {groupOpen && (
              <div className="border-t border-zinc-700">
                <button className="w-full px-6 py-3 text-left text-sm" onClick={() => moveTo("/groups")}>所属グループ閲覧・設定</button>
                <button className="w-full border-t border-zinc-700 px-6 py-3 text-left text-sm" onClick={() => moveTo("/groups/discover")}>グループを探す</button>
                <button className="w-full border-t border-zinc-700 px-6 py-3 text-left text-sm" onClick={() => moveTo("/groups/new")}>グループを作成する</button>
              </div>
            )}
          </div>
          {isSuperUser && <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/super-admin")}>スーパーユーザー管理</button>}
          <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/notifications")}>通知{unreadCount > 0 ? ` (${unreadCount})` : ""}</button>
          <div className="rounded-lg bg-zinc-800 p-3">
            <p className="mb-2 text-sm font-bold">表示設定</p>
            <p className="mb-2 text-xs text-zinc-300">テーマ</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`rounded-lg border px-2 py-2 text-sm ${theme === "dark" ? "border-accent bg-accent text-black" : "border-zinc-600 bg-zinc-900/60"}`}
                disabled={themeSaving}
                onClick={() => void setTheme("dark")}
              >
                ダークモード
              </button>
              <button
                className={`rounded-lg border px-2 py-2 text-sm ${theme === "light" ? "border-blue-500 bg-blue-600 text-white" : "border-zinc-600 bg-zinc-900/60"}`}
                disabled={themeSaving}
                onClick={() => void setTheme("light")}
              >
                ホワイトモード
              </button>
            </div>
            {themeMessage && <p className="mt-2 text-xs text-accent">{themeMessage}</p>}
          </div>
          {/* 一時的に非表示: 将来再表示予定 */}
          {/* <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/ranking")}>戦績ランキング</button> */}
          <button data-menu-action="logout" className="w-full rounded-lg bg-red-600/80 px-3 py-3 text-left" onClick={() => void logout()}>ログアウト</button>
          {pathname === "/" && <p className="pt-2 text-xs text-zinc-400">ログイン画面です</p>}
        </nav>
      </aside>
    </>
  );
}
