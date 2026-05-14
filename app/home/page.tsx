"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ActionButton } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function HomePage() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [courtCount, setCourtCount] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const createEvent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (!name.trim() || courtCount < 1) {
      setError("開催名とコート数を入力してください");
      return;
    }

    setLoading(true);
    const { data, error: insertError } = await supabase
      .from("events")
      .insert({
        name: name.trim(),
        court_count: courtCount,
        category: "club"
      })
      .select("id")
      .single();

    setLoading(false);

    if (insertError || !data?.id) {
      setError("開催の作成に失敗しました");
      return;
    }

    router.push(`/events/${data.id}`);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">開催一覧</h1>
      <ActionButton onClick={() => setOpen(true)}>開催作成</ActionButton>

      {open && (
        <Card title="開催作成フォーム">
          <form className="space-y-3" onSubmit={createEvent}>
            <input
              className="w-full rounded-xl bg-zinc-800 p-3"
              placeholder="開催名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full rounded-xl bg-zinc-800 p-3"
              type="number"
              min={1}
              placeholder="コート数"
              value={courtCount}
              onChange={(e) => setCourtCount(Number(e.target.value))}
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button type="button" className="w-1/2 rounded-xl border border-zinc-600 py-3" onClick={() => setOpen(false)}>
                キャンセル
              </button>
              <button type="submit" className="w-1/2 rounded-xl bg-accent py-3 font-semibold text-black" disabled={loading}>
                {loading ? "作成中..." : "作成"}
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Wytelパデル部">
        <div className="space-y-2">
          <Link href="/events/demo" className="block rounded-xl bg-zinc-800 p-3">木曜ナイトマッチ（コート2面）</Link>
        </div>
      </Card>
    </main>
  );
}
