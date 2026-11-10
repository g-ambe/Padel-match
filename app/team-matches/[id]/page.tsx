"use client";

import { TeamMatchShortcut } from "@/components/team-match-shortcut";
import { TeamRoundGenerator } from "@/components/team-round-generator";
import { friendlyTeamRoundError, teamCardScores, pendingTeamCard, teamCardPlayers, teamSlots, type TeamCard, type TeamSource } from "@/lib/friendly-team-rounds";
import { friendlyTeamStats, type TeamStatsRow } from "@/lib/friendly-team-results";
import { readTeamAttendance, teamAbsent, type TeamAttendance } from "@/lib/team-attendance";
import { TeamPlayerPicker, type TeamPlayerChoice } from "@/components/team-player-picker";
import { TeamMatchCards } from "@/components/team-match-cards";
import { AppDialog } from "@/components/app-dialog";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { ActionButton, Card } from "@/components/ui";
import { GuestName, YoutubeDisclosure } from "@/components/match-ui";
import { canAutoCreateCard, type ScorePair } from "@/lib/score-input";
import { readFriendlyRoundRows } from "@/lib/friendly-round-history";
import { ScoreInput } from "@/components/score-input";
import { useScoreSaves } from "@/components/score-save-provider";
import { MatchShareButtons } from "@/components/match-share-buttons";
import { fetchActiveClubMemberParticipants, fetchHistoricalPlayerNames, historicalPlayerName } from "@/lib/event-participants";
import { createShareToken, getOfficialAccess, officialStatusLabel, type OfficialGroup } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";
import { storedTeamShareScore } from "@/lib/match-share-text";

type ResultValue = "win" | "lose" | "draw" | "undecided";
type TeamSideKey = "team_a" | "team_b";
type MemberOption = { membershipId?: string; playerProfileId: string; displayName: string | null };
type GuestOption = { id: string; side: TeamSideKey; guest_name: string };
type PlayerChoice = TeamPlayerChoice;
type EventRow = { court_count: number; id: string; name: string; status: string; club_id: string | null; description: string | null; memo: string | null; stats_mode: string; share_enabled?: boolean | null; share_token?: string | null; created_by_auth_user_id?: string | null; is_deleted?: boolean | null };
type Side = { id: string; side: TeamSideKey; club_id: string | null; team_name: string | null };
type Match = TeamCard & {score_detail:string|null;memo:string|null;youtube_url:string|null;created_at?:string|null};
type Form = { a1ProfileId: string; a1GuestName: string; a2ProfileId: string; a2GuestName: string; b1ProfileId: string; b1GuestName: string; b2ProfileId: string; b2GuestName: string; aScore: string; bScore: string; result: ResultValue; scoreDetail: string; memo: string; youtubeUrl: string };
type StatsSectionKey = "teams" | "players" | "pairs";
type StatsRow = TeamStatsRow;

const emptyForm = (): Form => ({ a1ProfileId:"",a1GuestName:"",a2ProfileId:"",a2GuestName:"",b1ProfileId:"",b1GuestName:"",b2ProfileId:"",b2GuestName:"",aScore:"",bScore:"",result:"undecided",scoreDetail:"",memo:"",youtubeUrl:"" });
const autoResult = (a: string, b: string): ResultValue => { if (a.trim()==="" || b.trim()==="") return "undecided"; const x=Number(a), y=Number(b); if (!Number.isInteger(x)||!Number.isInteger(y)) return "undecided"; if (x>y) return "win"; if (x<y) return "lose"; return "draw"; };
const isYoutubeUrl = (v: string) => /^https:\/\/(www\.)?youtube\.com\/watch\?v=/.test(v) || /^https:\/\/youtu\.be\//.test(v) || /^https:\/\/(www\.)?youtube\.com\/shorts\//.test(v);
const guestChoiceValue = (name: string) => `guest:${name}`;
const selectedChoiceValue = (profileId: string, guestName: string) => profileId || (guestName ? guestChoiceValue(guestName) : "");

