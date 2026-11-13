"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EventFormatCards } from "@/components/event-format-cards";
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
  if (!ready) return <main className="mx-auto max-w-md p-4"><p role="status">作成できるイベント形式を確認中…</p></main>;
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
    <h1 className="pr-14 text-xl font-bold">イベント形式を選択</h1><p className="text-sm text-zinc-300">形式を選んで、開催情報を入力します。</p>
    <EventFormatCards group={group} guest={guest}/>
    <Link href="/home" className="min-h-11 p-3 text-center text-sm underline">試合トップへ戻る</Link>
  </main>;
}
