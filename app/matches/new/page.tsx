"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { isGuestModeEnabled } from "@/lib/guest-events";
import { getSupabaseClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function NewMatchPage() {
  const router = useRouter();
  const [group, setGroup] = useState("");
  const [guest, setGuest] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setGroup(new URLSearchParams(window.location.search).get("group") ?? "");
    const s = getSupabaseClient();
    const apply = (authenticated: boolean) => {
      const guestMode = !authenticated && isGuestModeEnabled();
      setGuest(guestMode);
      if (!authenticated && !guestMode) router.replace("/");
      else setReady(true);
    };
    if (s) void s.auth.getSession().then(({ data }) => apply(!!data.session));
    else apply(false);
  }, []);
  const ordinary = (mode: string) => `/events/new?mode=${mode}${group ? `&group=${encodeURIComponent(group)}` : ""}`;
  const linkClass = "block min-h-14 rounded-xl border border-zinc-600 p-4 text-sm font-semibold";
  if (!ready) return <main className="mx-auto max-w-md p-4"><p role="status">作成できる試合形式を確認中…</p></main>;
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
    <h1 className="pr-14 text-xl font-bold">試合形式を選択</h1><p className="text-sm text-zinc-300">形式を選び、次の画面で開催情報を入力します。</p>
    <Card title="フレンドリー"><div className="space-y-3"><Link className={linkClass} href={ordinary("auto")}>組み合わせ戦・自動生成</Link><Link className={linkClass} href={ordinary("manual")}>組み合わせ戦・手動作成</Link>{guest ? <p className="rounded-xl border border-zinc-700 p-4 text-sm text-zinc-400">チーム戦はログイン後に利用できます。</p> : <Link className={linkClass} href="/team-matches/new">チーム戦</Link>}</div></Card>
    <Card title="オフィシャル"><div className="space-y-3">{guest ? <p className="text-sm text-zinc-400">オフィシャルチーム戦はログイン後に利用できます。</p> : <Link className={linkClass} href="/official-matches/new">チーム戦</Link>}<div className="rounded-xl border border-zinc-700 p-4 text-sm text-zinc-400">個人戦 <span className="ml-2 text-xs">準備中</span></div></div></Card>
    <Link href="/home" className="min-h-11 p-3 text-center text-sm underline">試合トップへ戻る</Link>
  </main>;
}