export default function FriendlyTeamMatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [groups,setGroups]=useState<OfficialGroup[]>([]);
  const [sides,setSides]=useState<Side[]>([]);
  const [members,setMembers]=useState<Record<TeamSideKey, MemberOption[]>>({ team_a: [], team_b: [] });
  const [guests,setGuests]=useState<Record<TeamSideKey, GuestOption[]>>({ team_a: [], team_b: [] });
  const [attendance,setAttendance]=useState<TeamAttendance[]|null>(null);
  const [attendanceBusy,setAttendanceBusy]=useState(false);
  const attendanceLock=useRef(false);
  const changeAttendance=async(side:TeamSideKey,player:string|null,guest:string|null,status:"active"|"absent")=>{
    if(generationBusy||attendanceLock.current||!canManage||event?.status!=="active"||scoreQueue.hasUnsaved(scoreScope)||cardBusy||videoBusy)return;
    const db=getSupabaseClient();if(!db)return;
    attendanceLock.current=true;setAttendanceBusy(true);setError("");
    try{const result=await db.rpc("set_friendly_team_attendance",{p_event:id,p_side:side,p_member:player,p_guest:guest,p_status:status});
      if(result.error)throw new Error(result.error.code==="P0001"&&result.error.message.includes("未完了カード")?"未完了カードに登録されています。カードを確認してから欠席にしてください。":"参加状態を保存できませんでした。再読み込みしてください。");
      const rows=await readTeamAttendance(db,id);setAttendance(rows);
      if(teamAbsent(rows,side,player,guest)!==(status==="absent"))throw new Error("参加状態の確認に失敗しました。");
    }catch(cause){setAttendance(null);setError(cause instanceof Error?cause.message:"参加状態の変更に失敗しました。");}
    finally{attendanceLock.current=false;setAttendanceBusy(false);}
  };
  const [matches,setMatches]=useState<Match[]>([]);
  const [historicalNames,setHistoricalNames]=useState<Map<string,string>>(new Map());
  const [form,setForm]=useState<Form>(emptyForm());
  const { queue: scoreQueue, snapshot: scoreJobs } = useScoreSaves();
  const scoreScope = `/team-matches/${id}#`;
  const cardWrites = useMemo(() => ({current:scoreQueue.writeState(scoreScope)}), [scoreQueue,scoreScope]);
  const unsavedScoreCount = Object.keys(scoreJobs).filter(key => key.startsWith(scoreScope)).length;
  const closingEvent = useRef(false), reloadAfterScores = useRef(false);
  const [isClosingEvent,setIsClosingEvent] = useState(false);
  const [cardBusy,setCardBusy]=useState(false);
  const formLock=useRef(false);
  const runFormSave=async(edit:boolean)=>{
    if(formLock.current)return;
    formLock.current=true;setCardBusy(true);
    try{await saveMatch(edit);}finally{formLock.current=false;setCardBusy(false);}
  };
  const [videoBusy,setVideoBusy]=useState<string|null>(null);
  const videoLock=useRef(false);
  const runVideoAction=async(mid:string,action:()=>Promise<unknown>)=>{
    if(videoLock.current)return;
    videoLock.current=true;setVideoBusy(mid);
    try{await action();}finally{videoLock.current=false;setVideoBusy(null);}
  };
  const [urlDrafts,setUrlDrafts] = useState<Record<string,string>>({});
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

  const [tab,setTab]=useState("matches");
  const [historyOpen,setHistoryOpen]=useState(false);
  const [generationBusy,setGenerationBusy]=useState(false);
  const [generationOpen,setGenerationOpen]=useState(false);
  const addArea=useRef<HTMLDivElement>(null), manualButton=useRef<HTMLButtonElement>(null), randomButton=useRef<HTMLButtonElement>(null);
  const pendingLatestScroll=useRef(false);
  useEffect(()=>{
    if(!pendingLatestScroll.current||showForm||generationOpen||generationBusy)return;
    let second=0;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
      if(document.querySelector('dialog[open]')||!latestHost.current?.children.length)return;
      pendingLatestScroll.current=false;
      latestHost.current.scrollIntoView({block:"start",behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?"auto":"smooth"});
    });});
    return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
  },[matches,showForm,generationOpen,generationBusy]);
  const latestHost=useRef<HTMLDivElement>(null),pastHost=useRef<HTMLDivElement>(null),expandedHost=useRef<HTMLDivElement>(null);
  const selectTab=(next:string)=>{
    if(document.querySelector('dialog[open]')) return;
    setTab(next);
  };
  const teamA = sides.find((s)=>s.side==="team_a");
  const teamB = sides.find((s)=>s.side==="team_b");
  const shareUrl = useMemo(()=> event?.status === "closed" && event.share_enabled && event.share_token && typeof window !== "undefined" ? `${window.location.origin}/share/events/${event.share_token}` : "", [event]);
  const teamAName = teamA?.team_name || "チームA";
  const teamBName = teamB?.team_name || "チームB";

  const load = async () => {
    const scoreRevision = scoreQueue.getRevision(scoreScope);
    const supabase=getSupabaseClient();
    if(!supabase) return;
    const access=await getOfficialAccess(supabase);
    setGroups(access.groups.filter((g)=>access.superUser||g.role!=="member"));
    const { data:e }=await supabase.from("events").select("id,name,status,court_count,club_id,description,memo,stats_mode,share_enabled,share_token,created_by_auth_user_id,is_deleted,event_mode").eq("id",id).eq("event_mode","team").maybeSingle();
    if(scoreRevision!==scoreQueue.getRevision(scoreScope)){await load();return;}
    const row=e as any as EventRow|null;
    if(!row || row.is_deleted){ setEvent(null); setMatches([]); setError("フレンドリーチームマッチが見つかりません"); return; }
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
    const sideIds=sideRows.map(s=>s.club_id).filter((id):id is string=>!!id);
    if(sideIds.length){const result=await supabase.from("clubs").select("id,name").in("id",sideIds); if(result.error)setError("チームのグループ名を取得できませんでした");else setGroups(previous=>[...new Map([...previous,...(result.data??[]).map(g=>({...g,role:"member" as const}))].map(g=>[g.id,g])).values()]);}
    const loadedMembers: Record<TeamSideKey, MemberOption[]>={team_a:[],team_b:[]};
    for (const side of sideRows) if (side.club_id) {
      const roster=await fetchActiveClubMemberParticipants(supabase, side.club_id);
      const membership=await supabase.from("club_members").select("id,player_profile_id,profile_id").eq("club_id",side.club_id).eq("is_active",true);
      if(membership.error)throw membership.error;
      loadedMembers[side.side]=roster.map(m=>({...m,membershipId:membership.data?.find(cm=>(cm.player_profile_id??cm.profile_id)===m.playerProfileId)?.id}));
    }
    setMembers(loadedMembers);
    const { data:guestRows }=await supabase.from("event_team_guests").select("id,side,guest_name").eq("event_id",id).order("created_at", { ascending: true });
    const nextGuests: Record<TeamSideKey, GuestOption[]> = { team_a: [], team_b: [] };
    for (const guest of ((guestRows ?? []) as GuestOption[])) nextGuests[guest.side].push(guest);
    setGuests(nextGuests);
    try{setAttendance(await readTeamAttendance(supabase,id));}catch(cause){setAttendance(null);setError(cause instanceof Error?cause.message:"参加状態を取得できませんでした。");}
    const { data:ms,error:historyError }=await readFriendlyRoundRows((start,end)=>supabase.from("event_team_matches").select("*").eq("event_id",id).order("match_order").order("created_at").order("id").range(start,end));
    if(historyError){setError("試合履歴を取得できませんでした。再度読み込んでください");return;}
    const matchRows=(ms??[]) as Match[];
    if(scoreRevision!==scoreQueue.getRevision(scoreScope)){await load();return;}
    setMatches(previous => matchRows.filter(row => ![...cardWrites.current.newIds.values()].includes(row.id)).map(row => {
      if (!scoreQueue.has(`${scoreScope}${row.id}`)) return row;
      const confirmed = previous.find(match => match.id === row.id);
      return { ...row, team_a_score: confirmed?.team_a_score ?? null, team_b_score: confirmed?.team_b_score ?? null, result: confirmed?.result ?? "undecided",pair_1_score:confirmed?.pair_1_score??null,pair_2_score:confirmed?.pair_2_score??null,pair_result:confirmed?.pair_result??null };
    }));
    try { setHistoricalNames(await fetchHistoricalPlayerNames(supabase,matchRows.flatMap(match=>[match.team_a_player1_profile_id,match.team_a_player2_profile_id,match.team_b_player1_profile_id,match.team_b_player2_profile_id]))); }
    catch { setError("過去の試合の選手名を取得できませんでした"); }
  };
  useEffect(()=>{void load();},[id]);
  useEffect(() => {
    if (unsavedScoreCount) reloadAfterScores.current = true;
    else if (reloadAfterScores.current) { reloadAfterScores.current = false; void load().catch(() => setError("保存後の再読み込みに失敗しました")); }
  }, [unsavedScoreCount]);

  const choices = (side: TeamSideKey): PlayerChoice[] => [
    ...members[side].filter(member=>attendance!==null&&!teamAbsent(attendance,side,member.membershipId??null,null)).map((member) => ({ value: member.playerProfileId, label: member.displayName ?? "名称未設定", kind: "member" as const })),
    ...guests[side].filter(guest=>attendance!==null&&!teamAbsent(attendance,side,null,guest.id)).map((guest) => ({ value: guestChoiceValue(guest.guest_name), label: guest.guest_name, kind: "guest" as const }))
  ];
  const memberName=(side:TeamSideKey, pid:string|null, guest:string|null)=>historicalPlayerName(pid,guest,historicalNames,members[side].find((m)=>m.playerProfileId===pid)?.displayName);
  const applyChoice = (choice: string, profileKey: keyof Form, guestKey: keyof Form) => choice.startsWith("guest:") ? { [profileKey]: "", [guestKey]: choice.slice(6) } as Partial<Form> : { [profileKey]: choice, [guestKey]: "" } as Partial<Form>;
  const teamMatchStats = useMemo(() => friendlyTeamStats(matches,[teamAName,teamBName],memberName,(source,name)=>{const guest=guests[source].find(g=>g.guest_name===name);return guest?`guest:${guest.id}`:undefined;}), [matches, members, guests, historicalNames, teamAName, teamBName]);
  const cardScoreNames=(m:Match)=>{const players=teamCardPlayers(m).map(p=>({name:memberName(p.source,p.profile_id,p.name||null)+(m.generation_mode==="mixed"?` (${p.source==="team_a"?teamAName:teamBName})`:""),guest:!!p.name&&!p.profile_id,...(m.generation_mode==="mixed"?{source:p.source}:{})}));return [players.slice(0,2),players.slice(2,4)] as [typeof players,typeof players];};
  const toggleStatsSection = (key: StatsSectionKey) => setOpenStatsSections((prev) => ({ ...prev, [key]: !prev[key] }));
  const validate=(f:Form,existing?:Match)=>{
    const pids=[f.a1ProfileId,f.a2ProfileId,f.b1ProfileId,f.b2ProfileId],names=[f.a1GuestName,f.a2GuestName,f.b1GuestName,f.b2GuestName];
    const vals=pids.map((pid,index)=>existing?.round_id?(pid?`profile:${pid}`:names[index].trim()?`guest:${existing[`${teamSlots[index]}_source_side`]}:${names[index].trim()}`:""):pid||names[index].trim()).filter(Boolean);
    if(new Set(vals).size!==vals.length) return "同一試合内で同じ選手は選択できません";
    if([f.a1ProfileId&&f.a1GuestName.trim(),f.a2ProfileId&&f.a2GuestName.trim(),f.b1ProfileId&&f.b1GuestName.trim(),f.b2ProfileId&&f.b2GuestName.trim()].some(Boolean)) return "選手は選択または自由入力のどちらかにしてください";
    if((f.aScore&&(!Number.isInteger(Number(f.aScore))||Number(f.aScore)<0))||(f.bScore&&(!Number.isInteger(Number(f.bScore))||Number(f.bScore)<0))) return "得点は0以上の整数で入力してください";
    if(f.youtubeUrl.trim()&&!isYoutubeUrl(f.youtubeUrl.trim())) return "YouTubeのURLを入力してください";
    return "";
  };
  const payload=(f:Form)=>({ team_a_player1_profile_id:f.a1ProfileId||null, team_a_player1_guest_name:f.a1GuestName.trim()||null, team_a_player2_profile_id:f.a2ProfileId||null, team_a_player2_guest_name:f.a2GuestName.trim()||null, team_b_player1_profile_id:f.b1ProfileId||null, team_b_player1_guest_name:f.b1GuestName.trim()||null, team_b_player2_profile_id:f.b2ProfileId||null, team_b_player2_guest_name:f.b2GuestName.trim()||null, team_a_score:f.aScore.trim()===""?null:Number(f.aScore), team_b_score:f.bScore.trim()===""?null:Number(f.bScore), result:f.result, score_detail:f.scoreDetail.trim()||null, memo:f.memo.trim()||null, youtube_url:f.youtubeUrl.trim()||null, updated_at:new Date().toISOString() });
  const toForm=(m:Match):Form=>({ a1ProfileId:m.team_a_player1_profile_id??"",a1GuestName:m.team_a_player1_guest_name??"",a2ProfileId:m.team_a_player2_profile_id??"",a2GuestName:m.team_a_player2_guest_name??"",b1ProfileId:m.team_b_player1_profile_id??"",b1GuestName:m.team_b_player1_guest_name??"",b2ProfileId:m.team_b_player2_profile_id??"",b2GuestName:m.team_b_player2_guest_name??"",aScore:teamCardScores(m).a===null?"":String(teamCardScores(m).a),bScore:teamCardScores(m).b===null?"":String(teamCardScores(m).b),result:teamCardScores(m).result,scoreDetail:m.score_detail??"",memo:m.memo??"",youtubeUrl:m.youtube_url??""});

  const saveMatch=async(edit=false, supplied?:Form, suppliedId?:string)=>{
    const targetId=suppliedId??editingId;
    const key=edit?targetId??"":`new:${id}`;
    if(cardWrites.current.saving.has(key))return false;
    setError(""); setNotice("");
    const fail=(message:string)=>{cardWrites.current.error=message;setError(message);return false;};
    if(closingEvent.current)return fail("イベントの終了処理中です");
    if(!event)return fail("イベント情報を取得できていません");
    if(!canManage||event.status==="closed")return fail("この操作を行う権限がありません");
    const f=supplied??(edit?editingForm:form),previous=edit?matches.find(m=>m.id===targetId):undefined;
    const v=validate(f,previous);if(v)return fail(v);
    const supabase=getSupabaseClient(); if(!supabase)return fail("保存の準備ができませんでした");
    const lineup=(value:Form)=>[value.a1ProfileId,value.a1GuestName,value.a2ProfileId,value.a2GuestName,value.b1ProfileId,value.b1GuestName,value.b2ProfileId,value.b2GuestName];
    if(!previous||JSON.stringify(lineup(f))!==JSON.stringify(lineup(toForm(previous)))){
      try{const rows=await readTeamAttendance(supabase,id);setAttendance(rows);
        const pids=[f.a1ProfileId,f.a2ProfileId,f.b1ProfileId,f.b2ProfileId],names=[f.a1GuestName,f.a2GuestName,f.b1GuestName,f.b2GuestName];
        for(const [index,slot] of teamSlots.entries()){
          const source=previous?.[`${slot}_source_side`]??(index<2?"team_a":"team_b");
          const member=members[source].find(m=>m.playerProfileId===pids[index]),guest=guests[source].find(g=>g.guest_name===names[index].trim());
          if(teamAbsent(rows,source,member?.membershipId??null,guest?.id??null))return fail("欠席者は選択できません。参加状態を確認してください。");
        }
      }catch{return fail("参加状態を取得できないため保存していません。再読み込みしてください。");}
    }
    cardWrites.current.saving.add(key);
    try {
      const newId=edit?targetId:cardWrites.current.newIds.get(key)??crypto.randomUUID();
      if(!newId)return fail("試合カードを確認できません");
      if(!edit)cardWrites.current.newIds.set(key,newId);
      const patch=payload(f);
      let response;
      if(previous?.round_id){
        const generatedPatch:Record<string,unknown>={...patch};
        for(const slot of teamSlots){const source=previous[`${slot}_source_side`]!;generatedPatch[`${slot}_guest_id`]=generatedPatch[`${slot}_profile_id`]?null:previous[`${slot}_guest_name`]===generatedPatch[`${slot}_guest_name`]?previous[`${slot}_guest_id`]??null:guests[source].find(g=>g.guest_name===generatedPatch[`${slot}_guest_name`])?.id??null;}
        response=await supabase.rpc("update_friendly_team_round_card",{p_event:id,p_match:newId,p_expected:previous,p_patch:generatedPatch});
      }else response=edit?await supabase.from("event_team_matches").update(patch).eq("id",newId).select("id").single():await supabase.from("event_team_matches").insert({id:newId,event_id:id,match_order:Math.max(0,...matches.map(m=>m.match_order))+1,...patch}).select("id").single();
      // 通信結果を受け取れなかった新規登録の再試行でも同じIDを利用する。
      if(!edit&&response.error?.code==="23505")response=await supabase.from("event_team_matches").update(patch).eq("id",newId).eq("event_id",id).select("id").single();
      if(response.error||!response.data)return fail(previous?.round_id?friendlyTeamRoundError(response.error,"試合カードの保存に失敗しました"):"試合カードの保存に失敗しました");
      const applied=previous?.round_id?response.data as Match:patch;
      if(previous?.round_id&&edit&&suppliedId&&targetId===editingId)setEditingForm(toForm(applied as Match));
      setMatches(previous=>edit?previous.map(m=>m.id===newId?{...m,...applied}:m):[...previous,{id:newId,match_order:Math.max(0,...previous.map(m=>m.match_order))+1,...patch}]);
      cardWrites.current.newIds.delete(key);
      if(!edit){pendingLatestScroll.current=true;setForm(emptyForm());setShowForm(false);}
      if(edit&&!suppliedId&&targetId===editingId){setEditingId(null);setEditingForm(emptyForm());}
      setNotice("試合カードを保存しました");
      try{await load();}catch{setError("保存後の再読み込みに失敗しました");}
      return true;
    }catch{return fail("試合カードの保存に失敗しました");}
    finally{cardWrites.current.saving.delete(key);}
  };
  const commitCardScore=async(scores:ScorePair,m?:Match)=>{
    const f=m?toForm(m):form;
    if(!await saveMatch(!!m,{...f,aScore:scores.a,bScore:scores.b,result:autoResult(scores.a,scores.b)},m?.id))throw new Error(cardWrites.current.error||"試合カードを保存できませんでした。再試行してください");
  };
  const deleteMatch=async(mid:string)=>{ if(generationBusy||scoreQueue.has(`${scoreScope}${mid}`)||closingEvent.current)return setError("スコアの保存完了・再試行後に削除してください"); if(!window.confirm("試合カードを削除しますか？"))return; const supabase=getSupabaseClient(); if(!supabase)return; const card=matches.find(m=>m.id===mid);const {error:e}=card?.round_id?await supabase.rpc("delete_friendly_team_round_card",{p_event:id,p_match:mid,p_expected:card}):await supabase.from("event_team_matches").delete().eq("id",mid); if(e)return setError("試合カードの削除に失敗しました"); setNotice("試合カードを削除しました"); await load(); };
  const updateSide=async(side:Side,name:string)=>{if(!canManage||event?.status!=="active")return;const db=getSupabaseClient();if(!db)return;const result=await db.from("event_team_sides").update({team_name:name.trim()||null,updated_at:new Date().toISOString()}).eq("id",side.id).eq("event_id",id);if(result.error)return setError("チーム名を保存できませんでした");await load();};
  const addGuest=async(side:TeamSideKey,suppliedName?:string)=>{ setError(""); setNotice(""); if(!event) return setError("イベント情報を取得できていません"); if(!canManage||event.status==="closed") return setError("この操作を行う権限がありません"); const guestName=(suppliedName??guestNames[side]).trim(); if(!guestName) return setError("ゲスト名を入力してください"); const supabase=getSupabaseClient(); if(!supabase)return; const { error:e }=await supabase.from("event_team_guests").insert({ event_id:id, side, guest_name:guestName }); if(e) return setError("ゲストの追加に失敗しました"); if(suppliedName===undefined)setGuestNames((prev)=>({...prev,[side]:""})); setNotice("ゲストを追加しました"); await load(); return true; };
  const closeOrReopen=async(status:"active"|"closed")=>{
    if(closingEvent.current||generationBusy)return;
    if(status==="closed"&&(scoreQueue.hasUnsaved(scoreScope)||cardWrites.current.saving.size))return setError("保存中・保存失敗のスコアがあります。保存完了・再試行後に終了してください");
    closingEvent.current=true;setIsClosingEvent(true);
    try {
    setError(""); setNotice("");
    if(!event) return setError("イベント情報を取得できていません");
    const supabase=getSupabaseClient(); if(!supabase)return;
    if(status==="closed"&&!window.confirm("フレンドリーチームマッチ終了しますか？"))return;
    const {error:e}=await supabase.from("events").update({status,stats_mode:status==="closed"?closeMode:"undecided",closed_at:status==="closed"?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("id",id);
    if(e){
      console.error("フレンドリーチームマッチ終了/再開に失敗しました", { message:e.message, code:e.code, details:e.details, hint:e.hint });
      return setError(status==="closed"?"終了に失敗しました":"再開に失敗しました");
    }
    scoreQueue.invalidateReads(scoreScope);setEvent(previous=>previous?{...previous,status}:previous);
    setTab(status==="closed"?"results":"matches");
    setNotice(status==="closed"?"フレンドリーチームマッチを終了しました":"フレンドリーチームマッチを再開しました");
    await load();
    }finally{closingEvent.current=false;setIsClosingEvent(false);}
  };
  const deleteEvent=async()=>{ if(!event)return setError("イベント情報を取得できていません"); if(!canManage)return setError("この操作を行う権限がありません"); if(!deleteOk)return setError("削除確認にチェックしてください"); const supabase=getSupabaseClient(); if(!supabase)return; const {error:e,count}=await supabase.from("events").update({is_deleted:true,deleted_at:new Date().toISOString(),share_enabled:false,share_token:null},{count:"exact"}).eq("id",id).eq("is_deleted",false); if(e||count!==1)return setError("フレンドリーチームマッチの削除に失敗しました"); router.push("/team-matches/new"); };
  const share=async()=>{ if(!event)return setError("イベント情報を取得できていません"); const supabase=getSupabaseClient(); if(!supabase)return; await supabase.from("events").update({share_enabled:true,share_token:createShareToken(),share_token_updated_at:new Date().toISOString()}).eq("id",id); await load(); };
  const startEventNameEdit=()=>{ if(!event){ setError("イベント情報を取得できていません"); return; } setError(""); setNotice(""); setEventNameDraft(event.name ?? ""); setIsEditingEventName(true); };
  const cancelEventNameEdit=()=>{ setEventNameDraft(""); setIsEditingEventName(false); };
  const saveEventName=async()=>{ setError(""); setNotice(""); if(!event)return setError("イベント情報を取得できていません"); const nextName=eventNameDraft.trim(); if(!nextName)return setError("イベント名を入力してください"); if(nextName.length>80)return setError("イベント名は80文字以内で入力してください"); if(!canManage)return setError("この操作を行う権限がありません"); const supabase=getSupabaseClient(); if(!supabase)return; const {error:e}=await supabase.from("events").update({name:nextName,updated_at:new Date().toISOString()}).eq("id",id); if(e){ console.error("イベント名の更新に失敗しました", { message:e.message, code:e.code, details:e.details, hint:e.hint }); return setError("更新に失敗しました"); } setEvent((prev)=>prev?{...prev,name:nextName}:prev); setIsEditingEventName(false); setNotice("更新しました"); };

  if(!event) return <main className="mx-auto min-h-screen w-full max-w-md p-4 text-zinc-100">{error||"読み込み中..."}</main>;
  const knownNames=Object.fromEntries([...historicalNames,...[...members.team_a,...members.team_b].map(m=>[m.playerProfileId,m.displayName??"名称未設定"] as const),...[...guests.team_a,...guests.team_b].map(g=>[guestChoiceValue(g.guest_name),g.guest_name] as const)]);
  const reverseMatches=[...matches].reverse();
  const focusRoundId=reverseMatches[0]?.round_id??reverseMatches.find(m=>m.round_id&&pendingTeamCard(m))?.round_id;
  const latestCount=focusRoundId?Math.max(2,reverseMatches.findLastIndex(m=>m.round_id===focusRoundId)+1):2;
  const eventSides = [teamA, teamB].filter((side): side is Side => Boolean(side));
  return <main data-friendly-scoreboard className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 pb-20 text-zinc-100">
    <TeamMatchShortcut enabled={tab==="matches"&&canManage&&event.status!=="closed"} buttons={[manualButton,randomButton]} onClick={()=>addArea.current?.scrollIntoView({block:"center",behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?"auto":"smooth"})}/>
    <EditableEventTitle label="開催" name={event.name} canEdit={canManage} isEditing={isEditingEventName} draft={eventNameDraft} onDraftChange={setEventNameDraft} onStartEdit={startEventNameEdit} onSave={()=>void saveEventName()} onCancel={cancelEventNameEdit} />
    <p className="text-xs text-zinc-400">{officialStatusLabel(event.status)} · フレンドリーチーム戦</p>
    <div className="grid grid-cols-2 gap-2 text-sm"><p className="rounded-xl border border-emerald-700 p-2">{teamAName}</p><p className="rounded-xl border border-blue-700 p-2">{teamBName}</p></div>
    {attendance===null&&<button type="button" className="min-h-11 text-sm underline" onClick={()=>void load()}>参加状態を再読み込み</button>}
    {unsavedScoreCount>0&&<p role="status" className="text-sm text-amber-300">保存中・保存失敗のスコア：{unsavedScoreCount}件</p>}
    <div role="tablist" aria-label="チーム戦詳細" className="grid grid-cols-3 border-b border-zinc-700">{[["matches","対戦"],["teams","チーム"],["results","結果"]].map(([key,label])=><button key={key} id={`team-tab-${key}`} type="button" role="tab" aria-selected={tab===key} aria-controls={`team-panel-${key}`} className={`min-h-11 border-b-2 text-sm font-bold ${tab===key?"border-accent text-accent":"border-transparent text-zinc-400"}`} onClick={()=>selectTab(key)}>{label}</button>)}</div>
    {error&&<p className="rounded-xl border border-red-500/60 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {notice&&<p className="rounded-xl border border-emerald-500/60 bg-emerald-950/40 p-3 text-sm text-emerald-200">{notice}</p>}
    <section id="team-panel-matches" role="tabpanel" aria-labelledby="team-tab-matches" hidden={tab!=="matches"} className="space-y-3">
    {canManage&&event.status!=="closed"&&<div ref={addArea} className="space-y-2 rounded-xl border border-zinc-700 p-3">
      <h2 className="text-sm font-bold">試合を追加</h2>
      <div className="grid grid-cols-2 gap-2">{([["manual","手動で追加","選手4名を選ぶ"],["random","乱数で生成","対決・混合を編成"]] as const).map(([kind,label,detail])=><button key={kind} ref={kind==="manual"?manualButton:randomButton} type="button" disabled={generationBusy||cardBusy||attendanceBusy||attendance===null||isClosingEvent||!!videoBusy||!!editingId||(kind==="random"&&unsavedScoreCount>0)} className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-zinc-600 bg-zinc-800 p-2 text-left disabled:opacity-40" onClick={()=>kind==="manual"?setShowForm(true):setGenerationOpen(true)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5 shrink-0 text-accent">{kind==="manual"?<path d="M12 4v16M4 12h16"/>:<><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" strokeLinecap="round" strokeWidth="3"/></>}</svg><span className="min-w-0"><span className="block text-sm font-bold">{label}</span><span className="block text-[10px] text-zinc-400">{detail}</span></span>
      </button>)}</div>
    </div>}
    {canManage&&event.status!=="closed"&&<TeamRoundGenerator open={generationOpen} onClose={()=>setGenerationOpen(false)} eventId={id} teamNames={[teamAName,teamBName]} counts={[choices("team_a").length,choices("team_b").length]} courtCount={event.court_count||1} disabled={showForm||!!editingId||isClosingEvent||cardBusy||attendanceBusy||!!videoBusy||unsavedScoreCount>0||attendance===null} onBusyChange={setGenerationBusy} onSaved={async()=>{scoreQueue.invalidateReads(scoreScope);await load();pendingLatestScroll.current=true;}}/>}
    {canManage&&event.status!=="closed"&&showForm&&<MatchFormView knownNames={knownNames} teamNames={[teamAName,teamBName]} onAddGuest={(side,name)=>addGuest(side,name)} saveKey={`${scoreScope}new:${id}`} disabled={generationBusy||isClosingEvent||cardBusy||attendanceBusy} title="試合カードを追加" newCard saveError={error} form={form} setForm={(p,s)=>setForm(prev=>{const n={...prev,...p};if(s)n.result=autoResult(n.aScore,n.bScore);return n;})} applyChoice={applyChoice} teamAChoices={choices("team_a")} teamBChoices={choices("team_b")} onScoreCommit={scores=>commitCardScore(scores)} onSave={()=>void runFormSave(false)} onCancel={()=>setShowForm(false)}/>}
    <div ref={latestHost} className="scroll-mt-4 space-y-2" />
    <details className="group/history rounded-xl border border-zinc-700"><summary className="flex min-h-11 list-none items-center gap-2 px-3 [&::-webkit-details-marker]:hidden"><span className="event-disclosure-icon"><span className="group-open/history:hidden">▶</span><span className="hidden group-open/history:inline">▼</span></span>過去の試合 · {Math.max(0,matches.length-latestCount)}件</summary><div ref={pastHost} className="max-h-[50dvh] space-y-2 overflow-y-auto p-2" /></details>
    <button type="button" aria-label="全試合履歴を拡大" className="min-h-11 min-w-11 rounded-xl border border-zinc-600 px-3 text-sm text-zinc-200" onClick={()=>setHistoryOpen(true)}>全試合を表示</button>
    <details className="group/manage rounded-xl border border-zinc-700"><summary className="flex min-h-11 list-none items-center gap-2 px-3 [&::-webkit-details-marker]:hidden"><span className="event-disclosure-icon"><span className="group-open/manage:hidden">▶</span><span className="hidden group-open/manage:inline">▼</span></span>開催管理</summary><div className="space-y-3 p-2">    <Card title="イベント情報"><dl className="space-y-2 text-sm"><div><dt className="text-zinc-400">ステータス</dt><dd>{officialStatusLabel(event.status)}</dd></div><div><dt className="text-zinc-400">説明</dt><dd className="whitespace-pre-wrap">{event.description||"未入力"}</dd></div><div><dt className="text-zinc-400">メモ</dt><dd className="whitespace-pre-wrap">{event.memo||"未入力"}</dd></div></dl></Card>
    <Card title="開催操作"><div className="space-y-3 text-sm">{unsavedScoreCount>0&&<p role="status" className="text-xs text-amber-300">保存中・保存失敗のスコアが{unsavedScoreCount}件あります。保存完了・再試行後に終了できます。</p>}{event.status==="active"&&canManage&&<><select className="w-full rounded-xl bg-zinc-800 p-3" value={closeMode} onChange={(e)=>setCloseMode(e.target.value as any)}><option value="official">戦績に反映する</option><option value="record_only">記録用にする</option></select><button className="w-full rounded-xl border border-red-500/70 py-2 font-bold text-red-200" disabled={generationBusy||isClosingEvent||unsavedScoreCount>0} onClick={()=>void closeOrReopen("closed")}>フレンドリーチームマッチ終了</button></>}{event.status==="closed"&&<><p>フレンドリーチームマッチ終了済み（{event.stats_mode==="record_only"?"記録用":"戦績に反映する"}）</p>{canManage&&<button className="w-full rounded-xl bg-accent py-2 font-bold text-black" onClick={()=>void closeOrReopen("active")}>フレンドリーチームマッチ再開</button>}{canManage&&(showDelete?<div className="space-y-2 rounded-xl border border-red-500/60 p-3"><label className="flex gap-2 text-xs"><input type="checkbox" checked={deleteOk} onChange={(e)=>setDeleteOk(e.target.checked)}/>削除すると元に戻せません</label><button className="w-full rounded bg-red-600 py-2 font-bold" onClick={()=>void deleteEvent()}>フレンドリーチームマッチ削除</button></div>:<button className="w-full rounded-xl border border-red-500/70 py-2 font-bold text-red-200" onClick={()=>setShowDelete(true)}>フレンドリーチームマッチ削除</button>)}</>}</div></Card>
</div></details>
    </section>
    <section id="team-panel-teams" role="tabpanel" aria-labelledby="team-tab-teams" hidden={tab!=="teams"} className="space-y-3">    <Card title="チーム設定"><div className="space-y-3">{eventSides.map((side)=><SideEditor key={side.id} side={side} title={side.team_name||(side.side==="team_a"?"チームA":"チームB")} roster={members[side.side]} guests={guests[side.side]} guestName={guestNames[side.side]} setGuestName={(value)=>setGuestNames((prev)=>({...prev,[side.side]:value}))} groups={groups} attendance={attendance} busy={generationBusy||attendanceBusy||cardBusy||!!videoBusy||unsavedScoreCount>0} onAttendance={(pid,gid,status)=>void changeAttendance(side.side,pid,gid,status)} canManage={canManage&&event.status!=="closed"} onSave={updateSide} onAddGuest={()=>void addGuest(side.side)}/>)}</div></Card>
</section>
    <section id="team-panel-results" role="tabpanel" aria-labelledby="team-tab-results" hidden={tab!=="results"} className="space-y-3">    {event.status==="closed"&&<TeamMatchStatsCard stats={teamMatchStats} openSections={openStatsSections} onToggle={toggleStatsSection} />}
    {event.status==="closed"&&<Card title="共有リンク"><div className="space-y-2 text-sm">{shareUrl?<><p className="break-all rounded-xl bg-zinc-800 p-3 text-xs">{shareUrl}</p><button className="w-full rounded-xl border border-zinc-500 py-2" onClick={()=>navigator.clipboard.writeText(shareUrl)}>共有リンクをコピー</button></>:canManage?<button className="w-full rounded-xl bg-accent py-2 font-bold text-black" onClick={()=>void share()}>共有リンクを作成</button>:<p>共有されていません</p>}
      <MatchShareButtons event={event} eventName={event.name} kind="events" getMatches={() => matches.map(match => ({
        teamA: cardScoreNames(match)[0].map((p,i)=>teamCardPlayers(match)[i].key?p.name:null),
        teamB: cardScoreNames(match)[1].map((p,i)=>teamCardPlayers(match)[i+2].key?p.name:null),
        score: storedTeamShareScore(teamCardScores(match).a, teamCardScores(match).b, teamCardScores(match).result),
        youtubeUrl: match.youtube_url,
      }))} />
    </div></Card>}
{event.status!=="closed"&&<p className="text-sm text-zinc-400">戦績は開催終了後に表示されます。</p>}</section>
    <AppDialog open={historyOpen} title="全試合履歴" wide onClose={()=>setHistoryOpen(false)}><div ref={expandedHost} className="min-h-0 space-y-2 overflow-y-auto p-3" /></AppDialog>
    <TeamMatchCards cards={[...matches].reverse().map(m=>({id:m.id,content:(<div key={m.id} className="rounded-xl bg-zinc-800 p-3 text-sm">
      <p className="text-xs font-bold">{m.round_id?`第${m.round_number}ラウンド · コート${m.court_number} · ${m.generation_mode==="mixed"?"チーム混合":"チーム対決"}`:`第${m.match_order}試合`}</p>
      <ScoreInput compact mixed={m.generation_mode==="mixed"} pairLabels={m.generation_mode==="mixed"?["ペア1","ペア2"]:[teamAName,teamBName]} saveKey={`${scoreScope}${m.id}`} names={cardScoreNames(m)} value={{a:teamCardScores(m).a===null?"":String(teamCardScores(m).a),b:teamCardScores(m).b===null?"":String(teamCardScores(m).b)}} saved={!pendingTeamCard(m)} result={pendingTeamCard(m)?null:teamCardScores(m).result==="win"?"A":teamCardScores(m).result==="lose"?"B":teamCardScores(m).result==="draw"?"draw":null} disabled={generationBusy||!canManage||event.status==="closed"||isClosingEvent||videoBusy!==null} onCommit={async scores=>{if(editingId===m.id){if(!await saveMatch(true,{...editingForm,aScore:scores.a,bScore:scores.b,result:autoResult(scores.a,scores.b)},m.id))throw new Error(cardWrites.current.error||"保存できませんでした");}else await commitCardScore(scores,m);}} />
      {m.score_detail&&<p>詳細スコア: {m.score_detail}</p>}{m.memo&&<p className="whitespace-pre-wrap">メモ: {m.memo}</p>}
      <YoutubeDisclosure compact closable busy={videoBusy===m.id||isClosingEvent||scoreJobs[`${scoreScope}${m.id}`]?.status==="saving"||cardWrites.current.saving.has(m.id)} registered={!!m.youtube_url}>{m.youtube_url&&<a href={m.youtube_url} target="_blank" rel="noreferrer" className="underline">動画視聴</a>}{canManage&&event.status!=="closed"&&<><input className="w-full rounded bg-zinc-700 p-2" placeholder="YouTubeリンク" value={urlDrafts[m.id]??m.youtube_url??""} onChange={e=>setUrlDrafts(previous=>({...previous,[m.id]:e.target.value}))} /><div className="flex gap-2"><button className="flex-1 rounded border border-zinc-500 py-2 text-xs disabled:opacity-40" disabled={generationBusy||cardBusy||videoBusy!==null||scoreQueue.has(`${scoreScope}${m.id}`)||isClosingEvent} onClick={()=>void runVideoAction(m.id,()=>saveMatch(true,{...toForm(m),youtubeUrl:urlDrafts[m.id]??m.youtube_url??""},m.id))}>URLを保存</button>{m.youtube_url&&<button className="flex-1 rounded border border-red-500 py-2 text-xs text-red-300 disabled:opacity-40" disabled={generationBusy||cardBusy||videoBusy!==null||scoreQueue.has(`${scoreScope}${m.id}`)||isClosingEvent} onClick={()=>void runVideoAction(m.id,async()=>{if(await saveMatch(true,{...toForm(m),youtubeUrl:""},m.id))setUrlDrafts(previous=>({...previous,[m.id]:""}));})}>URLを削除</button>}</div></>}</YoutubeDisclosure>
      {canManage&&event.status!=="closed"&&<div className="mt-2 flex gap-2"><button className="min-h-11 flex-1 rounded border border-zinc-500 py-2 text-xs text-zinc-200" disabled={generationBusy||cardBusy||videoBusy!==null||scoreJobs[`${scoreScope}${m.id}`]?.status==="saving"||isClosingEvent} onClick={()=>{setEditingId(m.id);setEditingForm(toForm(m));}}>カード編集</button><button className="min-h-11 rounded border border-red-500/70 px-3 py-2 text-xs text-red-200" disabled={generationBusy||cardBusy||videoBusy!==null||scoreQueue.has(`${scoreScope}${m.id}`)||isClosingEvent} onClick={()=>void deleteMatch(m.id)}>削除</button></div>}
      {editingId===m.id&&<MatchFormView knownNames={knownNames} teamNames={[teamAName,teamBName]} onAddGuest={(side,name)=>addGuest(side,name)} showScore={false} saveKey={`${scoreScope}${m.id}`} disabled={generationBusy||isClosingEvent||cardBusy||attendanceBusy} title="試合カードを編集" slotSources={m.round_id?teamCardPlayers(m).map(p=>p.source):undefined} mixed={m.generation_mode==="mixed"} form={editingForm} setForm={(p,s)=>setEditingForm(prev=>{const n={...prev,...p};if(s)n.result=autoResult(n.aScore,n.bScore);return n;})} applyChoice={applyChoice} teamAChoices={choices("team_a")} teamBChoices={choices("team_b")} onScoreCommit={async scores=>{if(!await saveMatch(true,{...editingForm,aScore:scores.a,bScore:scores.b,result:autoResult(scores.a,scores.b)}))throw new Error(cardWrites.current.error||"保存できませんでした。再試行してください");}} onSave={()=>void runFormSave(true)} onCancel={()=>setEditingId(null)} />}
    </div>)}))} latestCount={latestCount} latestHost={latestHost} pastHost={pastHost} expandedHost={expandedHost} expanded={historyOpen} />
    <Link href="/team-matches/new" className="text-center text-sm underline">フレンドリーチームマッチへ戻る</Link>
  </main>;
}

function SideEditor({side,title,groups,roster,guests,guestName,setGuestName,canManage,onSave,onAddGuest,attendance,busy,onAttendance}:{side:Side;title:string;groups:OfficialGroup[];roster:MemberOption[];guests:GuestOption[];guestName:string;setGuestName:(value:string)=>void;canManage:boolean;onSave:(s:Side,n:string)=>void;onAddGuest:()=>void;attendance:TeamAttendance[]|null;busy:boolean;onAttendance:(pid:string|null,gid:string|null,status:"active"|"absent")=>void}){
  const [name,setName]=useState(side.team_name??title);
  const row=(key:string,label:string,pid:string|null,gid:string|null)=>{
    const absent=attendance!==null&&teamAbsent(attendance,side.side,pid,gid);
    return <li key={key} className="flex min-h-11 items-center justify-between gap-2 border-b border-zinc-700 py-1 text-sm"><span className="min-w-0 break-words"><GuestName name={label} guest={!!gid}/></span><span className="flex shrink-0 items-center gap-2"><span className="text-xs">{attendance===null?"未確認":absent?"欠席":"参加"}</span>{canManage&&<button type="button" disabled={busy||attendance===null} className="min-h-11 rounded-lg border border-zinc-600 px-2 text-xs text-zinc-200 disabled:opacity-40" onClick={()=>onAttendance(pid,gid,absent?"active":"absent")}>{absent?"参加に戻す":"欠席にする"}</button>}</span></li>;
  };
  return <section data-team-roster={side.side} className={`team-roster-side ${side.side==="team_a"?"team-side-a":"team-side-b"} space-y-2 rounded-xl border p-2`}>
    <h3 className="font-bold">{title}</h3><p className="text-xs text-zinc-400">所属グループ：{groups.find(g=>g.id===side.club_id)?.name||(side.club_id?"取得できません":"グループなし")}</p>
    {canManage&&<details className="group/name"><summary className="flex min-h-11 list-none items-center gap-2 text-xs [&::-webkit-details-marker]:hidden"><span className="event-disclosure-icon"><span className="group-open/name:hidden">▶</span><span className="hidden group-open/name:inline">▼</span></span>チーム名を編集</summary><div className="flex gap-2"><input aria-label={`${title}のチーム名`} className="min-w-0 flex-1 rounded-xl bg-zinc-900 p-2" value={name} onChange={e=>setName(e.target.value)}/><button type="button" disabled={busy} className="min-h-11 rounded-lg border px-3 text-sm text-zinc-200" onClick={()=>onSave(side,name)}>保存</button></div></details>}
    <ul>{roster.map(m=>row(m.playerProfileId,m.displayName??"名称未設定",m.membershipId??null,null))}{guests.map(g=>row(g.id,g.guest_name,null,g.id))}</ul>
    {!roster.length&&!guests.length&&<p className="text-xs text-zinc-400">メンバーはまだいません</p>}
    {canManage&&<details className="group/guest"><summary className="flex min-h-11 list-none cursor-pointer items-center text-sm text-accent">＋ ゲストを追加</summary><div className="flex gap-2"><input className="min-w-0 flex-1 rounded-xl bg-zinc-900 p-2" aria-label={`${title}のゲスト名`} placeholder="ゲスト名" value={guestName} onChange={e=>setGuestName(e.target.value)}/><button type="button" disabled={busy} className="min-h-11 rounded-xl border px-3 text-sm text-zinc-200" onClick={onAddGuest}>追加</button></div></details>}
  </section>;
}

function MatchFormView({knownNames,teamNames,onAddGuest,showScore=true,saveKey,disabled=false,title,form,setForm,applyChoice,teamAChoices,teamBChoices,onSave,onCancel,onScoreCommit,newCard=false,saveError,slotSources,mixed=false}:{knownNames:Record<string,string>;teamNames:[string,string];onAddGuest:(side:TeamSideKey,name:string)=>Promise<unknown>;showScore?:boolean;saveKey:string;disabled?:boolean;newCard?:boolean;saveError?:string;slotSources?:TeamSource[];mixed?:boolean;onScoreCommit:(scores:ScorePair)=>Promise<void>;title:string;form:Form;setForm:(p:Partial<Form>,sync?:boolean)=>void;applyChoice:(choice:string,profileKey:keyof Form,guestKey:keyof Form)=>Partial<Form>;teamAChoices:PlayerChoice[];teamBChoices:PlayerChoice[];onSave:()=>void;onCancel:()=>void}){
  const autoSaveReady=!newCard||canAutoCreateCard([form.a1ProfileId||form.a1GuestName,form.a2ProfileId||form.a2GuestName,form.b1ProfileId||form.b1GuestName,form.b2ProfileId||form.b2GuestName]);
  const {queue,snapshot}=useScoreSaves(), job=snapshot[saveKey];
  const names=(side:"a"|"b",choices:PlayerChoice[])=>[1,2].map(index=>{const pid=form[`${side}${index}ProfileId` as keyof Form],guest=form[`${side}${index}GuestName` as keyof Form];return {name:choices.find(choice=>choice.value===pid)?.label||knownNames[String(pid)]||guest||"選手名未設定",guest:!pid&&!!guest};});
  const cls="w-full rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-sm";
  const values=[selectedChoiceValue(form.a1ProfileId,form.a1GuestName),selectedChoiceValue(form.a2ProfileId,form.a2GuestName),selectedChoiceValue(form.b1ProfileId,form.b1GuestName),selectedChoiceValue(form.b2ProfileId,form.b2GuestName)];
  const selected=values.filter(Boolean);
  const playerKeys=[["a1ProfileId","a1GuestName"],["a2ProfileId","a2GuestName"],["b1ProfileId","b1GuestName"],["b2ProfileId","b2GuestName"]] as const;
  const details=<details><summary className="flex min-h-11 list-none cursor-pointer items-center text-xs">{newCard?"メモ・動画":"詳細スコア・メモ・動画"}</summary>{!newCard&&<><select className={cls} value={form.result} onChange={(e)=>setForm({result:e.target.value as ResultValue})}><option value="win">{mixed?"ペア1":teamNames[0]}勝ち</option><option value="lose">{mixed?"ペア2":teamNames[1]}勝ち</option><option value="draw">引き分け</option><option value="undecided">未定</option></select><input className={cls} placeholder="詳細スコア" value={form.scoreDetail} onChange={(e)=>setForm({scoreDetail:e.target.value})}/></>}<textarea className={cls} placeholder="メモ" value={form.memo} onChange={(e)=>setForm({memo:e.target.value})}/><YoutubeDisclosure compact closable busy={disabled||job?.status==="saving"} registered={!!form.youtubeUrl}><input className={cls} placeholder="YouTubeリンク" value={form.youtubeUrl} onChange={(e)=>setForm({youtubeUrl:e.target.value})}/><button type="button" className="text-xs text-red-300" onClick={()=>setForm({youtubeUrl:""})}>URLを削除</button></YoutubeDisclosure></details>;
  return <fieldset disabled={disabled||job?.status==="saving"} className={newCard?"contents":"min-w-0 space-y-3 rounded-2xl border border-zinc-700 p-3"}>
    {!newCard&&<><div className="flex items-center justify-between gap-2 pr-12 sm:pr-0"><h4 className="text-sm font-bold">{title}</h4><span role="status" aria-label={`${selected.length}/4名選択済み`} className="shrink-0 text-xs text-zinc-400">{selected.length}/4名</span></div>{selected.some(value=>![...teamAChoices,...teamBChoices].some(c=>c.value===value))&&<p role="status" className="text-xs text-amber-300">参加候補外の選手が含まれています。編成を変更するときは選び直してください。</p>}</>}
    <TeamPlayerPicker teamNames={teamNames} slotSources={slotSources} groupNames={mixed?["ペア1","ペア2"]:undefined} choices={[teamAChoices,teamBChoices]} values={values} labels={[...names("a",teamAChoices),...names("b",teamBChoices)].map(player=>player.name)} disabled={disabled||job?.status==="saving"} onSelect={(slot,value)=>setForm(applyChoice(value,playerKeys[slot][0],playerKeys[slot][1]))} onAddGuest={onAddGuest} continuous={newCard} onAdd={onSave} onCancel={onCancel} saveDisabled={queue.has(saveKey)} saveError={newCard?saveError:undefined}>{newCard?details:null}</TeamPlayerPicker>
    {!newCard&&<><div className="grid grid-cols-2 gap-2"><button className="min-h-11 rounded-xl bg-accent py-2 font-bold text-black" disabled={queue.has(saveKey)} onClick={onSave}>保存</button><button className="min-h-11 rounded-xl border border-zinc-500 py-2 text-zinc-200" onClick={onCancel}>キャンセル</button></div>{showScore&&<ScoreInput compact pairLabels={teamNames} saveKey={saveKey} names={[names("a",teamAChoices),names("b",teamBChoices)]} value={{a:form.aScore,b:form.bScore}} saved={title==="試合カードを編集"&&form.result!=="undecided"&&form.aScore!==""&&form.bScore!==""} onCommit={autoSaveReady?onScoreCommit:undefined} onChange={scores=>setForm({aScore:scores.a,bScore:scores.b},true)} />}{!autoSaveReady&&<p role="status" className="text-xs text-amber-300">選手情報が未設定のため自動登録しません。得点を決定した後、カードの「保存」で登録してください。</p>}{details}</>}
  </fieldset>;
}


const teamStatsButtonClass = "flex min-h-12 w-full items-center rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-3 text-left text-sm font-bold text-zinc-100 shadow-sm shadow-black/20 active:bg-zinc-800";

function TeamStatsSection({ title, isOpen, onToggle, children }: { title: string; isOpen: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className="space-y-2"><button type="button" className={teamStatsButtonClass} onClick={onToggle} aria-expanded={isOpen}><span className="event-disclosure-icon mr-2">{isOpen ? "▼" : "▶"}</span><span>{title}</span></button>{isOpen && <div>{children}</div>}</section>;
}

function StatsRowsView({ rows }: { rows: StatsRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-400">集計対象の試合結果がありません</p>;
  return <div className="space-y-2">{rows.map((row) => <div key={row.name} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-bold">{row.name}</p><p className="text-zinc-300">{row.wins}勝{row.losses}敗{row.draws}分 / 勝点{row.points} / 勝率{row.winRate.toFixed(1)}% / 得失点差{row.diff >= 0 ? `+${row.diff}` : row.diff}</p><p className="text-xs text-zinc-400">{row.matches}試合 / 得点{row.scored} / 失点{row.conceded}</p></div>)}</div>;
}

function TeamMatchStatsCard({ stats, openSections, onToggle }: { stats: { countedMatches: number; allCountedMatches?:number; teams: StatsRow[]; players: StatsRow[]; pairs: StatsRow[] }; openSections: Record<StatsSectionKey, boolean>; onToggle: (key: StatsSectionKey) => void }) {
  const emptyRows: StatsRow[] = [];
  return <Card title="戦績"><div className="space-y-3"><TeamStatsSection title={stats.allCountedMatches!==undefined&&stats.allCountedMatches!==stats.countedMatches?"チーム戦績（対決のみ）":"チーム戦績"} isOpen={openSections.teams} onToggle={() => onToggle("teams")}><StatsRowsView rows={stats.countedMatches > 0 ? stats.teams : emptyRows} /></TeamStatsSection><TeamStatsSection title={stats.allCountedMatches!==undefined&&stats.allCountedMatches!==stats.countedMatches?"個人戦績（全試合）":"個人戦績"} isOpen={openSections.players} onToggle={() => onToggle("players")}><StatsRowsView rows={stats.players} /></TeamStatsSection><TeamStatsSection title={stats.allCountedMatches!==undefined&&stats.allCountedMatches!==stats.countedMatches?"ペア戦績（全試合）":"ペア戦績"} isOpen={openSections.pairs} onToggle={() => onToggle("pairs")}><StatsRowsView rows={stats.pairs} /></TeamStatsSection></div></Card>;
}


function EditableEventTitle({ label, name, canEdit, isEditing, draft, onDraftChange, onStartEdit, onSave, onCancel }: { label: string; name: string; canEdit: boolean; isEditing: boolean; draft: string; onDraftChange: (value: string) => void; onStartEdit: () => void; onSave: () => void; onCancel: () => void }) {
  if (isEditing) return <div className="space-y-2 pr-14 sm:pr-0"><label className="text-xs font-semibold text-zinc-400">{label}</label><input className="w-full rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-3 text-lg font-bold text-zinc-100 outline-none focus:border-accent" value={draft} onChange={(e)=>onDraftChange(e.target.value)} maxLength={80} autoFocus/><div className="grid grid-cols-2 gap-2"><button type="button" className="rounded-xl bg-accent py-2 text-sm font-bold text-black" onClick={onSave}>保存</button><button type="button" className="rounded-xl border border-zinc-500 py-2 text-sm text-zinc-100" onClick={onCancel}>キャンセル</button></div></div>;
  return <div className="flex items-start gap-2 pr-14 sm:pr-0"><h1 className="min-w-0 flex-1 break-words text-xl font-bold">{label}：{name}</h1>{canEdit&&<button type="button" className="min-h-10 min-w-10 rounded-full bg-zinc-800/80 px-3 text-zinc-200 transition hover:bg-zinc-700 active:bg-zinc-600" onClick={onStartEdit} aria-label="イベント名を編集" title="イベント名を編集">✎</button>}</div>;
}
