"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { EventResultRankings } from "@/components/event-result-rankings";
import { EventResultHistory, ResultMatchCard } from "@/components/event-result-history";
import { TeamResultDetails } from "@/components/team-result-details";
import { friendlyTeamStats } from "@/lib/friendly-team-results";
import { storedTeamShareScore } from "@/lib/match-share-text";
import { GuestName } from "@/components/match-ui";
import { teamCardScores, teamCardPlayers } from "@/lib/friendly-team-rounds";
import { SharedPageHeader } from "@/components/shared-page-header";
import { getSupabaseClient } from "@/lib/supabase";
import { getSharedEventClient } from "@/lib/shared-event-client";
import { firstMatchResult, hasEnteredFriendlyMatchScore } from "@/lib/friendly-match-results";

type Row = { name: string; played: number; wins: number; losses: number; draws: number; scored: number; conceded: number; winRate: number; diff: number; matchPoints: number };

const formatRecord = (wins: number, losses: number, draws: number) => `${wins}勝${losses}敗${draws}分`;
type EventVideoLink = { id: string; title: string; video_url: string; memo: string | null; display_order: number };

export default function SharedEventPage() {
  const { token } = useParams<{ token: string }>();
  const [eventName, setEventName] = useState("-");
  const [eventDate, setEventDate] = useState("-");
  const [participants, setParticipants] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [eventVideoLinks, setEventVideoLinks] = useState<EventVideoLink[]>([]);
  const [isTeamEvent, setIsTeamEvent] = useState(false);
  const [teamSides, setTeamSides] = useState<any[]>([]);
  const [teamMatches, setTeamMatches] = useState<any[]>([]);
  const [teamGuests,setTeamGuests]=useState<any[]>([]);
  const [teamProfileNames,setTeamProfileNames]=useState<Record<string,string>>({});
  const [error, setError] = useState("");

  useEffect(() => { void (async () => {
    const supabase = getSharedEventClient(token);
    if (!supabase) return setError("この共有リンクは無効です");
    const logSharedLoadError = (label: string, error: any) => {
      console.error(label, { message: error?.message, code: error?.code, details: error?.details, hint: error?.hint });
    };
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,name,created_at,status,is_deleted,share_enabled,club_id,event_mode")
      .eq("share_token", token)
      .eq("share_enabled", true)
      .eq("status", "closed")
      .or("is_deleted.is.null,is_deleted.eq.false")
      .maybeSingle();
    if (eventError) {
      logSharedLoadError("共有イベントの取得に失敗しました", eventError);
      return setError("共有イベントが見つかりません");
    }
    if (!event) return setError("この共有リンクは無効です");
    setEventName(event.name ?? "-");
    setEventDate(event.created_at ? new Date(event.created_at).toLocaleDateString("ja-JP") : "-");
    setIsTeamEvent(event.event_mode === "team");
    if (event.event_mode === "team") {
      const { data: sides, error: sidesError } = await supabase.from("event_team_sides").select("side,team_name,club_id").eq("event_id", event.id);
      if (sidesError) logSharedLoadError("フレンドリーチームマッチ共有チーム取得に失敗しました", sidesError);
      const { data: cards, error: cardsError } = await supabase.from("event_team_matches").select("*").eq("event_id", event.id).order("match_order", { ascending: true }).order("created_at", { ascending: true });
      if (cardsError) logSharedLoadError("フレンドリーチームマッチ共有試合取得に失敗しました", cardsError);
      setTeamSides(sides ?? []);
      setTeamMatches(cards ?? []);
      const guestRows=await supabase.from("event_team_guests").select("id,side,guest_name").eq("event_id",event.id);
      if(guestRows.error)return setError("共有チームの戦績を取得できませんでした");
      setTeamGuests(guestRows.data??[]);
      const ids=[...new Set((cards??[]).flatMap(c=>teamCardPlayers(c).flatMap(p=>p.profile_id?[p.profile_id]:[])))];
      const profileNames:Record<string,string>={};
      for(let start=0;start<ids.length;start+=100){const result=await supabase.from("player_profiles").select("id,display_name").in("id",ids.slice(start,start+100));for(const p of result.data??[])profileNames[p.id]=p.display_name??"選手";}
      setTeamProfileNames(profileNames);
    }
    const { data: pt, error: participantsError } = await supabase.from("event_participants").select("id,guest_name,participant_type,player_profile_id,profile_id").eq("event_id", event.id);
    if (participantsError) logSharedLoadError("共有イベント参加者の取得に失敗しました", participantsError);
    const rows = pt ?? [];
    const playerProfileIds = rows.map((r: any) => r.player_profile_id).filter(Boolean);
    const profileIds = rows.map((r: any) => r.profile_id).filter(Boolean);
    const { data: pps, error: playerProfilesError } = playerProfileIds.length ? await supabase.from("player_profiles").select("id,display_name").in("id", playerProfileIds) : { data: [] as any[], error: null as any };
    if (playerProfilesError) logSharedLoadError("共有イベント選手名の取得に失敗しました", playerProfilesError);
    const { data: ps, error: profilesError } = profileIds.length ? await supabase.from("profiles").select("id,display_name").in("id", profileIds) : { data: [] as any[], error: null as any };
    if (profilesError) logSharedLoadError("共有イベントプロフィール名の取得に失敗しました", profilesError);
    const ppm = new Map((pps ?? []).map((x: any) => [x.id, x.display_name]));
    const pm = new Map((ps ?? []).map((x: any) => [x.id, x.display_name]));
    setParticipants(rows.map((r: any) => ({ ...r, display_name: (r.player_profile_id ? ppm.get(r.player_profile_id) : null) ?? (r.profile_id ? pm.get(r.profile_id) : null) ?? r.guest_name ?? "ゲスト" })));
    const { data: ms, error: matchesError } = await supabase.from("matches").select("id,court_number,completed,youtube_url,rounds(round_number),match_players(participant_id,team),match_results(score_a,score_b,winner_team)").eq("event_id", event.id).order("created_at", { ascending: false });
    if (matchesError) logSharedLoadError("共有イベント試合結果の取得に失敗しました", matchesError);
    setMatches((ms ?? []).map((m: any) => ({ ...m, round_number: m.rounds?.round_number ?? 0, result: firstMatchResult(m.match_results) })));
    const { data: videos, error: videosError } = await supabase.from("event_video_links").select("id,title,video_url,memo,display_order").eq("event_id", event.id).order("display_order", { ascending: true }).order("created_at", { ascending: true });
    if (videosError) {
      logSharedLoadError("共有イベント全試合動画の取得に失敗しました", videosError);
      setEventVideoLinks([]);
    } else {
      setEventVideoLinks(((videos ?? []) as any[]).filter((v) => typeof v.video_url === "string" && v.video_url.trim()).map((v) => ({ ...v, title: v.title || "全試合動画", video_url: v.video_url.trim() })));
    }
  })(); }, [token]);

  const playedParticipants = useMemo(() => {
    const playedIds = new Set(matches.filter(hasEnteredFriendlyMatchScore).flatMap((match) => (match.match_players ?? []).map((player: any) => player.participant_id)));
    return participants.filter((participant) => playedIds.has(participant.id));
  }, [participants, matches]);

  const nameMap = useMemo(() => Object.fromEntries(participants.map((p: any) => [p.id, p.display_name])), [participants]);
  const rows = useMemo(() => {
    const t: Record<string, Row> = {};
    for (const p of participants) t[p.id] = { name: p.display_name, played: 0, wins: 0, losses: 0, draws: 0, scored: 0, conceded: 0, winRate: 0, diff: 0, matchPoints: 0 };
    for (const m of matches) {
      if (!hasEnteredFriendlyMatchScore(m)) continue;
      const teamA = (m.match_players ?? []).filter((x: any) => x.team === "A").map((x: any) => x.participant_id);
      const teamB = (m.match_players ?? []).filter((x: any) => x.team === "B").map((x: any) => x.participant_id);
      for (const pid of teamA) { const r = t[pid]; if (!r) continue; r.played++; r.scored += m.result.score_a; r.conceded += m.result.score_b; if (m.result.score_a > m.result.score_b) r.wins++; else if (m.result.score_a < m.result.score_b) r.losses++; else r.draws++; }
      for (const pid of teamB) { const r = t[pid]; if (!r) continue; r.played++; r.scored += m.result.score_b; r.conceded += m.result.score_a; if (m.result.score_b > m.result.score_a) r.wins++; else if (m.result.score_b < m.result.score_a) r.losses++; else r.draws++; }
    }
    return Object.values(t).map((r) => ({ ...r, winRate: r.played ? Math.round((r.wins / r.played) * 1000) / 10 : 0, diff: r.scored - r.conceded, matchPoints: r.wins * 3 + r.draws }));
  }, [participants, matches]);

  const rankingRows = useMemo(() => rows.filter((r) => r.played > 0), [rows]);
  const winRanking = useMemo(() => [...rankingRows].sort((a, b) => b.wins - a.wins || b.draws - a.draws || b.winRate - a.winRate || b.diff - a.diff || b.scored - a.scored || a.played - b.played || a.name.localeCompare(b.name, "ja")), [rankingRows]);
  const winRateRanking = useMemo(() => [...rankingRows].sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.draws - a.draws || b.diff - a.diff || b.scored - a.scored || b.played - a.played || a.name.localeCompare(b.name, "ja")), [rankingRows]);
  const diffRanking = useMemo(() => [...rankingRows].sort((a, b) => b.diff - a.diff || b.wins - a.wins || b.draws - a.draws || b.winRate - a.winRate || b.scored - a.scored || a.played - b.played || a.name.localeCompare(b.name, "ja")), [rankingRows]);
  const mvp = useMemo(() => [...rankingRows].sort((a, b) => b.matchPoints - a.matchPoints || b.wins - a.wins || b.winRate - a.winRate || b.diff - a.diff || b.scored - a.scored || b.draws - a.draws || a.played - b.played || a.name.localeCompare(b.name, "ja"))[0] ?? null, [rankingRows]);
  const hasRankingResults = rankingRows.length > 0;

  const logClickError = (error: any) => {
    console.warn("イベント動画クリックの記録に失敗しました", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint
    });
  };

  const recordVideoClick = (matchId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    void (async () => {
      try {
        const { error } = await supabase.rpc("record_event_video_click", {
          match_id: matchId,
          user_agent: typeof navigator === "undefined" ? null : navigator.userAgent,
          referrer: typeof document === "undefined" ? null : document.referrer
        });
        if (error) logClickError(error);
      } catch (err) {
        logClickError(err);
      }
    })();
  };


  const logEventVideoLinkClickError = (error: any) => {
    console.warn("全試合動画クリックの記録に失敗しました", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint
    });
  };

  const recordEventVideoLinkClick = (videoLinkId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    void (async () => {
      try {
        const { error } = await supabase.rpc("record_event_video_link_click", {
          video_link_id: videoLinkId,
          user_agent: typeof navigator === "undefined" ? null : navigator.userAgent,
          referrer: typeof document === "undefined" ? null : document.referrer
        });
        if (error) logEventVideoLinkClickError(error);
      } catch (err) {
        logEventVideoLinkClickError(err);
      }
    })();
  };

  const teamName = (side: string) => teamSides.find((s: any) => s.side === side)?.team_name || (side === "team_a" ? "チームA" : "チームB");
  const teamPlayer = (m: any, side: "team_a" | "team_b", n: 1 | 2) => {
    const player=teamCardPlayers(m)[(side==="team_a"?0:2)+n-1];
    const name=player.profile_id?teamProfileNames[player.profile_id]||"選手":player.name||"選手";
    return m.generation_mode==="mixed"?`${name}（${teamName(player.source)}）`:name;
  };
  const sharedTeamStats=useMemo(()=>friendlyTeamStats(teamMatches,[teamName("team_a"),teamName("team_b")],(_side,pid,guest)=>pid?teamProfileNames[pid]||"選手":guest||"選手",(side,name)=>{const guest=teamGuests.find(g=>g.side===side&&g.guest_name===name);return guest?`guest:${guest.id}`:undefined;}),[teamMatches,teamSides,teamProfileNames,teamGuests]);
  const rankingDetails=<>
    <section className="rounded-xl border border-zinc-700 p-2 text-sm"><h3 className="font-bold">MVP</h3><p>{hasRankingResults&&mvp?`${mvp.name}（${formatRecord(mvp.wins,mvp.losses,mvp.draws)} / 勝点${mvp.matchPoints} / 勝率${mvp.winRate}% / 得失点差${mvp.diff}）`:"該当なし"}</p></section>
    <details className="rounded-xl border border-zinc-700 p-2"><summary className="min-h-11 text-sm">参加メンバー（採点済み試合の出場者）</summary>{playedParticipants.length?<ul className="space-y-1">{playedParticipants.map(p=><li key={p.id} className="text-sm"><GuestName name={p.display_name} guest={p.participant_type==="guest"}/></li>)}</ul>:<p className="text-sm">出場したメンバーはいません</p>}</details>
  </>;
  const historyCards=isTeamEvent?[...teamMatches].reverse().map((m:any)=>({id:m.id,content:<ResultMatchCard title={m.round_id?`第${m.round_number}ラウンド · コート${m.court_number} · ${m.generation_mode==="mixed"?"チーム混合（ペア1対ペア2）":"チーム対決"}`:`第${m.match_order}試合`} names={[[teamPlayer(m,"team_a",1),teamPlayer(m,"team_a",2)],[teamPlayer(m,"team_b",1),teamPlayer(m,"team_b",2)]]} score={storedTeamShareScore(teamCardScores(m).a,teamCardScores(m).b,teamCardScores(m).result)} youtubeUrl={m.youtube_url}>{m.score_detail&&<p className="text-xs">詳細スコア：{m.score_detail}</p>}</ResultMatchCard>})):[...matches].sort((a,b)=>b.round_number-a.round_number||a.court_number-b.court_number).map((m:any)=>({id:m.id,content:<ResultMatchCard title={`Round ${m.round_number} · コート${m.court_number}`} names={[(m.match_players??[]).filter((p:any)=>p.team==="A").map((p:any)=>nameMap[p.participant_id]||"未設定"),(m.match_players??[]).filter((p:any)=>p.team==="B").map((p:any)=>nameMap[p.participant_id]||"未設定")]} score={hasEnteredFriendlyMatchScore(m)?{a:m.result.score_a,b:m.result.score_b}:null} youtubeUrl={m.youtube_url} onVideoClick={()=>recordVideoClick(m.id)} />}));
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-2 p-3 pb-8"><SharedPageHeader title="イベント結果共有"/>{error?<p role="alert" className="text-sm text-red-400">{error}</p>:<>
    <section className="rounded-xl border border-zinc-700 bg-card p-2"><h2 className="break-words text-lg font-bold">{eventName}</h2><p className="text-xs text-zinc-400">{eventDate} · 全{isTeamEvent?teamMatches.length:matches.length}試合 · {isTeamEvent?sharedTeamStats.players.length:playedParticipants.length}人</p>{isTeamEvent&&<p className="text-xs">{teamName("team_a")} vs {teamName("team_b")}</p>}</section>
    {isTeamEvent?<EventResultRankings wins={[...sharedTeamStats.players].sort((a,b)=>b.wins-a.wins)} winRate={[...sharedTeamStats.players].sort((a,b)=>b.winRate-a.winRate)} diff={[...sharedTeamStats.players].sort((a,b)=>b.diff-a.diff)} details={<TeamResultDetails stats={sharedTeamStats}/>}/>:<EventResultRankings wins={winRanking} winRate={winRateRanking} diff={diffRanking} details={rankingDetails}/>}
    <EventResultHistory cards={historyCards}/>
    {eventVideoLinks.length>0&&<details className="rounded-xl border border-zinc-700 bg-card p-2"><summary className="min-h-11 text-sm font-bold">開催動画</summary>{eventVideoLinks.map(video=><div key={video.id} className="py-2 text-sm"><p>{video.title}</p><a href={video.video_url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-accent underline" onClick={()=>recordEventVideoLinkClick(video.id)}>YouTubeで見る</a>{video.memo&&<p className="whitespace-pre-wrap text-xs">{video.memo}</p>}</div>)}</details>}
  </>}</main>;

}
