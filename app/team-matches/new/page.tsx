"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, Card } from "@/components/ui";
import { getOfficialAccess, type OfficialGroup } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";

type SideMode = "group" | "free";

export default function NewFriendlyTeamMatchPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<OfficialGroup[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memo, setMemo] = useState("");
  const [teamAMode, setTeamAMode] = useState<SideMode>("free");
  const [teamBMode, setTeamBMode] = useState<SideMode>("free");
  const [teamAClubId, setTeamAClubId] = useState("");
  const [teamBClubId, setTeamBClubId] = useState("");
  const [teamAName, setTeamAName] = useState("自チーム");
  const [teamBName, setTeamBName] = useState("相手チーム");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { void (async () => {
    const supabase = getSupabaseClient(); if (!supabase) return;
    const access = await getOfficialAccess(supabase);
    setGroups(access.groups.filter((group) => access.superUser || group.role !== "member"));
  })(); }, []);

  const createEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    if (!name.trim()) return setError("イベント名を入力してください");
    const supabase = getSupabaseClient(); if (!supabase) return;
    setLoading(true);
    const { data: userResult } = await supabase.auth.getUser();
    const uid = userResult.user?.id;
    if (!uid) { setLoading(false); return setError("ログイン情報を確認できません"); }
    const primaryClubId = teamAMode === "group" ? teamAClubId || null : teamBMode === "group" ? teamBClubId || null : null;
    const { data, error: insertError } = await supabase.from("events").insert({
      name: name.trim(), category: "club", court_count: 1, club_id: primaryClubId, event_mode: "team", stats_mode: "undecided", created_by_auth_user_id: uid,
      description: description.trim() || null, memo: memo.trim() || null
    }).select("id").single();
    if (insertError || !data?.id) { setLoading(false); return setError("フレンドリーチームマッチの作成に失敗しました。DB変更SQLが未実行の場合は手順を実行してください"); }
    const sides = [
      { event_id: data.id, side: "team_a", club_id: teamAMode === "group" ? teamAClubId || null : null, team_name: teamAName.trim() || "自チーム" },
      { event_id: data.id, side: "team_b", club_id: teamBMode === "group" ? teamBClubId || null : null, team_name: teamBName.trim() || "相手チーム" }
    ];
    const { error: sideError } = await supabase.from("event_team_sides").insert(sides);
    setLoading(false);
    if (sideError) return setError("チーム設定の保存に失敗しました");
    router.push(`/team-matches/${data.id}`);
  };

  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 text-zinc-100">
    <h1 className="text-xl font-bold">フレンドリーチームマッチ</h1>
    <Card title="基本情報"><form className="space-y-3" onSubmit={createEvent}>
      <label className="block text-sm text-zinc-300">イベント名<input className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={name} onChange={(e)=>setName(e.target.value)} /></label>
      <label className="block text-sm text-zinc-300">説明<textarea className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={description} onChange={(e)=>setDescription(e.target.value)} /></label>
      <label className="block text-sm text-zinc-300">メモ<textarea className="mt-1 w-full rounded-xl bg-zinc-800 p-3 text-white" value={memo} onChange={(e)=>setMemo(e.target.value)} /></label>
      <TeamSetup title="自チーム" mode={teamAMode} setMode={setTeamAMode} clubId={teamAClubId} setClubId={setTeamAClubId} teamName={teamAName} setTeamName={setTeamAName} groups={groups} />
      <TeamSetup title="相手チーム" mode={teamBMode} setMode={setTeamBMode} clubId={teamBClubId} setClubId={setTeamBClubId} teamName={teamBName} setTeamName={setTeamBName} groups={groups} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ActionButton disabled={loading}>{loading ? "作成中..." : "作成"}</ActionButton>
    </form></Card>
  </main>;
}

function TeamSetup({ title, mode, setMode, clubId, setClubId, teamName, setTeamName, groups }: { title: string; mode: SideMode; setMode: (v: SideMode)=>void; clubId: string; setClubId: (v:string)=>void; teamName: string; setTeamName: (v:string)=>void; groups: OfficialGroup[] }) {
  return <section className="space-y-2 rounded-2xl border border-zinc-700 p-3"><p className="font-bold">{title}</p>
    <select className="w-full rounded-xl bg-zinc-800 p-3" value={mode} onChange={(e)=>setMode(e.target.value as SideMode)}><option value="group">グループを選択する</option><option value="free">グループなしで入力する</option></select>
    {mode === "group" && <select className="w-full rounded-xl bg-zinc-800 p-3" value={clubId} onChange={(e)=>setClubId(e.target.value)}><option value="">グループを選択する</option>{groups.map((g)=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}
    <label className="block text-sm text-zinc-300">チーム名<input className="mt-1 w-full rounded-xl bg-zinc-800 p-3" value={teamName} onChange={(e)=>setTeamName(e.target.value)} /></label>
  </section>;
}
