"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Card, ActionButton } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type Participant = { id: string; profile_id: string | null; guest_name: string | null; status: "active" | "resting" | "absent" };
type MatchView = { id: string; court_number: number; players: { participant_id: string; team: "A" | "B" }[]; completed: boolean };

export default function EventDetailPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [courtCount, setCourtCount] = useState(1);
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState("");
  const [scoreInputs, setScoreInputs] = useState<Record<string, { a: number; b: number }>>({});

  const nameMap = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p.guest_name ?? "ゲスト"])), [participants]);

  const profileMap = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p.profile_id])), [participants]);

  const ranking = useMemo(() => {
    const stats: Record<string, { name: string; m: number; w: number }> = {};
    for (const p of participants) stats[p.id] = { name: p.guest_name ?? "ゲスト", m: 0, w: 0 };
    for (const m of matches) {
      if (!m.completed) continue;
      const score = scoreInputs[m.id];
      if (!score) continue;
      const winner = score.a > score.b ? "A" : "B";
      for (const mp of m.players) {
        if (!stats[mp.participant_id]) continue;
        stats[mp.participant_id].m += 1;
        if (mp.team === winner) stats[mp.participant_id].w += 1;
      }
    }
    return Object.values(stats)
      .map((v) => ({ ...v, r: v.m ? Math.round((v.w / v.m) * 100) : 0 }))
      .sort((a, b) => b.r - a.r);
  }, [participants, matches, scoreInputs]);


  const loadAll = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;

    const { data: event } = await supabase.from("events").select("court_count").eq("id", eventId).single();
    if (event?.court_count) setCourtCount(event.court_count);

    const { data: pt } = await supabase
      .from("event_participants")
      .select("id,profile_id,guest_name,status")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    setParticipants((pt ?? []) as Participant[]);

    const { data: ms } = await supabase
      .from("matches")
      .select("id,court_number,completed,match_players(participant_id,team)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(8);

    setMatches((ms ?? []).map((m: any) => ({ id: m.id, court_number: m.court_number, completed: m.completed, players: m.match_players ?? [] })));
  };

  useEffect(() => {
    void loadAll();
  }, [eventId]);

  const addGuest = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !guestName.trim() || !eventId) return;
    await supabase.from("event_participants").insert({ event_id: eventId, guest_name: guestName.trim(), status: "active" });
    setGuestName("");
    await loadAll();
  };

  const updateStatus = async (participantId: string, status: Participant["status"]) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    await supabase.from("event_participants").update({ status }).eq("id", participantId);
    await loadAll();
  };

  const generateRound = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;
    setError("");

    const active = participants.filter((p) => p.status === "active");
    if (active.length < 4) {
      setError("アクティブ参加者が4人未満のためRound生成できません");
      return;
    }

    const playableCourts = Math.min(courtCount, Math.floor(active.length / 4));
    if (playableCourts < 1) {
      setError("コート数に対して参加者が不足しています");
      return;
    }

    const { data: roundCount } = await supabase.from("rounds").select("id", { count: "exact", head: true }).eq("event_id", eventId);
    const roundNumber = (roundCount?.length ?? 0) + 1;
    const { data: round } = await supabase.from("rounds").insert({ event_id: eventId, round_number: roundNumber }).select("id").single();
    if (!round) return;

    const shuffled = [...active].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, playableCourts * 4);

    for (let c = 0; c < playableCourts; c++) {
      const group = selected.slice(c * 4, c * 4 + 4);
      const { data: match } = await supabase
        .from("matches")
        .insert({ event_id: eventId, round_id: round.id, court_number: c + 1, completed: false })
        .select("id")
        .single();
      if (!match) continue;
      await supabase.from("match_players").insert([
        { match_id: match.id, participant_id: group[0].id, team: "A" },
        { match_id: match.id, participant_id: group[1].id, team: "A" },
        { match_id: match.id, participant_id: group[2].id, team: "B" },
        { match_id: match.id, participant_id: group[3].id, team: "B" }
      ]);
    }

    await loadAll();
  };

  const saveScore = async (matchId: string) => {
    const supabase = getSupabaseClient();
    const score = scoreInputs[matchId];
    if (!supabase || !score) return;
    const winner = score.a > score.b ? "A" : "B";

    await supabase.from("match_results").insert({ match_id: matchId, score_a: score.a, score_b: score.b, winner_team: winner });
    await supabase.from("matches").update({ completed: true }).eq("id", matchId);

    const match = matches.find((m) => m.id === matchId);
    if (match) {
      const winners = match.players.filter((p) => p.team === winner).map((p) => p.participant_id);
      const losers = match.players.filter((p) => p.team !== winner).map((p) => p.participant_id);

      for (const pid of winners) {
        const profileId = profileMap[pid];
        if (!profileId) continue;
        const { data: cur } = await supabase.from("player_stats").select("id,match_count,win_count,loss_count").eq("profile_id", profileId).maybeSingle();
        const match_count = (cur?.match_count ?? 0) + 1;
        const win_count = (cur?.win_count ?? 0) + 1;
        const loss_count = cur?.loss_count ?? 0;
        const win_rate = match_count ? win_count / match_count : 0;
        if (cur?.id) {
          await supabase.from("player_stats").update({ match_count, win_count, loss_count, win_rate }).eq("id", cur.id);
        } else {
          await supabase.from("player_stats").insert({ profile_id: profileId, match_count, win_count, loss_count, win_rate });
        }
      }
      for (const pid of losers) {
        const profileId = profileMap[pid];
        if (!profileId) continue;
        const { data: cur } = await supabase.from("player_stats").select("id,match_count,win_count,loss_count").eq("profile_id", profileId).maybeSingle();
        const match_count = (cur?.match_count ?? 0) + 1;
        const win_count = cur?.win_count ?? 0;
        const loss_count = (cur?.loss_count ?? 0) + 1;
        const win_rate = match_count ? win_count / match_count : 0;
        if (cur?.id) {
          await supabase.from("player_stats").update({ match_count, win_count, loss_count, win_rate }).eq("id", cur.id);
        } else {
          await supabase.from("player_stats").insert({ profile_id: profileId, match_count, win_count, loss_count, win_rate });
        }
      }
    }

    await loadAll();
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 pb-20">
      <h1 className="text-xl font-bold">開催詳細</h1>
      <Card title="参加者追加">
        <div className="flex gap-2">
          <input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="ゲスト名" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          <button className="rounded-xl bg-accent px-4 text-black" onClick={addGuest}>追加</button>
        </div>
      </Card>
      <Card title="参加者">
        <ul className="space-y-2">
          {participants.map((p) => (
            <li key={p.id} className="rounded-xl bg-zinc-800 p-3">
              <div className="mb-2 flex justify-between"><span>{p.guest_name ?? "ゲスト"}</span><span>{p.status === "active" ? "参加中" : p.status === "resting" ? "休憩" : "離席"}</span></div>
              <div className="grid grid-cols-3 gap-1 text-sm">
                <button className="rounded bg-zinc-700 py-1" onClick={() => updateStatus(p.id, "active")}>参加中</button>
                <button className="rounded bg-zinc-700 py-1" onClick={() => updateStatus(p.id, "resting")}>休憩</button>
                <button className="rounded bg-zinc-700 py-1" onClick={() => updateStatus(p.id, "absent")}>離席</button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <ActionButton onClick={generateRound}>次Round生成</ActionButton>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card title="勝率ランキング">
        <ol className="space-y-1 text-sm">{ranking.map((r, i) => <li key={r.name + i}>{i + 1}位 {r.name} {r.r}%（{r.m}試合）</li>)}</ol>
      </Card>

      <Card title="試合とスコア入力">
        <div className="space-y-3">
          {matches.map((m) => {
            const a = m.players.filter((p) => p.team === "A").map((p) => nameMap[p.participant_id]).join("/");
            const b = m.players.filter((p) => p.team === "B").map((p) => nameMap[p.participant_id]).join("/");
            return (
              <div key={m.id} className="rounded-xl bg-zinc-800 p-3">
                <p className="mb-2 text-sm">Court{m.court_number}: {a} vs {b}</p>
                <div className="flex items-center gap-2">
                  <input type="number" className="w-16 rounded bg-zinc-700 p-2" placeholder="A" onChange={(e) => setScoreInputs((prev) => ({ ...prev, [m.id]: { a: Number(e.target.value), b: prev[m.id]?.b ?? 0 } }))} />
                  <span>-</span>
                  <input type="number" className="w-16 rounded bg-zinc-700 p-2" placeholder="B" onChange={(e) => setScoreInputs((prev) => ({ ...prev, [m.id]: { a: prev[m.id]?.a ?? 0, b: Number(e.target.value) } }))} />
                  <button className="rounded bg-accent px-3 py-2 text-black" onClick={() => saveScore(m.id)} disabled={m.completed}>{m.completed ? "完了" : "保存"}</button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </main>
  );
}
