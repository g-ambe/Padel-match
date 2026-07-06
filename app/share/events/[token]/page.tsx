"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";
import { hasEnteredFriendlyMatchScore, isFriendlyMatchDraw } from "@/lib/friendly-match-results";

type Row = { name: string; played: number; wins: number; losses: number; draws: number; scored: number; conceded: number; winRate: number; diff: number; matchPoints: number };

const formatRecord = (wins: number, losses: number, draws: number) => `${wins}勝${losses}敗${draws}分`;
type SharedRankingSectionKey = "wins" | "winRate" | "diff" | "mvp";
type EventVideoLink = { id: string; title: string; video_url: string; memo: string | null; display_order: number };

const sharedRankingButtonClass = "flex min-h-12 w-full items-center rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-3 text-left text-sm font-bold text-zinc-100 shadow-sm shadow-black/20 active:bg-zinc-800";

function SharedRankingSection({ title, isOpen, onToggle, children }: { title: string; isOpen: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <button type="button" className={sharedRankingButtonClass} onClick={onToggle} aria-expanded={isOpen}>
        <span className="mr-2 text-accent">{isOpen ? "▼" : "◀"}</span>
        <span>{title}</span>
      </button>
      {isOpen && <div>{children}</div>}
    </section>
  );
}

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
  const [error, setError] = useState("");
  const [openRankingSections, setOpenRankingSections] = useState<Record<SharedRankingSectionKey, boolean>>({ wins: false, winRate: false, diff: false, mvp: false });

  useEffect(() => { void (async () => {
    const supabase = getSupabaseClient(); if (!supabase || !token) return;
    const { data: event } = await supabase.from("events").select("id,name,created_at,status,is_deleted,share_enabled,club_id,event_mode").eq("share_token", token).maybeSingle();
    if (!event || !event.share_enabled || event.status !== "closed" || event.is_deleted) return setError("この共有リンクは無効です");
    if (event.club_id) {
      const { data: club } = await supabase.from("clubs").select("is_active").eq("id", event.club_id).maybeSingle();
      if (!club?.is_active) return setError("この共有リンクは無効です");
    }
    setEventName(event.name ?? "-");
    setEventDate(event.created_at ? new Date(event.created_at).toLocaleDateString("ja-JP") : "-");
    setIsTeamEvent(event.event_mode === "team");
    if (event.event_mode === "team") {
      const { data: sides } = await supabase.from("event_team_sides").select("side,team_name,club_id").eq("event_id", event.id);
      const { data: cards } = await supabase.from("event_team_matches").select("*").eq("event_id", event.id).order("match_order", { ascending: true }).order("created_at", { ascending: true });
      setTeamSides(sides ?? []);
      setTeamMatches(cards ?? []);
    }
    const { data: pt } = await supabase.from("event_participants").select("id,guest_name,participant_type,player_profile_id,profile_id").eq("event_id", event.id);
    const rows = pt ?? [];
    const playerProfileIds = rows.map((r: any) => r.player_profile_id).filter(Boolean);
    const profileIds = rows.map((r: any) => r.profile_id).filter(Boolean);
    const { data: pps } = playerProfileIds.length ? await supabase.from("player_profiles").select("id,display_name").in("id", playerProfileIds) : { data: [] as any[] };
    const { data: ps } = profileIds.length ? await supabase.from("profiles").select("id,display_name").in("id", profileIds) : { data: [] as any[] };
    const ppm = new Map((pps ?? []).map((x: any) => [x.id, x.display_name]));
    const pm = new Map((ps ?? []).map((x: any) => [x.id, x.display_name]));
    setParticipants(rows.map((r: any) => ({ ...r, display_name: (r.player_profile_id ? ppm.get(r.player_profile_id) : null) ?? (r.profile_id ? pm.get(r.profile_id) : null) ?? r.guest_name ?? "ゲスト" })));
    const { data: ms } = await supabase.from("matches").select("id,court_number,completed,youtube_url,rounds(round_number),match_players(participant_id,team),match_results(score_a,score_b,winner_team)").eq("event_id", event.id).order("created_at", { ascending: false });
    setMatches((ms ?? []).map((m: any) => ({ ...m, round_number: m.rounds?.round_number ?? 0, result: m.match_results?.[0] ?? null })));
    const { data: videos } = await supabase.from("event_video_links").select("id,title,video_url,memo,display_order").eq("event_id", event.id).order("display_order", { ascending: true }).order("created_at", { ascending: true });
    setEventVideoLinks(((videos ?? []) as any[]).filter((v) => typeof v.video_url === "string" && v.video_url.trim()).map((v) => ({ ...v, title: v.title || "全試合動画", video_url: v.video_url.trim() })));
  })(); }, [token]);

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
  const toggleRankingSection = (key: SharedRankingSectionKey) => setOpenRankingSections((prev) => ({ ...prev, [key]: !prev[key] }));

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

  const teamName = (side: string) => teamSides.find((s: any) => s.side === side)?.team_name || (side === "team_a" ? "自チーム" : "相手チーム");
  const teamPlayer = (m: any, side: "team_a" | "team_b", n: 1 | 2) => m[`${side}_player${n}_guest_name`] || "選手";

  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 pb-20"><h1 className="text-xl font-bold">イベント結果共有</h1>{error && <p className="text-sm text-red-400">{error}</p>}{!error && <><Card title="イベント情報"><div className="space-y-1 text-sm"><p>イベント名：{eventName}</p><p>開催日：{eventDate}</p><p>総試合数：{matches.length}</p><p>参加者数：{participants.length}</p></div></Card>{isTeamEvent ? <Card title="戦績サマリ"><div className="space-y-2 text-sm"><p>{teamName("team_a")} vs {teamName("team_b")}</p><p>集計対象: {teamMatches.filter((m:any)=>m.team_a_score !== null && m.team_b_score !== null && !(m.team_a_score === 0 && m.team_b_score === 0)).length}試合</p></div></Card> : <Card title="結果サマリー"><div className="space-y-3 text-sm"><SharedRankingSection title="勝利数ランキング" isOpen={openRankingSections.wins} onToggle={() => toggleRankingSection("wins")}>{hasRankingResults ? <ol className="space-y-1 rounded-xl bg-zinc-800 p-3">{winRanking.map((r,i)=><li key={`w-${r.name}-${i}`}>{i+1}位 {r.name} {formatRecord(r.wins, r.losses, r.draws)}</li>)}</ol> : <div className="rounded-xl bg-zinc-800 p-3"><p>試合結果がありません</p></div>}</SharedRankingSection><SharedRankingSection title="勝率ランキング" isOpen={openRankingSections.winRate} onToggle={() => toggleRankingSection("winRate")}>{hasRankingResults ? <ol className="space-y-1 rounded-xl bg-zinc-800 p-3">{winRateRanking.map((r,i)=><li key={`wr-${r.name}-${i}`}>{i+1}位 {r.name} {formatRecord(r.wins, r.losses, r.draws)} / 勝率{r.winRate}%</li>)}</ol> : <div className="rounded-xl bg-zinc-800 p-3"><p>試合結果がありません</p></div>}</SharedRankingSection><SharedRankingSection title="得失点差ランキング" isOpen={openRankingSections.diff} onToggle={() => toggleRankingSection("diff")}>{hasRankingResults ? <ol className="space-y-1 rounded-xl bg-zinc-800 p-3">{diffRanking.map((r,i)=><li key={`df-${r.name}-${i}`}>{i+1}位 {r.name} {formatRecord(r.wins, r.losses, r.draws)} / 得失点差{r.diff}</li>)}</ol> : <div className="rounded-xl bg-zinc-800 p-3"><p>試合結果がありません</p></div>}</SharedRankingSection><SharedRankingSection title="MVP" isOpen={openRankingSections.mvp} onToggle={() => toggleRankingSection("mvp")}><div className="rounded-xl bg-zinc-800 p-3"><p>{hasRankingResults && mvp ? `${mvp.name}（${formatRecord(mvp.wins, mvp.losses, mvp.draws)} / 勝点${mvp.matchPoints} / 勝率${mvp.winRate}% / 得失点差${mvp.diff}）` : "該当なし"}</p></div></SharedRankingSection></div></Card>}<Card title="各試合結果"><div className="space-y-2">{isTeamEvent ? teamMatches.map((m:any,i:number)=><div key={m.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-bold">第{i+1}試合</p><p>{teamPlayer(m,"team_a",1)} / {teamPlayer(m,"team_a",2)} vs {teamPlayer(m,"team_b",1)} / {teamPlayer(m,"team_b",2)}</p><p>{m.team_a_score !== null && m.team_b_score !== null ? `${m.team_a_score} - ${m.team_b_score}${m.result === "draw" ? "（引き分け）" : ""}` : "未入力"}</p>{m.score_detail && <p>詳細スコア: {m.score_detail}</p>}{m.youtube_url && <a href={m.youtube_url} target="_blank" rel="noreferrer" className="mt-1 inline-block rounded border border-zinc-500 px-3 py-1 text-xs">動画視聴</a>}</div>) : matches.map((m:any)=>{const a=(m.match_players??[]).filter((x:any)=>x.team==="A").map((x:any)=>nameMap[x.participant_id]).join("/");const b=(m.match_players??[]).filter((x:any)=>x.team==="B").map((x:any)=>nameMap[x.participant_id]).join("/");return <div key={m.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p>Round {m.round_number} / Court{m.court_number}</p><p className="font-semibold">{a} vs {b}</p><p>{hasEnteredFriendlyMatchScore(m) ? `${m.result.score_a} - ${m.result.score_b}${isFriendlyMatchDraw(m) ? "（引き分け）" : ""}` : "未入力"}</p>{m.youtube_url && <a href={m.youtube_url} target="_blank" rel="noreferrer" className="mt-1 inline-block rounded border border-zinc-500 px-3 py-1 text-xs" onClick={() => recordVideoClick(m.id)}>動画を見る</a>}</div>;})}</div></Card>{eventVideoLinks.length > 0 && <Card title="動画視聴"><div className="space-y-2">{eventVideoLinks.map((video) => <div key={video.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-semibold">{video.title || "全試合動画"}</p><a href={video.video_url} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded border border-zinc-500 px-3 py-1 text-xs" onClick={() => recordEventVideoLinkClick(video.id)}>YouTubeで見る</a>{video.memo && <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-400">メモ: {video.memo}</p>}</div>)}</div></Card>}</>}</main>;
}
