"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui";
import { getOfficialAccess, officialStatusLabel } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";

export default function OfficialMatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const access = await getOfficialAccess(supabase);
      const { data } = await supabase.from("official_events").select("*,clubs(name)").eq("id", id).maybeSingle();
      if (!data || (!access.superUser && !access.groups.some((group) => group.id === data.club_id))) {
        setError("この操作を行う権限がありません");
        return;
      }
      setEvent(data);
    })();
  }, [id]);

  if (!event) return <main className="mx-auto min-h-screen w-full max-w-md p-4 text-sm">{error || "読み込み中..."}</main>;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">公式試合詳細</h1>
      <Card title={event.title}>
        <dl className="space-y-3 text-sm">
          <div><dt className="text-zinc-400">所属グループ</dt><dd>{event.clubs?.name ?? "名称未設定"}</dd></div>
          <div><dt className="text-zinc-400">開催日</dt><dd>{event.event_date ?? "未定"}</dd></div>
          <div><dt className="text-zinc-400">ステータス</dt><dd>{officialStatusLabel(event.status)}</dd></div>
          <div><dt className="text-zinc-400">説明</dt><dd className="whitespace-pre-wrap">{event.description || "未入力"}</dd></div>
          <div><dt className="text-zinc-400">メモ</dt><dd className="whitespace-pre-wrap">{event.memo || "未入力"}</dd></div>
        </dl>
      </Card>
      <Card title="対戦相手"><p className="text-sm text-zinc-400">対戦相手はまだ登録されていません</p></Card>
      <Card title="試合カード"><p className="text-sm text-zinc-400">試合カードはまだ登録されていません</p></Card>
      <Link href="/official-matches" className="text-center text-sm underline">公式試合一覧へ戻る</Link>
    </main>
  );
}
