"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

export function GlobalMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

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

    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
      if (!session) {
        setOpen(false);
      }
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
        aria-label="メニュー"
        className="fixed right-3 top-3 z-50 rounded-lg bg-zinc-900/90 p-2 text-zinc-100 shadow-lg"
        onClick={() => setOpen((v) => !v)}
      >
        ☰
      </button>

      {open && <button className="fixed inset-0 z-40 bg-black/60" aria-label="閉じる" onClick={closeMenu} />}

      <aside
        className={`fixed right-0 top-0 z-50 h-full w-72 bg-zinc-900 p-4 pt-16 text-zinc-100 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <button
          aria-label="閉じる"
          className="absolute right-3 top-3 rounded-lg bg-zinc-800 px-3 py-1 text-lg leading-none"
          onClick={closeMenu}
        >
          ×
        </button>
        <nav className="space-y-2">
          <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/profile")}>プロフィール</button>
          <div className="rounded-lg bg-zinc-800">
            <button className="flex w-full items-center justify-between px-3 py-3 text-left" onClick={() => setGroupOpen((v) => !v)}>
              <span>グループ</span>
              <span>{groupOpen ? "−" : "+"}</span>
            </button>
            {groupOpen && (
              <div className="border-t border-zinc-700">
                <button className="w-full px-6 py-3 text-left text-sm" onClick={() => moveTo("/groups")}>所属グループ閲覧・設定</button>
                <button className="w-full border-t border-zinc-700 px-6 py-3 text-left text-sm" onClick={() => moveTo("/groups/discover")}>グループを探す</button>
                <button className="w-full border-t border-zinc-700 px-6 py-3 text-left text-sm" onClick={() => moveTo("/groups/new")}>グループを作成する</button>
              </div>
            )}
          </div>
          <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/notifications")}>通知{unreadCount > 0 ? ` (${unreadCount})` : ""}</button>
          <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/home")}>開催一覧</button>
          <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/ranking")}>戦績ランキング</button>
          <button className="w-full rounded-lg bg-red-600/80 px-3 py-3 text-left" onClick={() => void logout()}>ログアウト</button>
          {pathname === "/" && <p className="pt-2 text-xs text-zinc-400">ログイン画面です</p>}
        </nav>
      </aside>
    </>
  );
}
