"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { ActionButton, Card } from "@/components/ui";
import { fetchActiveClubMemberParticipants } from "@/lib/event-participants";
import { createShareToken, getOfficialAccess, officialStatusLabel, type OfficialGroup } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";

type ResultValue = "win" | "lose" | "draw" | "undecided";
type TeamSideKey = "team_a" | "team_b";
type MemberOption = { playerProfileId: string; displayName: string | null };
type GuestOption = { id: string; side: TeamSideKey; guest_name: string };
type PlayerChoice = { value: string; label: string; kind: "member" | "guest" };
type EventRow = { id: string; name: string; status: string; club_id: string | null; description: string | null; memo: string | null; stats_mode: string; share_enabled?: boolean | null; share_token?: string | null; created_by_auth_user_id?: string | null; is_deleted?: boolean | null };
type Side = { id: string; side: TeamSideKey; club_id: string | null; team_name: string | null };
type Match = { id: string; match_order: number; team_a_player1_profile_id: string | null; team_a_player1_guest_name: string | null; team_a_player2_profile_id: string | null; team_a_player2_guest_name: string | null; team_b_player1_profile_id: string | null; team_b_player1_guest_name: string | null; team_b_player2_profile_id: string | null; team_b_player2_guest_name: string | null; team_a_score: number | null; team_b_score: number | null; result: ResultValue; score_detail: string | null; memo: string | null; youtube_url: string | null; created_at?: string | null };
type Form = { a1ProfileId: string; a1GuestName: string; a2ProfileId: string; a2GuestName: string; b1ProfileId: string; b1GuestName: string; b2ProfileId: string; b2GuestName: string; aScore: string; bScore: string; result: ResultValue; scoreDetail: string; memo: string; youtubeUrl: string };
type StatsSectionKey = "teams" | "players" | "pairs";
type StatsRow = { name: string; matches: number; wins: number; losses: number; draws: number; points: number; scored: number; conceded: number; diff: number; winRate: number };

const emptyForm = (): Form => ({ a1ProfileId:"",a1GuestName:"",a2ProfileId:"",a2GuestName:"",b1ProfileId:"",b1GuestName:"",b2ProfileId:"",b2GuestName:"",aScore:"",bScore:"",result:"undecided",scoreDetail:"",memo:"",youtubeUrl:"" });
const resultLabel = (r: ResultValue) => ({ win:"チームA勝ち", lose:"チームB勝ち", draw:"引き分け", undecided:"未定" }[r]);
const autoResult = (a: string, b: string): ResultValue => { if (a.trim()==="" || b.trim()==="") return "undecided"; const x=Number(a), y=Number(b); if (!Number.isInteger(x)||!Number.isInteger(y)) return "undecided"; if (x>y) return "win"; if (x<y) return "lose"; return "draw"; };
const isYoutubeUrl = (v: string) => /^https:\/\/(www\.)?youtube\.com\/watch\?v=/.test(v) || /^https:\/\/youtu\.be\//.test(v) || /^https:\/\/(www\.)?youtube\.com\/shorts\//.test(v);
const guestChoiceValue = (name: string) => `guest:${name}`;
const selectedChoiceValue = (profileId: string, guestName: string) => profileId || (guestName ? guestChoiceValue(guestName) : "");
const emptyStatsRow = (name: string): StatsRow => ({ name, matches: 0, wins: 0, losses: 0, draws: 0, points: 0, scored: 0, conceded: 0, diff: 0, winRate: 0 });
const applyStatsResult = (row: StatsRow, scored: number, conceded: number) => { row.matches += 1; row.scored += scored; row.conceded += conceded; if (scored > conceded) { row.wins += 1; row.points += 3; } else if (scored < conceded) { row.losses += 1; } else { row.draws += 1; row.points += 1; } row.diff = row.scored - row.conceded; row.winRate = row.matches ? Math.round((row.wins / row.matches) * 1000) / 10 : 0; };
const sortStatsRows = (rows: StatsRow[]) => [...rows].sort((a, b) => b.points - a.points || b.wins - a.wins || b.winRate - a.winRate || b.diff - a.diff || b.scored - a.scored || b.draws - a.draws || a.matches - b.matches || a.name.localeCompare(b.name, "ja"));
const hasCountableTeamScore = (match: Match) => typeof match.team_a_score === "number" && typeof match.team_b_score === "number" && !(match.team_a_score === 0 && match.team_b_score === 0);

