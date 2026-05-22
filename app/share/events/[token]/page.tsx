"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type Row = { name: string; played: number; wins: number; scored: number; conceded: number; winRate: number; diff: number };

export default function SharedEventPage() {
  const { token } = useParams<{ token: string }>();
  const [eventName, setEventName] = useState("-");
  const [eventDate, setEventDate] = useState("-");
  const [participants, setParticipants] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => { void (async () => {
    const supabase = getSupabaseClient(); if (!supabase || !token) return;
    const { data: event } = await supabase.from("events").select("id,name,created_at,status,is_deleted,share_enabled,club_id").eq("share_token", token).maybeSingle();
    if (!event || !event.share_enabled || event.status !== "closed" || event.is_deleted) return setError("この共有リンクは無効です");
    const { data: club } = await supabase.from("clubs").select("is_active").eq("id", event.club_id).maybeSingle();
    if (!club?.is_active) return setError("この共有リンクは無効です");
    setEventName(event.name ?? "-");
    setEventDate(event.created_at ? new Date(event.created_at).toLocaleDateString("ja-JP") : "-");
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
  })(); }, [token]);

  const nameMap = useMemo(() => Object.fromEntries(participants.map((p: any) => [p.id, p.display_name])), [participants]);
  const rows = useMemo(() => {
    const t: Record<string, Row> = {};
    for (const p of participants) t[p.id] = { name: p.display_name, played: 0, wins: 0, scored: 0, conceded: 0, winRate: 0, diff: 0 };
    for (const m of matches) {
      if (!m.completed || !m.result) continue;
      const teamA = (m.match_players ?? []).filter((x: any) => x.team === "A").map((x: any) => x.participant_id);
      const teamB = (m.match_players ?? []).filter((x: any) => x.team === "B").map((x: any) => x.participant_id);
      for (const pid of teamA) { const r = t[pid]; if (!r) continue; r.played++; r.scored += m.result.score_a; r.conceded += m.result.score_b; if (m.result.winner_team === "A") r.wins++; }
      for (const pid of teamB) { const r = t[pid]; if (!r) continue; r.played++; r.scored += m.result.score_b; r.conceded += m.result.score_a; if (m.result.winner_team === "B") r.wins++; }
    }
    return Object.values(t).map((r) => ({ ...r, winRate: r.played ? Math.round((r.wins / r.played) * 1000) / 10 : 0, diff: r.scored - r.conceded }));
  }, [participants, matches]);

  const rankingRows = useMemo(() => rows.filter((r) => r.played > 0), [rows]);

  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 pb-20"><h1 className="text-xl font-bold">イベント結果共有</h1>{error && <p className="text-sm text-red-400">{error}</p>}{!error && <><Card title="イベント情報"><div className="space-y-1 text-sm"><p>イベント名：{eventName}</p><p>開催日：{eventDate}</p><p>総試合数：{matches.length}</p><p>参加者数：{participants.length}</p></div></Card>{rankingRows.length > 0 ? <><Card title="勝利数ランキング"><ol className="space-y-1 text-sm">{[...rankingRows].sort((a,b)=>b.wins-a.wins||b.winRate-a.winRate).map((r,i)=><li key={i}>{i+1}位 {r.name} {r.wins}勝</li>)}</ol></Card><Card title="勝率ランキング"><ol className="space-y-1 text-sm">{[...rankingRows].sort((a,b)=>b.winRate-a.winRate).map((r,i)=><li key={i}>{i+1}位 {r.name} {r.winRate}%</li>)}</ol></Card><Card title="得失点差ランキング"><ol className="space-y-1 text-sm">{[...rankingRows].sort((a,b)=>b.diff-a.diff).map((r,i)=><li key={i}>{i+1}位 {r.name} {r.diff}</li>)}</ol></Card></> : <Card title="結果サマリー"><p className="text-sm">試合結果がありません</p></Card>}<Card title="各試合結果"><div className="space-y-2">{matches.map((m:any)=>{const a=(m.match_players??[]).filter((x:any)=>x.team==="A").map((x:any)=>nameMap[x.participant_id]).join("/");const b=(m.match_players??[]).filter((x:any)=>x.team==="B").map((x:any)=>nameMap[x.participant_id]).join("/");return <div key={m.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p>Round {m.round_number} / Court{m.court_number}</p><p className="font-semibold">{a} vs {b}</p><p>{m.result ? `${m.result.score_a} - ${m.result.score_b}` : "未入力"}</p>{m.youtube_url && <a href={m.youtube_url} target="_blank" rel="noreferrer" className="mt-1 inline-block rounded border border-zinc-500 px-3 py-1 text-xs">動画を見る</a>}</div>;})}</div></Card></>}</main>;
}
