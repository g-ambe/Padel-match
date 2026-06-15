"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { getOfficialAccess, officialStatusLabel } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";

type OfficialEvent = { id: string; title: string; event_date: string | null; status: string; clubs: { name: string } | null };

export default function OfficialMatchListPage() {
  const [events, setEvents] = useState<OfficialEvent[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const access = await getOfficialAccess(supabase);
      const clubIds = access.groups.map((group) => group.id);
      setCanCreate(access.superUser || access.groups.some((group) => group.role !== "member"));
      if (!clubIds.length) return;

      let query = supabase.from("official_events").select("id,title,event_date,status,clubs(name)").in("club_id", clubIds);
      if (access.superUser) query = query.eq("status", "active");
      const { data, error: loadError } = await query.order("created_at", { ascending: false });
      if (loadError) setError("公式試合一覧の取得に失敗しました");
      setEvents((data ?? []) as unknown as OfficialEvent[]);
    })();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">公式試合一覧</h1>
      {canCreate && <Link href="/official-matches/new" className="rounded-xl bg-accent p-3 text-center font-bold text-black">公式試合を作成</Link>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Card title="公式試合">
        {events.length === 0 ? <p className="text-sm text-zinc-400">公式試合はまだありません</p> : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="rounded-xl bg-zinc-800 p-3">
                <p className="font-semibold">{event.title}</p>
                <p className="mt-1 text-xs text-zinc-300">所属グループ: {event.clubs?.name ?? "名称未設定"}</p>
                <p className="text-xs text-zinc-300">開催日: {event.event_date ?? "未定"}</p>
                <p className="text-xs text-zinc-300">ステータス: {officialStatusLabel(event.status)}</p>
                <Link href={`/official-matches/${event.id}`} className="mt-3 block rounded-xl border border-zinc-600 py-2 text-center text-sm">詳細</Link>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Link href="/home" className="text-center text-sm underline">イベント作成・閲覧へ戻る</Link>
    </main>
  );
}