export default function FriendlyTeamMatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [groups,setGroups]=useState<OfficialGroup[]>([]);
  const [sides,setSides]=useState<Side[]>([]);
  const [members,setMembers]=useState<Record<TeamSideKey, MemberOption[]>>({ team_a: [], team_b: [] });
  const [guests,setGuests]=useState<Record<TeamSideKey, GuestOption[]>>({ team_a: [], team_b: [] });
  const [matches,setMatches]=useState<Match[]>([]);
  const [form,setForm]=useState<Form>(emptyForm());
  const [editingId,setEditingId]=useState<string|null>(null);
  const [editingForm,setEditingForm]=useState<Form>(emptyForm());
  const [guestNames,setGuestNames]=useState<Record<TeamSideKey, string>>({ team_a: "", team_b: "" });
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [canManage,setCanManage]=useState(false);
  const [showForm,setShowForm]=useState(false);
  const [showDelete,setShowDelete]=useState(false);
  const [deleteOk,setDeleteOk]=useState(false);
  const [closeMode,setCloseMode]=useState<"official"|"record_only">("official");
  const [openStatsSections,setOpenStatsSections]=useState<Record<StatsSectionKey, boolean>>({ teams: false, players: false, pairs: false });
  const [isEditingEventName,setIsEditingEventName]=useState(false);
  const [eventNameDraft,setEventNameDraft]=useState("");

  const teamA = sides.find((s)=>s.side==="team_a");
  const teamB = sides.find((s)=>s.side==="team_b");
  const shareUrl = useMemo(()=> event?.status === "closed" && event.share_enabled && event.share_token && typeof window !== "undefined" ? `${window.location.origin}/share/events/${event.share_token}` : "", [event]);
  const teamAName = teamA?.team_name || "チームA";
  const teamBName = teamB?.team_name || "チームB";

  const load = async () => {
    const supabase=getSupabaseClient();
    if(!supabase) return;
    const access=await getOfficialAccess(supabase);
    setGroups(access.groups.filter((g)=>access.superUser||g.role!=="member"));
    const { data:e }=await supabase.from("events").select("id,name,status,club_id,description,memo,stats_mode,share_enabled,share_token,created_by_auth_user_id,is_deleted,event_mode").eq("id",id).eq("event_mode","team").maybeSingle();
    const row=e as any as EventRow|null;
    if(!row || row.is_deleted){ setError("フレンドリーチームマッチが見つかりません"); return; }
    const { data:ss }=await supabase.from("event_team_sides").select("id,side,club_id,team_name").eq("event_id",id);
    const sideRows=(ss??[]) as Side[];
    const creator=access.uid===row.created_by_auth_user_id;
    const sideClubIds = sideRows.map((side) => side.club_id).filter(Boolean) as string[];
    const manageable=access.superUser || creator || access.groups.some((g)=>sideClubIds.includes(g.id) && (g.role==="main_admin"||g.role==="sub_admin"));
    const viewable=manageable || access.groups.some((g)=>sideClubIds.includes(g.id)) || (!row.club_id && creator);
    if (!viewable) { setError("この操作を行う権限がありません"); return; }
    setEvent(row);
    setCanManage(manageable);
    setSides(sideRows);
    const loadedMembers: Record<TeamSideKey, MemberOption[]>={team_a:[],team_b:[]};
    for (const side of sideRows) if (side.club_id) loadedMembers[side.side]=await fetchActiveClubMemberParticipants(supabase, side.club_id);
    setMembers(loadedMembers);
    const { data:guestRows }=await supabase.from("event_team_guests").select("id,side,guest_name").eq("event_id",id).order("created_at", { ascending: true });
    const nextGuests: Record<TeamSideKey, GuestOption[]> = { team_a: [], team_b: [] };
    for (const guest of ((guestRows ?? []) as GuestOption[])) nextGuests[guest.side].push(guest);
    setGuests(nextGuests);
    const { data:ms }=await supabase.from("event_team_matches").select("*").eq("event_id",id).order("match_order").order("created_at").order("id");
    setMatches((ms??[]) as Match[]);
  };
  useEffect(()=>{void load();},[id]);

  const choices = (side: TeamSideKey): PlayerChoice[] => [
    ...members[side].map((member) => ({ value: member.playerProfileId, label: member.displayName ?? "名称未設定", kind: "member" as const })),
    ...guests[side].map((guest) => ({ value: guestChoiceValue(guest.guest_name), label: guest.guest_name, kind: "guest" as const }))
  ];
  const memberName=(side:TeamSideKey, pid:string|null, guest:string|null)=>guest||members[side].find((m)=>m.playerProfileId===pid)?.displayName||"未入力";
  const applyChoice = (choice: string, profileKey: keyof Form, guestKey: keyof Form) => choice.startsWith("guest:") ? { [profileKey]: "", [guestKey]: choice.slice(6) } as Partial<Form> : { [profileKey]: choice, [guestKey]: "" } as Partial<Form>;
  const teamMatchStats = useMemo(() => {
    const teamRows = { team_a: emptyStatsRow(teamAName), team_b: emptyStatsRow(teamBName) };
    const playerRows = new Map<string, StatsRow>();
    const pairRows = new Map<string, StatsRow>();
    const playerInfo = (side: TeamSideKey, profileId: string | null, guestName: string | null) => ({ key: profileId ? `profile:${profileId}` : guestName ? `guest:${side}:${guestName}` : "", name: memberName(side, profileId, guestName) });
    const ensureRow = (map: Map<string, StatsRow>, key: string, name: string) => { if (!map.has(key)) map.set(key, emptyStatsRow(name)); return map.get(key)!; };
    const applyPlayers = (players: { key: string; name: string }[], scored: number, conceded: number) => { for (const player of players.filter((p) => p.key)) applyStatsResult(ensureRow(playerRows, player.key, player.name), scored, conceded); };
    const applyPair = (players: { key: string; name: string }[], scored: number, conceded: number) => { const valid = players.filter((p) => p.key); if (valid.length !== 2) return; const sorted = [...valid].sort((a, b) => a.key.localeCompare(b.key)); const key = sorted.map((p) => p.key).join("|"); const name = sorted.map((p) => p.name).join(" / "); applyStatsResult(ensureRow(pairRows, key, name), scored, conceded); };
    for (const match of matches) {
      if (!hasCountableTeamScore(match)) continue;
      const aScore = match.team_a_score!;
      const bScore = match.team_b_score!;
      applyStatsResult(teamRows.team_a, aScore, bScore);
      applyStatsResult(teamRows.team_b, bScore, aScore);
      const teamAPlayers = [playerInfo("team_a", match.team_a_player1_profile_id, match.team_a_player1_guest_name), playerInfo("team_a", match.team_a_player2_profile_id, match.team_a_player2_guest_name)];
      const teamBPlayers = [playerInfo("team_b", match.team_b_player1_profile_id, match.team_b_player1_guest_name), playerInfo("team_b", match.team_b_player2_profile_id, match.team_b_player2_guest_name)];
      applyPlayers(teamAPlayers, aScore, bScore);
      applyPlayers(teamBPlayers, bScore, aScore);
      applyPair(teamAPlayers, aScore, bScore);
      applyPair(teamBPlayers, bScore, aScore);
    }
    return { countedMatches: teamRows.team_a.matches, teams: [teamRows.team_a, teamRows.team_b], players: sortStatsRows([...playerRows.values()]), pairs: sortStatsRows([...pairRows.values()]) };
  }, [matches, members, teamAName, teamBName]);
  const toggleStatsSection = (key: StatsSectionKey) => setOpenStatsSections((prev) => ({ ...prev, [key]: !prev[key] }));
  const validate=(f:Form)=>{
    const vals=[f.a1ProfileId||f.a1GuestName.trim(),f.a2ProfileId||f.a2GuestName.trim(),f.b1ProfileId||f.b1GuestName.trim(),f.b2ProfileId||f.b2GuestName.trim()].filter(Boolean);
    if(new Set(vals).size!==vals.length) return "同一試合内で同じ選手は選択できません";
    if([f.a1ProfileId&&f.a1GuestName.trim(),f.a2ProfileId&&f.a2GuestName.trim(),f.b1ProfileId&&f.b1GuestName.trim(),f.b2ProfileId&&f.b2GuestName.trim()].some(Boolean)) return "選手は選択または自由入力のどちらかにしてください";
    if((f.aScore&&(!Number.isInteger(Number(f.aScore))||Number(f.aScore)<0))||(f.bScore&&(!Number.isInteger(Number(f.bScore))||Number(f.bScore)<0))) return "得点は0以上の整数で入力してください";
    if(f.youtubeUrl.trim()&&!isYoutubeUrl(f.youtubeUrl.trim())) return "YouTubeのURLを入力してください";
    return "";
  };
  const payload=(f:Form)=>({ team_a_player1_profile_id:f.a1ProfileId||null, team_a_player1_guest_name:f.a1GuestName.trim()||null, team_a_player2_profile_id:f.a2ProfileId||null, team_a_player2_guest_name:f.a2GuestName.trim()||null, team_b_player1_profile_id:f.b1ProfileId||null, team_b_player1_guest_name:f.b1GuestName.trim()||null, team_b_player2_profile_id:f.b2ProfileId||null, team_b_player2_guest_name:f.b2GuestName.trim()||null, team_a_score:f.aScore.trim()===""?null:Number(f.aScore), team_b_score:f.bScore.trim()===""?null:Number(f.bScore), result:f.result, score_detail:f.scoreDetail.trim()||null, memo:f.memo.trim()||null, youtube_url:f.youtubeUrl.trim()||null, updated_at:new Date().toISOString() });
  const toForm=(m:Match):Form=>({ a1ProfileId:m.team_a_player1_profile_id??"",a1GuestName:m.team_a_player1_guest_name??"",a2ProfileId:m.team_a_player2_profile_id??"",a2GuestName:m.team_a_player2_guest_name??"",b1ProfileId:m.team_b_player1_profile_id??"",b1GuestName:m.team_b_player1_guest_name??"",b2ProfileId:m.team_b_player2_profile_id??"",b2GuestName:m.team_b_player2_guest_name??"",aScore:m.team_a_score===null?"":String(m.team_a_score),bScore:m.team_b_score===null?"":String(m.team_b_score),result:m.result,scoreDetail:m.score_detail??"",memo:m.memo??"",youtubeUrl:m.youtube_url??""});

  const saveMatch=async(edit=false)=>{
    setError(""); setNotice("");
    if(!canManage||event?.status==="closed") return setError("この操作を行う権限がありません");
    const f=edit?editingForm:form;
    const v=validate(f); if(v)return setError(v);
    const supabase=getSupabaseClient(); if(!supabase)return;
    const err= edit&&editingId ? (await supabase.from("event_team_matches").update(payload(f)).eq("id",editingId)).error : (await supabase.from("event_team_matches").insert({event_id:id,match_order:Math.max(0,...matches.map((m)=>m.match_order))+1,...payload(f)})).error;
    if(err)return setError(edit?"試合カードの更新に失敗しました":"試合カードの追加に失敗しました");
    setForm(emptyForm()); setEditingId(null); setEditingForm(emptyForm()); setShowForm(false); setNotice(edit?"試合カードを更新しました":"試合カードを追加しました");
    await load();
  };
  const deleteMatch=async(mid:string)=>{ if(!window.confirm("試合カードを削除しますか？"))return; const supabase=getSupabaseClient(); if(!supabase)return; const {error:e}=await supabase.from("event_team_matches").delete().eq("id",mid); if(e)return setError("試合カードの削除に失敗しました"); setNotice("試合カードを削除しました"); await load(); };
  const updateSide=async(side:Side, clubId:string, name:string)=>{ const supabase=getSupabaseClient(); if(!supabase)return; await supabase.from("event_team_sides").update({club_id:clubId||null,team_name:name.trim()||null,updated_at:new Date().toISOString()}).eq("id",side.id); await load(); };
  const addGuest=async(side:TeamSideKey)=>{ setError(""); setNotice(""); if(!canManage||event?.status==="closed") return setError("この操作を行う権限がありません"); const guestName=guestNames[side].trim(); if(!guestName) return setError("ゲスト名を入力してください"); const supabase=getSupabaseClient(); if(!supabase)return; const { error:e }=await supabase.from("event_team_guests").insert({ event_id:id, side, guest_name:guestName }); if(e) return setError("ゲストの追加に失敗しました"); setGuestNames((prev)=>({...prev,[side]:""})); setNotice("ゲストを追加しました"); await load(); };
  const closeOrReopen=async(status:"active"|"closed")=>{
    setError(""); setNotice("");
    const supabase=getSupabaseClient(); if(!supabase)return;
    if(status==="closed"&&!window.confirm("フレンドリーチームマッチ終了しますか？"))return;
    const {error:e}=await supabase.from("events").update({status,stats_mode:status==="closed"?closeMode:"undecided",closed_at:status==="closed"?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("id",id);
    if(e){
      console.error("フレンドリーチームマッチ終了/再開に失敗しました", { message:e.message, code:e.code, details:e.details, hint:e.hint });
      return setError(status==="closed"?"終了に失敗しました":"再開に失敗しました");
    }
    setNotice(status==="closed"?"フレンドリーチームマッチを終了しました":"フレンドリーチームマッチを再開しました");
    await load();
  };
  const deleteEvent=async()=>{ if(!deleteOk)return setError("削除確認にチェックしてください"); const supabase=getSupabaseClient(); if(!supabase)return; await supabase.from("events").update({is_deleted:true,deleted_at:new Date().toISOString(),share_enabled:false,share_token:null}).eq("id",id); router.push("/team-matches/new"); };
  const share=async()=>{ const supabase=getSupabaseClient(); if(!supabase)return; await supabase.from("events").update({share_enabled:true,share_token:createShareToken(),share_token_updated_at:new Date().toISOString()}).eq("id",id); await load(); };
  const startEventNameEdit=()=>{ setError(""); setNotice(""); setEventNameDraft(event.name); setIsEditingEventName(true); };
  const cancelEventNameEdit=()=>{ setEventNameDraft(""); setIsEditingEventName(false); };
  const saveEventName=async()=>{ setError(""); setNotice(""); const nextName=eventNameDraft.trim(); if(!nextName)return setError("イベント名を入力してください"); if(nextName.length>80)return setError("イベント名は80文字以内で入力してください"); if(!canManage)return setError("この操作を行う権限がありません"); const supabase=getSupabaseClient(); if(!supabase)return; const {error:e}=await supabase.from("events").update({name:nextName,updated_at:new Date().toISOString()}).eq("id",id); if(e)return setError("更新に失敗しました"); setEvent((prev)=>prev?{...prev,name:nextName}:prev); setIsEditingEventName(false); setNotice("更新しました"); };

  if(!event) return <main className="mx-auto min-h-screen w-full max-w-md p-4 text-zinc-100">{error||"読み込み中..."}</main>;
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 text-zinc-100">
    <EditableEventTitle label="フレンドリーチームマッチ詳細" name={event.name} canEdit={canManage} isEditing={isEditingEventName} draft={eventNameDraft} onDraftChange={setEventNameDraft} onStartEdit={startEventNameEdit} onSave={()=>void saveEventName()} onCancel={cancelEventNameEdit} />
    {error&&<p className="rounded-xl border border-red-500/60 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {notice&&<p className="rounded-xl border border-emerald-500/60 bg-emerald-950/40 p-3 text-sm text-emerald-200">{notice}</p>}
    <Card title="イベント情報"><dl className="space-y-2 text-sm"><div><dt className="text-zinc-400">ステータス</dt><dd>{officialStatusLabel(event.status)}</dd></div><div><dt className="text-zinc-400">説明</dt><dd className="whitespace-pre-wrap">{event.description||"未入力"}</dd></div><div><dt className="text-zinc-400">メモ</dt><dd className="whitespace-pre-wrap">{event.memo||"未入力"}</dd></div></dl></Card>
    <Card title="チーム設定"><div className="space-y-3">{[teamA,teamB].filter(Boolean).map((s)=><SideEditor key={s!.id} side={s!} title={s!.side==="team_a"?"チームA":"チームB"} guests={guests[s!.side]} guestName={guestNames[s!.side]} setGuestName={(value)=>setGuestNames((prev)=>({...prev,[s!.side]:value}))} groups={groups} canManage={canManage&&event.status!=="closed"} onSave={updateSide} onAddGuest={()=>void addGuest(s!.side)}/>)}</div></Card>
    <Card title="開催操作"><div className="space-y-3 text-sm">{event.status==="active"&&canManage&&<><select className="w-full rounded-xl bg-zinc-800 p-3" value={closeMode} onChange={(e)=>setCloseMode(e.target.value as any)}><option value="official">戦績に反映する</option><option value="record_only">記録用にする</option></select><button className="w-full rounded-xl border border-red-500/70 py-2 font-bold text-red-200" onClick={()=>void closeOrReopen("closed")}>フレンドリーチームマッチ終了</button></>}{event.status==="closed"&&<><p>フレンドリーチームマッチ終了済み（{event.stats_mode==="record_only"?"記録用":"戦績に反映する"}）</p>{canManage&&<button className="w-full rounded-xl bg-accent py-2 font-bold text-black" onClick={()=>void closeOrReopen("active")}>フレンドリーチームマッチ再開</button>}{canManage&&(showDelete?<div className="space-y-2 rounded-xl border border-red-500/60 p-3"><label className="flex gap-2 text-xs"><input type="checkbox" checked={deleteOk} onChange={(e)=>setDeleteOk(e.target.checked)}/>削除すると元に戻せません</label><button className="w-full rounded bg-red-600 py-2 font-bold" onClick={()=>void deleteEvent()}>フレンドリーチームマッチ削除</button></div>:<button className="w-full rounded-xl border border-red-500/70 py-2 font-bold text-red-200" onClick={()=>setShowDelete(true)}>フレンドリーチームマッチ削除</button>)}</>}</div></Card>
    {event.status==="closed"&&<Card title="共有リンク"><div className="space-y-2 text-sm">{shareUrl?<><p className="break-all rounded-xl bg-zinc-800 p-3 text-xs">{shareUrl}</p><button className="w-full rounded-xl border border-zinc-500 py-2" onClick={()=>navigator.clipboard.writeText(shareUrl)}>共有リンクをコピー</button></>:canManage?<button className="w-full rounded-xl bg-accent py-2 font-bold text-black" onClick={()=>void share()}>共有リンクを作成</button>:<p>共有されていません</p>}</div></Card>}
    {event.status==="closed"&&<TeamMatchStatsCard stats={teamMatchStats} openSections={openStatsSections} onToggle={toggleStatsSection} />}
    <Card title="試合結果"><div className="space-y-3">{matches.map((m,i)=><div key={m.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-bold">第{i+1}試合</p><p>{memberName("team_a",m.team_a_player1_profile_id,m.team_a_player1_guest_name)} / {memberName("team_a",m.team_a_player2_profile_id,m.team_a_player2_guest_name)} vs {memberName("team_b",m.team_b_player1_profile_id,m.team_b_player1_guest_name)} / {memberName("team_b",m.team_b_player2_profile_id,m.team_b_player2_guest_name)}</p><p>スコア: {m.team_a_score??"未入力"} - {m.team_b_score??"未入力"}</p><p>結果: {resultLabel(m.result)}</p>{m.score_detail&&<p>詳細スコア: {m.score_detail}</p>}{m.memo&&<p className="whitespace-pre-wrap">メモ: {m.memo}</p>}{m.youtube_url&&<a className="underline" href={m.youtube_url} target="_blank" rel="noreferrer">動画視聴</a>}{canManage&&event.status!=="closed"&&<div className="mt-2 grid grid-cols-2 gap-2"><button className="rounded border border-zinc-500 py-2" onClick={()=>{setEditingId(m.id);setEditingForm(toForm(m));}}>編集</button><button className="rounded border border-red-500/70 py-2 text-red-200" onClick={()=>void deleteMatch(m.id)}>削除</button></div>}{editingId===m.id&&<MatchFormView title="試合カードを編集" form={editingForm} setForm={(p,s)=>setEditingForm((prev)=>{const n={...prev,...p}; if(s)n.result=autoResult(n.aScore,n.bScore); return n;})} applyChoice={applyChoice} teamAChoices={choices("team_a")} teamBChoices={choices("team_b")} onSave={()=>void saveMatch(true)} onCancel={()=>setEditingId(null)}/>}</div>)}{canManage&&event.status!=="closed"&&(showForm?<MatchFormView title="試合カードを追加" form={form} setForm={(p,s)=>setForm((prev)=>{const n={...prev,...p}; if(s)n.result=autoResult(n.aScore,n.bScore); return n;})} applyChoice={applyChoice} teamAChoices={choices("team_a")} teamBChoices={choices("team_b")} onSave={()=>void saveMatch(false)} onCancel={()=>setShowForm(false)}/>:<ActionButton onClick={()=>setShowForm(true)}>試合カードを追加</ActionButton>)}</div></Card>
    <Link href="/team-matches/new" className="text-center text-sm underline">フレンドリーチームマッチへ戻る</Link>
  </main>;
}

function SideEditor({side,title,groups,guests,guestName,setGuestName,canManage,onSave,onAddGuest}:{side:Side;title:string;groups:OfficialGroup[];guests:GuestOption[];guestName:string;setGuestName:(value:string)=>void;canManage:boolean;onSave:(s:Side,c:string,n:string)=>void;onAddGuest:()=>void}){
  const[mode,setMode]=useState<"group"|"free">(side.club_id?"group":"free");
  const[clubId,setClubId]=useState(side.club_id??"");
  const[name,setName]=useState(side.team_name??title);
  return <section className="space-y-3 rounded-xl bg-zinc-800 p-3"><p className="font-bold">{title}</p><select disabled={!canManage} className="w-full rounded-xl bg-zinc-900 p-3" value={mode} onChange={(e)=>{const next=e.target.value as "group"|"free"; setMode(next); if(next==="free") setClubId("");}}><option value="group">グループを選択する</option><option value="free">グループなしで入力する</option></select>{mode==="group"&&<select disabled={!canManage} className="w-full rounded-xl bg-zinc-900 p-3" value={clubId} onChange={(e)=>setClubId(e.target.value)}><option value="">グループを選択する</option>{groups.map((g)=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}<input disabled={!canManage} className="w-full rounded-xl bg-zinc-900 p-3" placeholder="チーム名" value={name} onChange={(e)=>setName(e.target.value)}/>{canManage&&<button className="w-full rounded-xl border border-zinc-500 py-2" onClick={()=>onSave(side,mode==="group"?clubId:"",name)}>保存</button>}<div className="space-y-2 rounded-xl border border-zinc-700 p-3"><p className="text-xs font-bold text-zinc-300">追加済みゲスト</p>{guests.length===0?<p className="text-xs text-zinc-400">ゲストはまだありません</p>:<ul className="space-y-1 text-sm">{guests.map((guest)=><li key={guest.id}>{guest.guest_name}</li>)}</ul>}{canManage&&<div className="flex gap-2"><input className="min-w-0 flex-1 rounded-xl bg-zinc-900 p-2" placeholder="ゲスト名" value={guestName} onChange={(e)=>setGuestName(e.target.value)}/><button className="rounded-xl bg-accent px-3 py-2 text-sm font-bold text-black" onClick={onAddGuest}>ゲストを追加</button></div>}</div></section>;
}

function MatchFormView({title,form,setForm,applyChoice,teamAChoices,teamBChoices,onSave,onCancel}:{title:string;form:Form;setForm:(p:Partial<Form>,sync?:boolean)=>void;applyChoice:(choice:string,profileKey:keyof Form,guestKey:keyof Form)=>Partial<Form>;teamAChoices:PlayerChoice[];teamBChoices:PlayerChoice[];onSave:()=>void;onCancel:()=>void}){
  const cls="w-full rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm";
  const player=(label:string,pid:keyof Form,guest:keyof Form,choices:PlayerChoice[])=><div className="space-y-1"><label className="text-xs text-zinc-300">{label}</label><select className={cls} value={selectedChoiceValue(form[pid] as string, form[guest] as string)} onChange={(e)=>setForm(applyChoice(e.target.value,pid,guest))}><option value="">選手を選択</option>{choices.map((choice)=><option key={`${choice.kind}-${choice.value}`} value={choice.value}>{choice.kind==="guest"?`ゲスト: ${choice.label}`:choice.label}</option>)}</select><input className={cls} placeholder="自由入力" value={(form[guest] as string).startsWith("guest:") ? "" : form[guest] as string} onChange={(e)=>setForm({[pid]:"",[guest]:e.target.value} as any)}/></div>;
  return <div className="space-y-3 rounded-2xl border border-zinc-700 p-3"><h4 className="font-bold">{title}</h4><section className="space-y-2"><p className="text-xs font-bold text-zinc-400">チームA</p>{player("チームA 選手1","a1ProfileId","a1GuestName",teamAChoices)}{player("チームA 選手2","a2ProfileId","a2GuestName",teamAChoices)}</section><section className="space-y-2"><p className="text-xs font-bold text-zinc-400">チームB</p>{player("チームB 選手1","b1ProfileId","b1GuestName",teamBChoices)}{player("チームB 選手2","b2ProfileId","b2GuestName",teamBChoices)}</section><div className="grid grid-cols-2 gap-2"><input className={cls} inputMode="numeric" placeholder="チームA得点" value={form.aScore} onChange={(e)=>setForm({aScore:e.target.value},true)}/><input className={cls} inputMode="numeric" placeholder="チームB得点" value={form.bScore} onChange={(e)=>setForm({bScore:e.target.value},true)}/></div><select className={cls} value={form.result} onChange={(e)=>setForm({result:e.target.value as ResultValue})}><option value="win">チームA勝ち</option><option value="lose">チームB勝ち</option><option value="draw">引き分け</option><option value="undecided">未定</option></select><input className={cls} placeholder="詳細スコア" value={form.scoreDetail} onChange={(e)=>setForm({scoreDetail:e.target.value})}/><textarea className={cls} placeholder="メモ" value={form.memo} onChange={(e)=>setForm({memo:e.target.value})}/><input className={cls} placeholder="YouTubeリンク" value={form.youtubeUrl} onChange={(e)=>setForm({youtubeUrl:e.target.value})}/><div className="grid grid-cols-2 gap-2"><button className="rounded-xl bg-accent py-2 font-bold text-black" onClick={onSave}>保存</button><button className="rounded-xl border border-zinc-500 py-2" onClick={onCancel}>キャンセル</button></div></div>;
}


const teamStatsButtonClass = "flex min-h-12 w-full items-center rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-3 text-left text-sm font-bold text-zinc-100 shadow-sm shadow-black/20 active:bg-zinc-800";

function TeamStatsSection({ title, isOpen, onToggle, children }: { title: string; isOpen: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className="space-y-2"><button type="button" className={teamStatsButtonClass} onClick={onToggle} aria-expanded={isOpen}><span className="mr-2 text-accent">{isOpen ? "▼" : "◀"}</span><span>{title}</span></button>{isOpen && <div>{children}</div>}</section>;
}

function StatsRowsView({ rows }: { rows: StatsRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-400">集計対象の試合結果がありません</p>;
  return <div className="space-y-2">{rows.map((row) => <div key={row.name} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-bold">{row.name}</p><p className="text-zinc-300">{row.wins}勝{row.losses}敗{row.draws}分 / 勝点{row.points} / 勝率{row.winRate.toFixed(1)}% / 得失点差{row.diff >= 0 ? `+${row.diff}` : row.diff}</p><p className="text-xs text-zinc-400">{row.matches}試合 / 得点{row.scored} / 失点{row.conceded}</p></div>)}</div>;
}

function TeamMatchStatsCard({ stats, openSections, onToggle }: { stats: { countedMatches: number; teams: StatsRow[]; players: StatsRow[]; pairs: StatsRow[] }; openSections: Record<StatsSectionKey, boolean>; onToggle: (key: StatsSectionKey) => void }) {
  const emptyRows: StatsRow[] = [];
  return <Card title="戦績"><div className="space-y-3"><TeamStatsSection title="チーム戦績" isOpen={openSections.teams} onToggle={() => onToggle("teams")}><StatsRowsView rows={stats.countedMatches > 0 ? stats.teams : emptyRows} /></TeamStatsSection><TeamStatsSection title="個人戦績" isOpen={openSections.players} onToggle={() => onToggle("players")}><StatsRowsView rows={stats.players} /></TeamStatsSection><TeamStatsSection title="ペア戦績" isOpen={openSections.pairs} onToggle={() => onToggle("pairs")}><StatsRowsView rows={stats.pairs} /></TeamStatsSection></div></Card>;
}


function EditableEventTitle({ label, name, canEdit, isEditing, draft, onDraftChange, onStartEdit, onSave, onCancel }: { label: string; name: string; canEdit: boolean; isEditing: boolean; draft: string; onDraftChange: (value: string) => void; onStartEdit: () => void; onSave: () => void; onCancel: () => void }) {
  if (isEditing) return <div className="space-y-2"><label className="text-xs font-semibold text-zinc-400">{label}</label><input className="w-full rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-3 text-lg font-bold text-zinc-100 outline-none focus:border-accent" value={draft} onChange={(e)=>onDraftChange(e.target.value)} maxLength={80} autoFocus/><div className="grid grid-cols-2 gap-2"><button type="button" className="rounded-xl bg-accent py-2 text-sm font-bold text-black" onClick={onSave}>保存</button><button type="button" className="rounded-xl border border-zinc-500 py-2 text-sm text-zinc-100" onClick={onCancel}>キャンセル</button></div></div>;
  return <div className="flex items-start gap-2"><h1 className="min-w-0 flex-1 break-words text-xl font-bold">{label}：{name}</h1>{canEdit&&<button type="button" className="min-h-10 min-w-10 rounded-full bg-zinc-800/80 px-3 text-zinc-200 transition hover:bg-zinc-700 active:bg-zinc-600" onClick={onStartEdit} aria-label="イベント名を編集" title="イベント名を編集">✎</button>}</div>;
}
