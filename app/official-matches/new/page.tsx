"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, Card } from "@/components/ui";
import { getOfficialAccess, type OfficialGroup } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";

export default function NewOfficialMatchPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<OfficialGroup[]>([]);
  const [clubId, setClubId] = useState("");
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [description, setDescription] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const access = await getOfficialAccess(supabase);
      const editableGroups = access.groups.filter((group) => access.superUser || group.role !== "member");
      setGroups(editableGroups);
      setClubId(editableGroups[0]?.id ?? "");
      if (!editableGroups.length) setError("この操作を行う権限がありません");
    })();
  }, []);

  const createOfficialMatch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || !clubId) return setError("大会/リーグ名と所属グループを入力してください");
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    const { data: userResult } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase.from("official_events").insert({
      title: title.trim(), club_id: clubId, event_date: eventDate || null,
      description: description.trim() || null, memo: memo.trim() || null,
      created_by_auth_user_id: userResult.user?.id ?? null
    }).select("id").single();
    setLoading(false);
    if (insertError || !data) return setError("公式試合の作成に失敗しました");
    router.push(`/official-matches/${data.id}`);
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-md p-4">
      <h1 className="mb-4 text-xl font-bold">公式試合を作成</h1>
      <Card title="基本情報">
        <form className="space-y-3" onSubmit={createOfficialMatch}>
          <label className="block text-sm text-zinc-300">大会/リーグ名<input className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="block text-sm text-zinc-300">所属グループ<select className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={clubId} onChange={(e) => setClubId(e.target.value)}><option value="">選択してください</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label className="block text-sm text-zinc-300">開催日<input type="date" className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></label>
          <label className="block text-sm text-zinc-300">説明<textarea className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="block text-sm text-zinc-300">メモ<textarea className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <ActionButton disabled={!groups.length || loading}>{loading ? "作成中..." : "作成"}</ActionButton>
        </form>
      </Card>
    </main>
  );
}
