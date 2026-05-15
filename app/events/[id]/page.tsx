"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, ActionButton } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type Participant = { id: string; profile_id: string | null; guest_name: string | null; status: "active" | "resting" | "absent" };
type MatchView = { id: string; court_number: number; players: { participant_id: string; team: "A" | "B" }[]; completed: boolean; result?: { score_a: number; score_b: number; winner_team: "A" | "B" } | null };

export default function EventDetailPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [eventName, setEventName] = useState("-");
  const [courtCount, setCourtCount] = useState(1);
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState("");
  const [eventStatus, setEventStatus] = useState<"active" | "closed">("active");
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [scoreInputs, setScoreInputs] = useState<Record<string, { a: number; b: number }>>({});

  const nameMap = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p.guest_name ?? "ゲスト"])), [participants]);

  const profileMap = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p.profile_id])), [participants]);



  const eventSummary = useMemo(() => {
    const table: Record<string, { name: string; played: number; wins: number; losses: number; scored: number; conceded: number; winRate: number; diff: number }> = {};
    for (const p of participants) {
      table[p.id] = { name: p.guest_name ?? "ゲスト", played: 0, wins: 0, losses: 0, scored: 0, conceded: 0, winRate: 0, diff: 0 };
    }

    for (const m of matches) {
      if (!m.completed || !m.result) continue;
      const teamA = m.players.filter((x) => x.team === "A").map((x) => x.participant_id);
      const teamB = m.players.filter((x) => x.team === "B").map((x) => x.participant_id);

      for (const pid of teamA) {
        const row = table[pid];
        if (!row) continue;
        row.played += 1;
        row.scored += m.result.score_a;
        row.conceded += m.result.score_b;
        if (m.result.winner_team === "A") row.wins += 1;
        else row.losses += 1;
      }
      for (const pid of teamB) {
        const row = table[pid];
        if (!row) continue;
        row.played += 1;
        row.scored += m.result.score_b;
        row.conceded += m.result.score_a;
        if (m.result.winner_team === "B") row.wins += 1;
        else row.losses += 1;
      }
    }

    const rows = Object.values(table).map((r) => ({ ...r, winRate: r.played ? Math.round((r.wins / r.played) * 1000) / 10 : 0, diff: r.scored - r.conceded }));
    return {
      rows,
      winRateRanking: [...rows].sort((a, b) => b.winRate - a.winRate),
      diffRanking: [...rows].sort((a, b) => b.diff - a.diff),
      scoredRanking: [...rows].sort((a, b) => b.scored - a.scored)
    };
  }, [participants, matches]);

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

    const { data: event } = await supabase.from("events").select("name,court_count,status,club_id").eq("id", eventId).single();
    if (event?.name) setEventName(event.name);
    if (event?.court_count) setCourtCount(event.court_count);
    if (event?.status === "closed") setEventStatus("closed");
    else setEventStatus("active");



    // グループ定常メンバーをイベント参加者へ自動反映（未登録分のみ）
    if (event?.club_id) {
      const { data: members } = await supabase
        .from("club_members")
        .select("profile_id, profiles(display_name)")
        .eq("club_id", event.club_id);

      const { data: existingParticipants } = await supabase
        .from("event_participants")
        .select("profile_id")
        .eq("event_id", eventId)
        .not("profile_id", "is", null);

      const existingProfileIds = new Set((existingParticipants ?? []).map((x: any) => x.profile_id));
      const inserts = (members ?? [])
        .filter((m: any) => m.profile_id && !existingProfileIds.has(m.profile_id))
        .map((m: any) => ({
          event_id: eventId,
          profile_id: m.profile_id,
          guest_name: m.profiles?.display_name ?? null,
          status: "active",
          participant_type: "member"
        }));

      if (inserts.length > 0) {
        await supabase.from("event_participants").insert(inserts);
      }
    }

    const { data: pt } = await supabase
      .from("event_participants")
      .select("id,profile_id,guest_name,status")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    setParticipants((pt ?? []) as Participant[]);

    const { data: ms } = await supabase
      .from("matches")
      .select("id,court_number,completed,match_players(participant_id,team),match_results(score_a,score_b,winner_team)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(8);

    setMatches((ms ?? []).map((m: any) => ({ id: m.id, court_number: m.court_number, completed: m.completed, players: m.match_players ?? [], result: m.match_results?.[0] ?? null })));
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



  const closeEvent = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;
    await supabase
      .from("events")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", eventId);
    setShowCloseModal(false);
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
      <h1 className="text-xl font-bold">開催詳細：{eventName}</h1>
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
              <div className="mb-2 flex justify-between"><span>{p.guest_name ?? "ゲスト"}</span><span>{p.status === "active" ? "参加中" : p.status === "resting" ? "休み" : "帰宅"}</span></div>
              <div className="grid grid-cols-3 gap-1 text-sm">
                <button className="rounded bg-zinc-700 py-1" onClick={() => updateStatus(p.id, "active")}>参加中</button>
                <button className="rounded bg-zinc-700 py-1" onClick={() => updateStatus(p.id, "resting")}>休み</button>
                <button className="rounded bg-zinc-700 py-1" onClick={() => updateStatus(p.id, "absent")}>帰宅</button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {eventStatus === "closed" ? (
        <button className="w-full rounded-2xl bg-zinc-700 py-3 font-semibold text-zinc-300" disabled>次Round生成（終了済み）</button>
      ) : (
        <ActionButton onClick={generateRound}>次Round生成</ActionButton>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card title="勝率ランキング">
        <ol className="space-y-1 text-sm">{ranking.map((r, i) => <li key={r.name + i}>{i + 1}位 {r.name} {r.r}%（{r.m}試合）</li>)}</ol>
      </Card>

      <Card title="開催操作">
        <button className="w-full rounded-2xl border border-red-500 py-3 text-red-300" onClick={() => setShowCloseModal(true)} disabled={eventStatus === "closed"}>
          {eventStatus === "closed" ? "イベント終了済み" : "イベント終了"}
        </button>
        {eventStatus === "closed" && <p className="mt-2 text-sm text-zinc-300">この開催は終了しました</p>}
      </Card>



      {eventStatus === "closed" && (
        <Card title="開催サマリー">
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-zinc-800 p-3">
              <p className="mb-2 font-semibold">参加者成績（この開催）</p>
              <ul className="space-y-1">
                {eventSummary.rows.map((r) => (
                  <li key={r.name}>
                    {r.name} / 試合 {r.played} / 勝 {r.wins} / 敗 {r.losses} / 勝率 {r.winRate}% / 得点 {r.scored} / 失点 {r.conceded} / 得失点差 {r.diff}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl bg-zinc-800 p-3">
              <p className="mb-1 font-semibold">勝率ランキング</p>
              <ol className="space-y-1">{eventSummary.winRateRanking.map((r, i) => <li key={`wr-${r.name}-${i}`}>{i + 1}位 {r.name} {r.winRate}%</li>)}</ol>
            </div>
            <div className="rounded-xl bg-zinc-800 p-3">
              <p className="mb-1 font-semibold">得失点差ランキング</p>
              <ol className="space-y-1">{eventSummary.diffRanking.map((r, i) => <li key={`df-${r.name}-${i}`}>{i + 1}位 {r.name} {r.diff}</li>)}</ol>
            </div>
            <div className="rounded-xl bg-zinc-800 p-3">
              <p className="mb-1 font-semibold">得点ランキング</p>
              <ol className="space-y-1">{eventSummary.scoredRanking.map((r, i) => <li key={`sc-${r.name}-${i}`}>{i + 1}位 {r.name} {r.scored}</li>)}</ol>
            </div>
            <Link href="/home" className="block w-full rounded-2xl bg-accent py-3 text-center font-semibold text-black">TOPへ戻る</Link>
          </div>
        </Card>
      )}

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
                  <button className="rounded bg-accent px-3 py-2 text-black disabled:bg-zinc-600 disabled:text-zinc-300" onClick={() => saveScore(m.id)} disabled={m.completed || eventStatus === "closed"}>{m.completed ? "完了" : eventStatus === "closed" ? "終了済み" : "保存"}</button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>


      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-4">
            <h3 className="mb-2 text-lg font-bold">この開催を終了しますか？</h3>
            <p className="mb-4 text-sm text-zinc-300">終了後も開催履歴から確認できます。</p>
            <div className="flex gap-2">
              <button className="w-1/2 rounded-xl border border-zinc-600 py-3" onClick={() => setShowCloseModal(false)}>キャンセル</button>
              <button className="w-1/2 rounded-xl bg-red-500 py-3 font-semibold text-white" onClick={closeEvent}>終了する</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
