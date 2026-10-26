"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui";
import { SharedPageHeader } from "@/components/shared-page-header";
import { getSupabaseClient } from "@/lib/supabase";
import { hasEnteredFriendlyMatchScore, isFriendlyMatchDraw } from "@/lib/friendly-match-results";

type Row = { name: string; played: number; wins: number; losses: number; draws: number; scored: number; conceded: number; winRate: number; diff: number; matchPoints: number };

const formatRecord = (wins: number, losses: number, draws: number) => `${wins}勝${losses}敗${draws}分`;
type SharedRankingSectionKey = "wins" | "winRate" | "diff" | "mvp";
type EventVideoLink = { id: string; title: string; video_url: string; memo: string | null; display_order: number };
type SharedParticipant = { id: string; display_name: string };
type SharedMatch = {
  id: string; court_number: number; completed: boolean; youtube_url: string | null; round_number: number;
  match_players: { participant_id: string; team: "A" | "B" }[];
  result: { score_a: number; score_b: number; winner_team: string } | null;
};
type SharedTeamMatch = {
  id: string; team_a_player1_guest_name: string; team_a_player2_guest_name: string;
  team_b_player1_guest_name: string; team_b_player2_guest_name: string;
  team_a_score: number | null; team_b_score: number | null; result: string;
  score_detail: string | null; youtube_url: string | null;
};
type SharedEventData = {
  event: { name: string; created_at: string | null; event_mode: string | null };
  participants: SharedParticipant[]; matches: SharedMatch[];
  team_sides: { side: string; team_name: string | null }[];
  team_matches: SharedTeamMatch[]; videos: EventVideoLink[];
};

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
  const [participants, setParticipants] = useState<SharedParticipant[]>([]);
  const [matches, setMatches] = useState<SharedMatch[]>([]);
  const [eventVideoLinks, setEventVideoLinks] = useState<EventVideoLink[]>([]);
  const [isTeamEvent, setIsTeamEvent] = useState(false);
  const [teamSides, setTeamSides] = useState<SharedEventData["team_sides"]>([]);
  const [teamMatches, setTeamMatches] = useState<SharedTeamMatch[]>([]);
  const [error, setError] = useState("");
  const [openRankingSections, setOpenRankingSections] = useState<Record<SharedRankingSectionKey, boolean>>({ wins: false, winRate: false, diff: false, mvp: false });

  useEffect(() => {
    let active = true;
    setError("");
    setParticipants([]);
    setMatches([]);
    setTeamSides([]);
    setTeamMatches([]);
    setEventVideoLinks([]);
    void (async () => {
      const supabase = getSupabaseClient(); if (!supabase || !token) return;
      try {
        // トークンの照合と公開状態の確認はDB側で行い、表示列だけを受け取る。
        const { data, error: loadError } = await supabase.rpc("get_shared_event", { p_token: token });
        if (!active) return;
        if (loadError) {
          console.error("共有イベントの取得に失敗しました", { message: loadError.message, code: loadError.code });
          return setError("共有イベントが見つかりません");
        }
        if (!data) return setError("この共有リンクは無効です");
        const shared = data as SharedEventData;
        setEventName(shared.event.name ?? "-");
        setEventDate(shared.event.created_at ? new Date(shared.event.created_at).toLocaleDateString("ja-JP") : "-");
        setIsTeamEvent(shared.event.event_mode === "team");
        setParticipants(shared.participants);
        setMatches(shared.matches);
        setTeamSides(shared.team_sides);
        setTeamMatches(shared.team_matches);
        setEventVideoLinks(shared.videos);
      } catch {
        if (active) setError("共有イベントが見つかりません");
      }
    })();
    return () => { active = false; };
  }, [token]);

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

  const teamName = (side: string) => teamSides.find((s: any) => s.side === side)?.team_name || (side === "team_a" ? "チームA" : "チームB");
  const teamPlayer = (m: any, side: "team_a" | "team_b", n: 1 | 2) => m[`${side}_player${n}_guest_name`] || "選手";

  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 pb-20"><SharedPageHeader title="イベント結果共有" />{error && <p className="text-sm text-red-400">{error}</p>}{!error && <><Card title="イベント情報"><div className="space-y-1 text-sm"><p>イベント名：{eventName}</p><p>開催日：{eventDate}</p><p>総試合数：{matches.length}</p><p>参加者数：{participants.length}</p></div></Card>{isTeamEvent ? <Card title="戦績サマリ"><div className="space-y-2 text-sm"><p>{teamName("team_a")} vs {teamName("team_b")}</p><p>集計対象: {teamMatches.filter((m:any)=>m.team_a_score !== null && m.team_b_score !== null && !(m.team_a_score === 0 && m.team_b_score === 0)).length}試合</p></div></Card> : <Card title="結果サマリー"><div className="space-y-3 text-sm"><SharedRankingSection title="勝利数ランキング" isOpen={openRankingSections.wins} onToggle={() => toggleRankingSection("wins")}>{hasRankingResults ? <ol className="space-y-1 rounded-xl bg-zinc-800 p-3">{winRanking.map((r,i)=><li key={`w-${r.name}-${i}`}>{i+1}位 {r.name} {formatRecord(r.wins, r.losses, r.draws)}</li>)}</ol> : <div className="rounded-xl bg-zinc-800 p-3"><p>試合結果がありません</p></div>}</SharedRankingSection><SharedRankingSection title="勝率ランキング" isOpen={openRankingSections.winRate} onToggle={() => toggleRankingSection("winRate")}>{hasRankingResults ? <ol className="space-y-1 rounded-xl bg-zinc-800 p-3">{winRateRanking.map((r,i)=><li key={`wr-${r.name}-${i}`}>{i+1}位 {r.name} {formatRecord(r.wins, r.losses, r.draws)} / 勝率{r.winRate}%</li>)}</ol> : <div className="rounded-xl bg-zinc-800 p-3"><p>試合結果がありません</p></div>}</SharedRankingSection><SharedRankingSection title="得失点差ランキング" isOpen={openRankingSections.diff} onToggle={() => toggleRankingSection("diff")}>{hasRankingResults ? <ol className="space-y-1 rounded-xl bg-zinc-800 p-3">{diffRanking.map((r,i)=><li key={`df-${r.name}-${i}`}>{i+1}位 {r.name} {formatRecord(r.wins, r.losses, r.draws)} / 得失点差{r.diff}</li>)}</ol> : <div className="rounded-xl bg-zinc-800 p-3"><p>試合結果がありません</p></div>}</SharedRankingSection><SharedRankingSection title="MVP" isOpen={openRankingSections.mvp} onToggle={() => toggleRankingSection("mvp")}><div className="rounded-xl bg-zinc-800 p-3"><p>{hasRankingResults && mvp ? `${mvp.name}（${formatRecord(mvp.wins, mvp.losses, mvp.draws)} / 勝点${mvp.matchPoints} / 勝率${mvp.winRate}% / 得失点差${mvp.diff}）` : "該当なし"}</p></div></SharedRankingSection></div></Card>}<Card title="各試合結果"><div className="space-y-2">{isTeamEvent ? teamMatches.map((m:any,i:number)=><div key={m.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-bold">第{i+1}試合</p><p>{teamPlayer(m,"team_a",1)} / {teamPlayer(m,"team_a",2)} vs {teamPlayer(m,"team_b",1)} / {teamPlayer(m,"team_b",2)}</p><p>{m.team_a_score !== null && m.team_b_score !== null ? `${m.team_a_score} - ${m.team_b_score}${m.result === "draw" ? "（引き分け）" : ""}` : "未入力"}</p>{m.score_detail && <p>詳細スコア: {m.score_detail}</p>}{m.youtube_url && <a href={m.youtube_url} target="_blank" rel="noreferrer" className="mt-1 inline-block rounded border border-zinc-500 px-3 py-1 text-xs">動画視聴</a>}</div>) : matches.map((m:any)=>{const a=(m.match_players??[]).filter((x:any)=>x.team==="A").map((x:any)=>nameMap[x.participant_id]).join("/");const b=(m.match_players??[]).filter((x:any)=>x.team==="B").map((x:any)=>nameMap[x.participant_id]).join("/");return <div key={m.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p>Round {m.round_number} / Court{m.court_number}</p><p className="font-semibold">{a} vs {b}</p><p>{hasEnteredFriendlyMatchScore(m) ? `${m.result.score_a} - ${m.result.score_b}${isFriendlyMatchDraw(m) ? "（引き分け）" : ""}` : "未入力"}</p>{m.youtube_url && <a href={m.youtube_url} target="_blank" rel="noreferrer" className="mt-1 inline-block rounded border border-zinc-500 px-3 py-1 text-xs" onClick={() => recordVideoClick(m.id)}>動画を見る</a>}</div>;})}</div></Card>{eventVideoLinks.length > 0 && <Card title="動画視聴"><div className="space-y-2">{eventVideoLinks.map((video) => <div key={video.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-semibold">{video.title || "全試合動画"}</p><a href={video.video_url} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded border border-zinc-500 px-3 py-1 text-xs" onClick={() => recordEventVideoLinkClick(video.id)}>YouTubeで見る</a>{video.memo && <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-400">メモ: {video.memo}</p>}</div>)}</div></Card>}</>}</main>;
}
