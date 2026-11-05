"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OfficialMatchList } from "@/components/official-match-list";
import { ActionButton, Card } from "@/components/ui";
import { getOfficialAccess, type OfficialGroup } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";
import { useMatchGroupReturn } from "@/components/use-match-group-return";

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
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const groupReturn = useMatchGroupReturn({
    kind: "official_team", ownerId, ready, values: { title, eventDate, description, memo, clubId }, selectableIds: groups.map(group => group.id),
    restore: value => { setTitle(String(value.title)); setEventDate(String(value.eventDate)); setDescription(String(value.description)); setMemo(String(value.memo)); setClubId(groups.some(group => group.id === value.clubId) ? String(value.clubId) : ""); },
    selectGroup: id => setClubId(id)
  });

  useEffect(() => {
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const access = await getOfficialAccess(supabase);
      const editableGroups = access.groups.filter((group) => access.superUser || group.role !== "member");
      setGroups(editableGroups);
      setClubId("");
      setOwnerId(access.uid || null); setReady(true);
    })();
  }, []);

  const createOfficialMatch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return setError("大会/リーグ名を入力してください");
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    const { data: userResult } = await supabase.auth.getUser();
    const creatorUserId = userResult.user?.id;
    if (!creatorUserId) {
      setLoading(false);
      return setError("ログイン情報を確認できません");
    }
    const { data, error: insertError } = await supabase.from("official_events").insert({
      title: title.trim(), club_id: clubId || null, event_date: eventDate || null,
      description: description.trim() || null, memo: memo.trim() || null,
      created_by_auth_user_id: creatorUserId
    }).select("id").single();
    setLoading(false);
    if (insertError || !data) return setError("オフィシャルチームマッチの作成に失敗しました");
    groupReturn.clear();
    router.push(`/official-matches/${data.id}`);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">オフィシャルチームマッチ</h1>
      <Card title="基本情報">
        <form className="space-y-3" onSubmit={createOfficialMatch}>
          <label className="block text-sm text-zinc-300">大会/リーグ名<input className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="block text-sm text-zinc-300">所属グループ<select className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={clubId} onChange={(e) => setClubId(e.target.value)}><option value="">選択してください</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          {groupReturn.canCreate && <button type="button" disabled={loading || groupReturn.opening} className="min-h-11 text-sm text-accent underline" onClick={() => void groupReturn.begin()}>＋ 新しいグループを作成</button>}
          <label className="block text-sm text-zinc-300">開催日<input type="date" className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></label>
          <label className="block text-sm text-zinc-300">説明<textarea className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="block text-sm text-zinc-300">メモ<textarea className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {groupReturn.message && <p role="status" className="text-sm text-accent">{groupReturn.message}</p>}
          {groupReturn.error && <p role="alert" className="text-sm text-red-400">{groupReturn.error}</p>}
          <ActionButton disabled={loading || groupReturn.opening}>{loading ? "作成中..." : "作成"}</ActionButton>
        </form>
      </Card>
      <OfficialMatchList />
    </main>
  );
}
