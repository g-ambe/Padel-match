"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

export function GlobalMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  const closeMenu = () => setOpen(false);

  const moveTo = (path: string) => {
    closeMenu();
    router.push(path);
  };

  const logout = async () => {
    const supabase = getSupabaseClient();
    if (supabase) await supabase.auth.signOut();
    closeMenu();
    router.replace("/");
    router.refresh();
  };

  return (
    <>
      <button
        aria-label="メニュー"
        className="fixed right-3 top-3 z-50 rounded-lg bg-zinc-900/90 p-2 text-zinc-100 shadow-lg"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "×" : "☰"}
      </button>

      {open && <button className="fixed inset-0 z-40 bg-black/60" aria-label="閉じる" onClick={closeMenu} />}

      <aside
        className={`fixed right-0 top-0 z-50 h-full w-72 bg-zinc-900 p-4 pt-16 text-zinc-100 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <nav className="space-y-2">
          <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/profile")}>Profile</button>
          <div className="rounded-lg bg-zinc-800">
            <button className="flex w-full items-center justify-between px-3 py-3 text-left" onClick={() => setGroupOpen((v) => !v)}>
              <span>グループ管理</span>
              <span>{groupOpen ? "−" : "+"}</span>
            </button>
            {groupOpen && (
              <button className="w-full border-t border-zinc-700 px-6 py-3 text-left text-sm" onClick={closeMenu}>
                メンバー管理
              </button>
            )}
          </div>
          <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={() => moveTo("/home")}>開催一覧</button>
          <button className="w-full rounded-lg bg-zinc-800 px-3 py-3 text-left" onClick={closeMenu}>戦績ランキング</button>
          <button className="w-full rounded-lg bg-red-600/80 px-3 py-3 text-left" onClick={() => void logout()}>ログアウト</button>
          {pathname === "/" && <p className="pt-2 text-xs text-zinc-400">ログイン画面です</p>}
        </nav>
      </aside>
    </>
  );
}
