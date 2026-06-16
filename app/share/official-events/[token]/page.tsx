"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { OfficialStatsCard } from "@/components/official-stats-card";
import { Card } from "@/components/ui";
import { buildOfficialStats, officialStatusLabel } from "@/lib/official-matches";
import { getSupabaseClient } from "@/lib/supabase";

type OfficialEvent = { id: string; title: string; event_date: string | null; description: string | null; memo: string | null; status: string; is_deleted?: boolean | null; share_enabled: boolean | null; club_id: string; clubs?: { name: string } | null };
type OfficialOpponent = { id: string; opponent_team_name: string; memo: string | null };
type OfficialMatch = {
  id: string; official_opponent_id: string; match_order: number; created_at?: string | null; our_player1_profile_id: string | null; our_player2_profile_id: string | null;
  our_player1_guest_name: string | null; our_player2_guest_name: string | null; opponent_player1_name: string | null; opponent_player2_name: string | null;
  our_score: number | null; opponent_score: number | null; result: "win" | "lose" | "draw" | "undecided"; score_detail: string | null; memo: string | null; youtube_url: string | null;
};

const resultLabel = (result: string) => ({ win: "勝ち", lose: "負け", draw: "引き分け", undecided: "未定" }[result] ?? "未定");
const opponentScore = (opponentId: string, matches: OfficialMatch[]) => matches
  .filter((match) => match.official_opponent_id === opponentId)
  .reduce((score, match) => {
    if (match.result === "win") return { ...score, ourWins: score.ourWins + 1 };
    if (match.result === "lose") return { ...score, opponentWins: score.opponentWins + 1 };
    if (match.result === "draw") return { ...score, draws: score.draws + 1 };
    return score;
  }, { ourWins: 0, opponentWins: 0, draws: 0 });
const formatOpponentScore = ({ ourWins, opponentWins, draws }: { ourWins: number; opponentWins: number; draws: number }) => `${ourWins}-${opponentWins}${draws > 0 ? `（引分${draws}）` : ""}`;

