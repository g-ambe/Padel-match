"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, Card } from "@/components/ui";
import { getOfficialAccess, officialStatusLabel, type OfficialGroup } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";

type SideMode = "group" | "free";
type TeamEventRow = {
  id: string;
  name: string;
  status: string;
  created_at: string | null;
  club_id: string | null;
  created_by_auth_user_id: string | null;
};
type TeamSideRow = { event_id: string; side: "team_a" | "team_b"; club_id: string | null; team_name: string | null };
type TeamEventListItem = TeamEventRow & { teamAName: string; teamBName: string };

export default function NewFriendlyTeamMatchPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<OfficialGroup[]>([]);
  const [events, setEvents] = useState<TeamEventListItem[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memo, setMemo] = useState("");
  const [teamAMode, setTeamAMode] = useState<SideMode>("free");
  const [teamBMode, setTeamBMode] = useState<SideMode>("free");
  const [teamAClubId, setTeamAClubId] = useState("");
  const [teamBClubId, setTeamBClubId] = useState("");
  const [teamAName, setTeamAName] = useState("チームA");
  const [teamBName, setTeamBName] = useState("チームB");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);


  const loadInitialData = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const access = await getOfficialAccess(supabase);
    const editableGroups = access.groups.filter((group) => access.superUser || group.role !== "member");
    setGroups(editableGroups);

    const { data: eventRows } = await supabase
      .from("events")
      .select("id,name,status,created_at,club_id,created_by_auth_user_id")
      .eq("event_mode", "team")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    const rawEvents = (eventRows ?? []) as TeamEventRow[];
    if (!rawEvents.length) return setEvents([]);

    const eventIds = rawEvents.map((event) => event.id);
    const { data: sideRows } = await supabase.from("event_team_sides").select("event_id,side,club_id,team_name").in("event_id", eventIds);
    const sides = (sideRows ?? []) as TeamSideRow[];
    const sidesByEvent = new Map<string, TeamSideRow[]>();
    for (const side of sides) sidesByEvent.set(side.event_id, [...(sidesByEvent.get(side.event_id) ?? []), side]);

    const viewableGroupIds = access.groups.map((group) => group.id);
    const visibleEvents = rawEvents.filter((event) => {
      if (access.superUser) return true;
      if (!event.club_id && event.created_by_auth_user_id === access.uid) return true;
      const eventSides = sidesByEvent.get(event.id) ?? [];
      return eventSides.some((side) => side.club_id && viewableGroupIds.includes(side.club_id));
    });

    setEvents(visibleEvents.map((event) => {
      const eventSides = sidesByEvent.get(event.id) ?? [];
      return {
        ...event,
        teamAName: eventSides.find((side) => side.side === "team_a")?.team_name || "チームA",
        teamBName: eventSides.find((side) => side.side === "team_b")?.team_name || "チームB"
      };
    }));
  };

  useEffect(() => { void loadInitialData(); }, []);

  const createEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!name.trim()) return setError("イベント名を入力してください");
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setLoading(true);
    const { data: userResult } = await supabase.auth.getUser();
    const creatorUserId = userResult.user?.id;
    if (!creatorUserId) {
      setLoading(false);
      return setError("ログイン情報を確認できません");
    }
    const primaryClubId = teamAMode === "group" ? teamAClubId || null : teamBMode === "group" ? teamBClubId || null : null;
    const { data, error: insertError } = await supabase.from("events").insert({
      name: name.trim(), category: "club", court_count: 1, club_id: primaryClubId, event_mode: "team", stats_mode: "undecided", created_by_auth_user_id: creatorUserId,
      description: description.trim() || null, memo: memo.trim() || null
    }).select("id").single();
    if (insertError || !data?.id) {
      setLoading(false);
      return setError("フレンドリーチームマッチの作成に失敗しました。DB変更SQLが未実行の場合は手順を実行してください");
    }
    const sides = [
      { event_id: data.id, side: "team_a", club_id: teamAMode === "group" ? teamAClubId || null : null, team_name: teamAName.trim() || "チームA" },
      { event_id: data.id, side: "team_b", club_id: teamBMode === "group" ? teamBClubId || null : null, team_name: teamBName.trim() || "チームB" }
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
      <TeamSetup title="チームA" mode={teamAMode} setMode={setTeamAMode} clubId={teamAClubId} setClubId={setTeamAClubId} teamName={teamAName} setTeamName={setTeamAName} groups={groups} />
      <TeamSetup title="チームB" mode={teamBMode} setMode={setTeamBMode} clubId={teamBClubId} setClubId={setTeamBClubId} teamName={teamBName} setTeamName={setTeamBName} groups={groups} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ActionButton disabled={loading}>{loading ? "作成中..." : "作成"}</ActionButton>
    </form></Card>
    <Card title="フレンドリーチームマッチ一覧">
      <div className="space-y-3 text-sm">
        {events.length === 0 && <p className="text-zinc-400">フレンドリーチームマッチはまだありません</p>}
        {events.map((event) => <div key={event.id} className="space-y-2 rounded-2xl border border-zinc-700 bg-zinc-900/70 p-3">
          <p className="font-bold">{event.name}</p>
          <p>{event.teamAName} vs {event.teamBName}</p>
          <p className="text-zinc-400">ステータス: {officialStatusLabel(event.status)}</p>
          <p className="text-zinc-400">作成日: {event.created_at ? new Date(event.created_at).toLocaleDateString("ja-JP") : "未設定"}</p>
          <Link className="inline-block rounded-xl border border-zinc-500 px-3 py-2 text-xs font-bold" href={`/team-matches/${event.id}`}>詳細</Link>
        </div>)}
      </div>
    </Card>
  </main>;
}

function TeamSetup({ title, mode, setMode, clubId, setClubId, teamName, setTeamName, groups }: { title: string; mode: SideMode; setMode: (v: SideMode)=>void; clubId: string; setClubId: (v:string)=>void; teamName: string; setTeamName: (v:string)=>void; groups: OfficialGroup[] }) {
  return <section className="space-y-2 rounded-2xl border border-zinc-700 p-3"><p className="font-bold">{title}</p>
    <select className="w-full rounded-xl bg-zinc-800 p-3" value={mode} onChange={(e)=>{ const next = e.target.value as SideMode; setMode(next); if (next === "free") setClubId(""); }}><option value="group">グループを選択する</option><option value="free">グループなしで入力する</option></select>
    {mode === "group" && <select className="w-full rounded-xl bg-zinc-800 p-3" value={clubId} onChange={(e)=>setClubId(e.target.value)}><option value="">グループを選択する</option>{groups.map((g)=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}
    <label className="block text-sm text-zinc-300">チーム名<input className="mt-1 w-full rounded-xl bg-zinc-800 p-3" value={teamName} onChange={(e)=>setTeamName(e.target.value)} /></label>
  </section>;
}
