"use client";

import { AppDialog } from "@/components/app-dialog";
import { readTeamGroups } from "@/lib/team-groups";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, Card } from "@/components/ui";
import { getOfficialAccess, officialStatusLabel, type OfficialGroup } from "@/lib/official-matches";
import { getSupabaseClient, getSupabaseEnvErrorMessage } from "@/lib/supabase";
import { useMatchGroupReturn } from "@/components/use-match-group-return";

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
  const [step, setStep] = useState(1);
  const [wizardOpen, setWizardOpen] = useState(true);
  const [hostGroupId, setHostGroupId] = useState("auto");
  const createLock = useRef(false);
  const [description, setDescription] = useState("");
  const [memo, setMemo] = useState("");
  const [teamAMode, setTeamAMode] = useState<SideMode>("free");
  const [teamBMode, setTeamBMode] = useState<SideMode>("free");
  const [teamAClubId, setTeamAClubId] = useState("");
  const [teamBClubId, setTeamBClubId] = useState("");
  const [teamAName, setTeamAName] = useState("チームA");
  const [teamBName, setTeamBName] = useState("チームB");
  const editedNames = useRef({ a: false, b: false });
  const chooseGroup = (side: "a" | "b", id: string, edited = editedNames.current[side]) => {
    const group = groups.find(g => g.id === id);
    if (side === "a") { setTeamAClubId(id); if (group && !edited) setTeamAName(group.name); }
    else { setTeamBClubId(id); if (group && !edited) setTeamBName(group.name); }
  };
  const [memberGroupIds, setMemberGroupIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [groupLoading, setGroupLoading] = useState(true);
  const [groupError, setGroupError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [ready, setReady] = useState(false);
  const groupReturn = useMatchGroupReturn({
    kind: "friendly_team", ownerId, ready,
    values: { name, description, memo, hostGroupId, createStep: String(step), teamAMode, teamBMode, teamAClubId, teamBClubId, teamAName, teamBName, teamAManual: String(editedNames.current.a), teamBManual: String(editedNames.current.b) },
    selectableIds: groups.map(group => group.id),
    restore: value => {
      setStep(Number(value.createStep ?? 1));
      setHostGroupId(value.hostGroupId === "none" || memberGroupIds.includes(String(value.hostGroupId)) ? String(value.hostGroupId) : "auto");
      setName(String(value.name)); setDescription(String(value.description)); setMemo(String(value.memo));
      setTeamAMode(value.teamAMode as SideMode); setTeamBMode(value.teamBMode as SideMode);
      setTeamAClubId(groups.some(group => group.id === value.teamAClubId) ? String(value.teamAClubId) : "");
      setTeamBClubId(groups.some(group => group.id === value.teamBClubId) ? String(value.teamBClubId) : "");
      setTeamAName(String(value.teamAName)); setTeamBName(String(value.teamBName));
      editedNames.current = { a: value.teamAManual === "true" || (value.teamAManual !== "false" && String(value.teamAName) !== (groups.find(g=>g.id===value.teamAClubId)?.name ?? "チームA")), b: value.teamBManual === "true" || (value.teamBManual !== "false" && String(value.teamBName) !== (groups.find(g=>g.id===value.teamBClubId)?.name ?? "チームB")) };
    },
    selectGroup: (id, slot) => { if (slot === "team_a") { setTeamAMode("group"); chooseGroup("a", id); } else if (slot === "team_b") { setTeamBMode("group"); chooseGroup("b", id); } }
  });


  const loadInitialData = async () => {
    setGroupLoading(true); setGroupError(""); setReady(false);
    const supabase = getSupabaseClient();
    if (!supabase) { setGroupLoading(false); setGroupError(getSupabaseEnvErrorMessage() || "接続を確認できません"); return; }
    let available: Awaited<ReturnType<typeof readTeamGroups>>;
    try { available = await readTeamGroups(supabase); }
    catch { setGroupError("グループ一覧を取得できませんでした。再取得してください。"); return; }
    finally { setGroupLoading(false); }
    setGroups(available.groups); setMemberGroupIds(available.memberIds);
    setOwnerId(available.uid); setReady(true);
    // 開催履歴の取得失敗・遅延でグループ選択を止めない。
    try {
    const access = await getOfficialAccess(supabase);
    setHistoryError("");

    const { data: eventRows, error: eventError } = await supabase
      .from("events")
      .select("id,name,status,created_at,club_id,created_by_auth_user_id")
      .eq("event_mode", "team")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    if (eventError) throw eventError;
    const rawEvents = (eventRows ?? []) as TeamEventRow[];
    if (!rawEvents.length) return setEvents([]);

    const eventIds = rawEvents.map((event) => event.id);
    const { data: sideRows, error: sideError } = await supabase.from("event_team_sides").select("event_id,side,club_id,team_name").in("event_id", eventIds);
    if (sideError) throw sideError;
    const sides = (sideRows ?? []) as TeamSideRow[];
    const sidesByEvent = new Map<string, TeamSideRow[]>();
    for (const side of sides) sidesByEvent.set(side.event_id, [...(sidesByEvent.get(side.event_id) ?? []), side]);

    const viewableGroupIds = access.groups.map((group) => group.id);
    const visibleEvents = rawEvents.filter((event) => {
      if (access.superUser) return true;
      if ((!event.club_id && event.created_by_auth_user_id === access.uid) || (event.club_id && viewableGroupIds.includes(event.club_id))) return true;
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
    } catch { setHistoryError("開催一覧を取得できませんでした。"); }
  };

  useEffect(() => { void loadInitialData(); }, []);

  const createEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createLock.current || !ready || loading || groupReturn.opening) return;
    if (step !== 4) { nextStep(); return; }
    setError("");
    if (!name.trim()) return setError("イベント名を入力してください");
    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!["auto", "none"].includes(hostGroupId) && !memberGroupIds.includes(hostGroupId)) return setError("開催グループを選び直してください");
    createLock.current = true;
    setLoading(true);
    try {
    const { data: userResult } = await supabase.auth.getUser();
    const creatorUserId = userResult.user?.id;
    if (!creatorUserId) {
      setLoading(false);
      return setError("ログイン情報を確認できません");
    }
    if ((teamAMode === "group" && !groups.some(g=>g.id===teamAClubId)) || (teamBMode === "group" && !groups.some(g=>g.id===teamBClubId))) { setLoading(false); return setError("チームのグループを選択してください"); }
    // 公開相手の選択は所属権限を付与しない。開催の所属は本人の所属先だけを使う。
    const automaticClubId = [teamAMode === "group" ? teamAClubId : "", teamBMode === "group" ? teamBClubId : ""].find(id=>memberGroupIds.includes(id)) || null;
    const primaryClubId = hostGroupId === "auto" ? automaticClubId : hostGroupId === "none" ? null : hostGroupId;
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
    groupReturn.clear();
    router.push(`/team-matches/${data.id}`);
    } catch { setError("作成できませんでした。入力内容を確認し、もう一度お試しください。"); }
    finally { createLock.current = false; setLoading(false); }
  };

  const busy = loading || groupReturn.opening;
  const automaticHost = [teamAMode === "group" ? teamAClubId : "", teamBMode === "group" ? teamBClubId : ""].find(id=>memberGroupIds.includes(id));
  const selectedHost = hostGroupId === "auto" ? automaticHost : hostGroupId === "none" ? "" : hostGroupId;
  const hostName = groups.find(g=>g.id===selectedHost)?.name || "グループなし";
  const nextStep = () => {
    setError("");
    if (!name.trim()) { setStep(1); setError("イベント名を入力してください"); return; }
    if ((step === 2 && teamAMode === "group" && !groups.some(g=>g.id===teamAClubId)) || (step === 3 && teamBMode === "group" && !groups.some(g=>g.id===teamBClubId))) { setError("チームのグループを選択してください"); return; }
    setStep(current=>Math.min(4,current+1));
  };
  const inputClass = "mt-1 min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-800 p-3 text-white";
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 text-zinc-100">
    <h1 className="text-xl font-bold">フレンドリーチームマッチ</h1>
    <ActionButton onClick={()=>setWizardOpen(true)}>新しいチーム戦を作成</ActionButton>
    <AppDialog open={wizardOpen} title="チーム戦を作成" busy={busy} onClose={()=>setWizardOpen(false)}>
      <form onSubmit={createEvent} className="flex min-h-0 flex-col">
        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4">
          <ol aria-label="作成ステップ" className="grid grid-cols-4 gap-1 text-center text-[11px]">{["基本情報","チームA","チームB","確認"].map((label,index)=><li key={label} aria-current={step===index+1?"step":undefined} className={`border-b-2 pb-2 ${step===index+1?"border-accent text-accent":"border-zinc-700 text-zinc-400"}`}>{index+1}. {label}</li>)}</ol>
          {step===1&&<>
            <label className="block text-sm">イベント名（必須）<input className={inputClass} value={name} onChange={e=>setName(e.target.value)} /></label>
            <label className="block text-sm">開催グループ<select aria-label="開催グループ" className={inputClass} disabled={!ready||busy} value={hostGroupId} onChange={e=>setHostGroupId(e.target.value)}><option value="auto">チーム設定から自動選択（従来どおり）</option><option value="none">グループなし</option>{groups.filter(g=>memberGroupIds.includes(g.id)).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
            <p className="text-xs text-zinc-400">開催の表示先です。各チームの所属グループとは別に設定できます。</p>
            <p role="note" className="text-xs text-zinc-400">開催日の指定は準備中です。作成日時は自動で記録されます。</p>
            <details className="group/comments"><summary className="flex min-h-11 list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden"><span className="event-disclosure-icon"><span className="group-open/comments:hidden">▶</span><span className="hidden group-open/comments:inline">▼</span></span>コメント・メモ（任意）</summary><div className="space-y-2"><label className="block text-sm">コメント<textarea aria-label="コメント" className={inputClass} rows={2} value={description} onChange={e=>setDescription(e.target.value)}/></label><label className="block text-sm">メモ<textarea aria-label="メモ" className={inputClass} rows={2} value={memo} onChange={e=>setMemo(e.target.value)}/></label></div></details>
          </>}
          {groupLoading&&<p role="status" className="text-xs text-zinc-400">所属・公開グループを取得中…</p>}
          {groupError&&<div role="alert" className="text-sm text-red-400"><p>{groupError}</p><button type="button" className="min-h-11 underline" onClick={()=>void loadInitialData()}>グループを再取得</button></div>}
          {step===2&&<TeamSetup title="チームA" mode={teamAMode} setMode={setTeamAMode} clubId={teamAClubId} setClubId={id=>chooseGroup("a",id)} teamName={teamAName} setTeamName={value=>{editedNames.current.a=true;setTeamAName(value);}} groups={groups} canCreateGroup={groupReturn.canCreate} busy={!ready||busy||groupLoading} onCreateGroup={()=>void groupReturn.begin("team_a")} />}
          {step===3&&<TeamSetup title="チームB" mode={teamBMode} setMode={setTeamBMode} clubId={teamBClubId} setClubId={id=>chooseGroup("b",id)} teamName={teamBName} setTeamName={value=>{editedNames.current.b=true;setTeamBName(value);}} groups={groups} canCreateGroup={groupReturn.canCreate} busy={!ready||busy||groupLoading} onCreateGroup={()=>void groupReturn.begin("team_b")} />}
          {step===4&&<dl className="space-y-3 text-sm"><div><dt className="text-xs text-zinc-400">イベント名</dt><dd className="break-words font-bold">{name}</dd></div><div><dt className="text-xs text-zinc-400">開催グループ{hostGroupId==="auto"?"（自動選択）":""}</dt><dd>{hostName}</dd></div>{[["チームA",teamAName,teamAMode,teamAClubId],["チームB",teamBName,teamBMode,teamBClubId]].map(([label,teamName,mode,clubId])=><div key={label} className={`border-l-2 pl-2 ${label==="チームA"?"border-emerald-500":"border-blue-500"}`}><dt className="text-xs text-zinc-400">{label} · {mode==="group"?groups.find(g=>g.id===clubId)?.name:"グループなし"}</dt><dd className="break-words font-bold">{teamName}</dd></div>)}{description&&<div><dt className="text-xs text-zinc-400">コメント</dt><dd className="whitespace-pre-wrap break-words">{description}</dd></div>}{memo&&<div><dt className="text-xs text-zinc-400">メモ</dt><dd className="whitespace-pre-wrap break-words">{memo}</dd></div>}</dl>}
          {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
          {groupReturn.message&&<p role="status" className="text-sm text-accent">{groupReturn.message}</p>}
          {groupReturn.error&&<p role="alert" className="text-sm text-red-400">{groupReturn.error}</p>}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-zinc-700 p-3">{step>1&&<button type="button" disabled={busy} className="min-h-11 rounded-xl border border-zinc-600 px-4" onClick={()=>{setError("");setStep(current=>current-1);}}>戻る</button>}{step<4?<button type="button" disabled={!ready||busy} className="min-h-11 flex-1 rounded-xl bg-accent px-4 font-bold text-black disabled:opacity-40" onClick={nextStep}>次へ</button>:<ActionButton disabled={!ready||busy}>{loading?"作成中…":"この内容で作成"}</ActionButton>}</div>
      </form>
    </AppDialog>
    <Card title="フレンドリーチームマッチ一覧">
      <div className="space-y-3 text-sm">
        {historyError && <p role="alert">{historyError}</p>}
        {!historyError && events.length === 0 && <p className="text-zinc-400">フレンドリーチームマッチはまだありません</p>}
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

function TeamSetup({ title, mode, setMode, clubId, setClubId, teamName, setTeamName, groups, canCreateGroup, busy, onCreateGroup }: { title: string; mode: SideMode; setMode: (v: SideMode)=>void; clubId: string; setClubId: (v:string)=>void; teamName: string; setTeamName: (v:string)=>void; groups: OfficialGroup[]; canCreateGroup: boolean; busy: boolean; onCreateGroup: () => void }) {
  return <section className="space-y-2 rounded-2xl border border-zinc-700 p-3"><p className="font-bold">{title}</p>
    <label className="block text-sm text-zinc-300">{title}のグループ<select aria-label={`${title}のグループ`} disabled={busy} className="mt-1 min-h-11 w-full rounded-xl bg-zinc-800 p-3 disabled:opacity-50" value={mode === "group" ? clubId : ""} onChange={(e)=>{const id=e.target.value;setMode(id?"group":"free");setClubId(id);}}><option value="">グループなしで入力する</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
    {canCreateGroup && <button type="button" disabled={busy} className="min-h-11 text-sm text-accent underline" onClick={onCreateGroup}>＋ 新しいグループを作成</button>}
    <label className="block text-sm text-zinc-300">チーム名<input className="mt-1 w-full rounded-xl bg-zinc-800 p-3" value={teamName} onChange={(e)=>setTeamName(e.target.value)} /></label>
  </section>;
}