export default function SharedOfficialEventPage() {
  const { token } = useParams<{ token: string }>();
  const [event, setEvent] = useState<OfficialEvent | null>(null);
  const [opponents, setOpponents] = useState<OfficialOpponent[]>([]);
  const [matches, setMatches] = useState<OfficialMatch[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");

  useEffect(() => { void (async () => {
    const supabase = getSupabaseClient(); if (!supabase || !token) return;
    const { data: eventRow } = await supabase.from("official_events").select("id,title,event_date,description,memo,status,is_deleted,share_enabled,club_id,clubs(name)").eq("share_token", token).eq("is_deleted", false).maybeSingle();
    const officialEvent = eventRow as unknown as OfficialEvent | null;
    if (!officialEvent || !officialEvent.share_enabled || officialEvent.status !== "closed") return setError("この共有リンクは無効です");
    setEvent(officialEvent);
    const { data: opponentRows } = await supabase.from("official_opponents").select("id,opponent_team_name,memo").eq("official_event_id", officialEvent.id).order("created_at");
    const { data: matchRows } = await supabase.from("official_matches").select("id,official_opponent_id,match_order,created_at,our_player1_profile_id,our_player2_profile_id,our_player1_guest_name,our_player2_guest_name,opponent_player1_name,opponent_player2_name,our_score,opponent_score,result,score_detail,memo,youtube_url").eq("official_event_id", officialEvent.id).order("match_order", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true });
    const rows = (matchRows ?? []) as unknown as OfficialMatch[];
    const profileIds = [...new Set(rows.flatMap((match) => [match.our_player1_profile_id, match.our_player2_profile_id]).filter(Boolean) as string[])];
    const { data: profileRows } = profileIds.length ? await supabase.from("player_profiles").select("id,display_name").in("id", profileIds) : { data: [] as any[] };
    setNames(new Map((profileRows ?? []).map((profile: any) => [profile.id, profile.display_name ?? "名称未設定"])));
    setOpponents((opponentRows ?? []) as unknown as OfficialOpponent[]);
    setMatches(rows);
  })(); }, [token]);

  const memberName = (profileId: string | null, guestName: string | null) => guestName || (profileId ? names.get(profileId) : null) || "未入力";
  const stats = useMemo(() => {
    if (!event) return null;
    return buildOfficialStats({ eventTitle: event.title, groupName: event.clubs?.name ?? "名称未設定", opponents, matches, memberName });
  }, [event, opponents, matches, names]);
  const opponentMatches = (opponentId: string) => matches
    .filter((match) => match.official_opponent_id === opponentId)
    .sort((a, b) => a.match_order - b.match_order || (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id));

  if (error) return <main className="mx-auto min-h-screen w-full max-w-md p-4 text-zinc-100"><p className="text-sm text-red-400">{error}</p></main>;
  if (!event) return <main className="mx-auto min-h-screen w-full max-w-md p-4 text-zinc-100">読み込み中...</main>;

  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 text-zinc-100">
    <h1 className="text-xl font-bold">公式試合共有</h1>
    <Card title={event.title}>
      <dl className="space-y-3 text-sm">
        <div><dt className="text-zinc-400">所属グループ</dt><dd>{event.clubs?.name ?? "名称未設定"}</dd></div>
        <div><dt className="text-zinc-400">開催日</dt><dd>{event.event_date ?? "未定"}</dd></div>
        <div><dt className="text-zinc-400">ステータス</dt><dd>{officialStatusLabel(event.status)}</dd></div>
        <div><dt className="text-zinc-400">説明</dt><dd className="whitespace-pre-wrap">{event.description || "未入力"}</dd></div>
        <div><dt className="text-zinc-400">メモ</dt><dd className="whitespace-pre-wrap">{event.memo || "未入力"}</dd></div>
      </dl>
    </Card>
    <OfficialStatsCard stats={stats} />
    <Card title="戦績"><div className="space-y-4">{opponents.length === 0 ? <p className="text-sm text-zinc-400">戦績はまだ登録されていません</p> : opponents.map((opponent) => {
      const sortedMatches = opponentMatches(opponent.id);
      return <section key={opponent.id} className="space-y-3 rounded-2xl border border-zinc-700 bg-zinc-900/60 p-3"><div><h3 className="font-bold">{event.clubs?.name ?? "自チーム"} vs {opponent.opponent_team_name}</h3><p className="mt-1 text-2xl font-black tracking-tight text-accent">{formatOpponentScore(opponentScore(opponent.id, matches))}</p>{opponent.memo && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-400">メモ: {opponent.memo}</p>}</div><div className="space-y-3">{sortedMatches.length === 0 && <p className="text-sm text-zinc-400">試合カードはまだ登録されていません</p>}{sortedMatches.map((match, index) => <div key={match.id} className="rounded-xl bg-zinc-800 p-3 text-sm"><p className="font-bold">第{index + 1}試合</p><p className="mt-1">{memberName(match.our_player1_profile_id, match.our_player1_guest_name)} / {memberName(match.our_player2_profile_id, match.our_player2_guest_name)} vs {match.opponent_player1_name || "未入力"} / {match.opponent_player2_name || "未入力"}</p><p className="mt-1">スコア: {match.our_score ?? "未入力"} - {match.opponent_score ?? "未入力"}</p><p>結果: {resultLabel(match.result)}</p>{match.score_detail && <p className="whitespace-pre-wrap">詳細スコア: {match.score_detail}</p>}{match.memo && <p className="whitespace-pre-wrap">メモ: {match.memo}</p>}{match.youtube_url && <a className="mt-1 inline-block underline" href={match.youtube_url} target="_blank" rel="noreferrer">動画を見る</a>}</div>)}</div></section>;
    })}</div></Card>
  </main>;
}
