"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, ActionButton } from "@/components/ui";
import { getSupabaseClient } from "@/lib/supabase";

type Participant = { id: string; profile_id: string | null; player_profile_id: string | null; guest_name: string | null; status: "active" | "resting" | "absent"; participant_type?: "member" | "guest"; display_name?: string | null };
type MatchView = { id: string; court_number: number; round_number: number; created_at?: string; players: { participant_id: string; team: "A" | "B" }[]; completed: boolean; result?: { id?: string; score_a: number; score_b: number; winner_team: "A" | "B" } | null };
type HistoryMatch = { round_number: number; court_number: number; players: { participant_id: string; team: "A" | "B" }[] };
type ScoreInput = { a: number | ""; b: number | "" };

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
  const [scoreInputs, setScoreInputs] = useState<Record<string, ScoreInput>>({});
  const [showAllRounds, setShowAllRounds] = useState(false);
  const [editingMatchIds, setEditingMatchIds] = useState<Record<string, boolean>>({});

  const nameMap = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p.display_name ?? (p.participant_type === "guest" ? (p.guest_name ?? "ゲスト（名称未設定）") : "メンバー名未設定") ])), [participants]);

  const profileMap = useMemo(() => Object.fromEntries(participants.map((p) => [p.id, p.profile_id ?? p.player_profile_id])), [participants]);



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


  const activeParticipantsCount = useMemo(() => participants.filter((p) => p.status === "active").length, [participants]);
  const maxPlayableCourts = Math.floor(activeParticipantsCount / 4);
  const showCourtWarning = maxPlayableCourts < courtCount;

  const ranking = useMemo(() => {
    const stats: Record<string, { name: string; m: number; w: number }> = {};
    for (const p of participants) stats[p.id] = { name: p.display_name ?? (p.participant_type === "guest" ? (p.guest_name ?? "ゲスト（名称未設定）") : "メンバー名未設定"), m: 0, w: 0 };
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




  const latestRoundNumber = useMemo(() => matches.reduce((max, m) => Math.max(max, m.round_number), 0), [matches]);
  const sortedMatches = useMemo(() => [...matches].sort((a, b) => (b.round_number - a.round_number) || (a.court_number - b.court_number) || ((b.created_at ?? "").localeCompare(a.created_at ?? "")) || a.id.localeCompare(b.id)), [matches]);
  const displayedMatches = useMemo(() => (showAllRounds ? sortedMatches : sortedMatches.slice(0, 5)), [showAllRounds, sortedMatches]);

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
        .select("player_profile_id")
        .eq("club_id", event.club_id);

      const { data: existingParticipants } = await supabase
        .from("event_participants")
        .select("profile_id,player_profile_id")
        .eq("event_id", eventId);

      const existingProfileIds = new Set((existingParticipants ?? []).map((x: any) => x.player_profile_id ?? x.profile_id).filter(Boolean));
      const memberProfileIds = (members ?? []).map((m: any) => m.player_profile_id).filter(Boolean);
      const { data: memberProfiles } = memberProfileIds.length
        ? await supabase.from("player_profiles").select("id,display_name").in("id", memberProfileIds)
        : { data: [] as any[] };
      const memberNameMap = new Map((memberProfiles ?? []).map((mp: any) => [mp.id, mp.display_name]));

      const inserts = (members ?? [])
        .filter((m: any) => m.player_profile_id && !existingProfileIds.has(m.player_profile_id))
        .map((m: any) => ({
          event_id: eventId,
          player_profile_id: m.player_profile_id,
          guest_name: memberNameMap.get(m.player_profile_id) ?? null,
          status: "active",
          participant_type: "member"
        }));

      if (inserts.length > 0) {
        await supabase.from("event_participants").insert(inserts);
      }
    }

    const { data: pt } = await supabase
      .from("event_participants")
      .select("id,profile_id,player_profile_id,guest_name,status,participant_type")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true }).order("id", { ascending: true });
        const participantRows = (pt ?? []) as any[];
    const playerProfileIds = participantRows.map((r) => r.player_profile_id).filter(Boolean);
    const profileIds = participantRows.map((r) => r.profile_id).filter(Boolean);

    const { data: pps } = playerProfileIds.length
      ? await supabase.from("player_profiles").select("id,display_name").in("id", playerProfileIds)
      : { data: [] as any[] };
    const { data: ps } = profileIds.length
      ? await supabase.from("profiles").select("id,display_name").in("id", profileIds)
      : { data: [] as any[] };

    const playerProfileNameMap = new Map((pps ?? []).map((x: any) => [x.id, x.display_name]));
    const profileNameMap = new Map((ps ?? []).map((x: any) => [x.id, x.display_name]));

    setParticipants(
      participantRows.map((row) => {
        const resolvedName =
          (row.player_profile_id ? playerProfileNameMap.get(row.player_profile_id) : null) ??
          (row.profile_id ? profileNameMap.get(row.profile_id) : null) ??
          (row.participant_type === "guest" ? row.guest_name : null);

        return {
          id: row.id,
          profile_id: row.profile_id,
          player_profile_id: row.player_profile_id,
          guest_name: row.guest_name,
          status: row.status,
          participant_type: row.participant_type,
          display_name: resolvedName ?? null
        } as Participant;
      })
    );

    const { data: ms } = await supabase
      .from("matches")
      .select("id,court_number,created_at,completed,rounds(round_number),match_players(participant_id,team),match_results(id,score_a,score_b,winner_team)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });

    const normalizedMatches = (ms ?? []).map((m: any) => ({ id: m.id, court_number: m.court_number, created_at: m.created_at, round_number: m.rounds?.round_number ?? 0, completed: m.completed, players: m.match_players ?? [], result: m.match_results?.[0] ?? null }));
    setMatches(normalizedMatches);
    const savedScores = Object.fromEntries(normalizedMatches.filter((m: any) => m.result).map((m: any) => [m.id, { a: m.result.score_a, b: m.result.score_b }]));
    setScoreInputs((prev) => ({ ...savedScores, ...prev }));
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

  const updateStatus = async (participantId: string, isActive: boolean) => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    await supabase.from("event_participants").update({ status: isActive ? "active" : "resting" }).eq("id", participantId);
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
    if (score.a === "" || score.b === "") {
      setError("スコアを入力してください");
      return;
    }
    const winner = score.a > score.b ? "A" : "B";

    const targetMatch = matches.find((m) => m.id === matchId);
    if (targetMatch?.result?.id) {
      await supabase.from("match_results").update({ score_a: score.a, score_b: score.b, winner_team: winner }).eq("id", targetMatch.result.id);
    } else {
      await supabase.from("match_results").insert({ match_id: matchId, score_a: score.a, score_b: score.b, winner_team: winner });
    }
    await supabase.from("matches").update({ completed: true }).eq("id", matchId);
    setEditingMatchIds((prev) => ({ ...prev, [matchId]: false }));

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

  const pairKey = (a: string, b: string) => [a, b].sort().join("|");

  const generateRound = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !eventId) return;
    setError("");

    const active = participants.filter((p) => p.status === "active");
    if (active.length < 4) {
      setError("アクティブ参加者が4人未満のためRound生成できません");
      return;
    }

    const maxMatches = Math.min(courtCount, Math.floor(active.length / 4));
    if (maxMatches < 1) {
      setError("コート数に対して参加者が不足しています");
      return;
    }

    const slots = maxMatches * 4;
    const restNeeded = active.length - slots;

    const { data: roundsData } = await supabase
      .from("rounds")
      .select("id,round_number")
      .eq("event_id", eventId)
      .order("round_number", { ascending: true });
    const rounds = roundsData ?? [];
    const roundMap = new Map((rounds as any[]).map((r) => [r.id, r.round_number as number]));
    const lastRoundNumber = rounds.length ? Math.max(...(rounds as any[]).map((r) => r.round_number as number)) : 0;

    const { data: matchesData } = await supabase
      .from("matches")
      .select("id,round_id,court_number,match_players(participant_id,team)")
      .eq("event_id", eventId);
    const historyMatches: HistoryMatch[] = (matchesData ?? []).map((m: any) => ({
      round_number: roundMap.get(m.round_id) ?? 0,
      court_number: m.court_number,
      players: m.match_players ?? []
    }));

    const pairCounts = new Map<string, number>();
    const uniquePartners = new Map<string, Set<string>>();
    const restCounts = new Map<string, number>();
    const activeIds = new Set(active.map((p) => p.id));
    for (const p of active) {
      uniquePartners.set(p.id, new Set());
      restCounts.set(p.id, 0);
    }

    const roundPlayerMap = new Map<number, Set<string>>();
    for (const m of historyMatches) {
      if (!roundPlayerMap.has(m.round_number)) roundPlayerMap.set(m.round_number, new Set());
      const set = roundPlayerMap.get(m.round_number)!;
      const teamA = m.players.filter((x) => x.team === "A").map((x) => x.participant_id);
      const teamB = m.players.filter((x) => x.team === "B").map((x) => x.participant_id);
      for (const pid of [...teamA, ...teamB]) set.add(pid);
      if (teamA.length === 2) {
        const k = pairKey(teamA[0], teamA[1]);
        pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
        if (activeIds.has(teamA[0]) && activeIds.has(teamA[1])) {
          uniquePartners.get(teamA[0])?.add(teamA[1]);
          uniquePartners.get(teamA[1])?.add(teamA[0]);
        }
      }
      if (teamB.length === 2) {
        const k = pairKey(teamB[0], teamB[1]);
        pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
        if (activeIds.has(teamB[0]) && activeIds.has(teamB[1])) {
          uniquePartners.get(teamB[0])?.add(teamB[1]);
          uniquePartners.get(teamB[1])?.add(teamB[0]);
        }
      }
    }

    for (const [rn, playersInRound] of roundPlayerMap) {
      if (rn <= 0) continue;
      for (const p of active) {
        if (!playersInRound.has(p.id)) restCounts.set(p.id, (restCounts.get(p.id) ?? 0) + 1);
      }
    }

    const lastRoundPlayers = roundPlayerMap.get(lastRoundNumber) ?? new Set<string>();
    const lastRoundRest = new Set(active.filter((p) => !lastRoundPlayers.has(p.id)).map((p) => p.id));

    const chooseResters = (): string[] => {
      if (restNeeded <= 0) return [];
      const ids = active.map((p) => p.id);
      let best: { ids: string[]; score: number } | null = null;
      const tries = 600;
      for (let t = 0; t < tries; t++) {
        const shuffled = [...ids].sort(() => Math.random() - 0.5);
        const resters = shuffled.slice(0, restNeeded);
        const restSet = new Set(resters);
        let score = 0;
        for (const rid of resters) {
          if (lastRoundRest.has(rid)) score += 10000;
          score += (restCounts.get(rid) ?? 0) * 300;
        }
        for (const prevRest of lastRoundRest) {
          if (!restSet.has(prevRest)) score -= 300;
          else score += 5000;
        }
        score += Math.random() * 50;
        if (!best || score < best.score) best = { ids: resters, score };
      }
      return best?.ids ?? [];
    };

    const resters = chooseResters();
    const playPool = active.filter((p) => !resters.includes(p.id));

    const scorePair = (a: string, b: string): number => {
      const k = pairKey(a, b);
      const repeat = pairCounts.get(k) ?? 0;
      let s = 0;
      if (lastRoundNumber > 0) {
        for (const hm of historyMatches) {
          if (hm.round_number !== lastRoundNumber) continue;
          const ta = hm.players.filter((x) => x.team === "A").map((x) => x.participant_id);
          const tb = hm.players.filter((x) => x.team === "B").map((x) => x.participant_id);
          if ((ta.includes(a) && ta.includes(b)) || (tb.includes(a) && tb.includes(b))) s += 5000;
        }
      }
      const hasPartnered = uniquePartners.get(a)?.has(b) || uniquePartners.get(b)?.has(a);
      const possibleNewA = playPool.some((p) => p.id !== a && !(uniquePartners.get(a)?.has(p.id)));
      const possibleNewB = playPool.some((p) => p.id !== b && !(uniquePartners.get(b)?.has(p.id)));
      if (hasPartnered && (possibleNewA || possibleNewB)) s += 4000;
      if (hasPartnered) s += 800 * repeat;
      return s;
    };

    let bestMatches: { teamA: [string, string]; teamB: [string, string]; court: number }[] = [];
    let bestScore = Number.POSITIVE_INFINITY;
    for (let trial = 0; trial < 700; trial++) {
      const shuffled = [...playPool.map((p) => p.id)].sort(() => Math.random() - 0.5);
      const use = shuffled.slice(0, slots);
      const candidate: { teamA: [string, string]; teamB: [string, string]; court: number }[] = [];
      let score = 0;
      for (let c = 0; c < maxMatches; c++) {
        const group = use.slice(c * 4, c * 4 + 4);
        if (group.length < 4) break;
        const patterns: Array<[[string, string], [string, string]]> = [
          [[group[0], group[1]], [group[2], group[3]]],
          [[group[0], group[2]], [group[1], group[3]]],
          [[group[0], group[3]], [group[1], group[2]]]
        ];
        let bestLocal = patterns[0];
        let bestLocalScore = Number.POSITIVE_INFINITY;
        for (const ptn of patterns) {
          const ps = scorePair(ptn[0][0], ptn[0][1]) + scorePair(ptn[1][0], ptn[1][1]);
          if (ps < bestLocalScore) {
            bestLocalScore = ps;
            bestLocal = ptn;
          }
        }
        score += bestLocalScore;
        candidate.push({ teamA: bestLocal[0], teamB: bestLocal[1], court: c + 1 });
      }
      score += Math.random() * 50;
      if (score < bestScore) {
        bestScore = score;
        bestMatches = candidate;
      }
    }

    console.info("[Round生成]", {
      activeCount: active.length,
      configuredCourts: courtCount,
      generatedMatches: bestMatches.length,
      resters,
      score: bestScore,
      uniquePartnerCounts: Object.fromEntries(active.map((p) => [p.id, uniquePartners.get(p.id)?.size ?? 0]))
    });

    const roundNumber = lastRoundNumber + 1;
    const { data: round } = await supabase.from("rounds").insert({ event_id: eventId, round_number: roundNumber }).select("id").single();
    if (!round) return;

    for (const m of bestMatches) {
      const { data: match } = await supabase
        .from("matches")
        .insert({ event_id: eventId, round_id: round.id, court_number: m.court, completed: false })
        .select("id")
        .single();
      if (!match) continue;
      await supabase.from("match_players").insert([
        { match_id: match.id, participant_id: m.teamA[0], team: "A" },
        { match_id: match.id, participant_id: m.teamA[1], team: "A" },
        { match_id: match.id, participant_id: m.teamB[0], team: "B" },
        { match_id: match.id, participant_id: m.teamB[1], team: "B" }
      ]);
    }

    await loadAll();
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 pb-20">
      <h1 className="text-xl font-bold">開催詳細：{eventName}</h1>
      <Card title="試合とスコア入力">
        <div className={showAllRounds ? "max-h-[34rem] space-y-3 overflow-y-auto pr-1" : "space-y-3"}>
          {displayedMatches.map((m) => {
            const a = m.players.filter((p) => p.team === "A").map((p) => nameMap[p.participant_id]).join("/");
            const b = m.players.filter((p) => p.team === "B").map((p) => nameMap[p.participant_id]).join("/");
            return (
              <div key={m.id} className="rounded-xl bg-zinc-800 p-3">
                <p className="mb-2 text-sm">Round {m.round_number} / Court{m.court_number}: {a} vs {b}</p>
                <div className="flex items-center gap-2">
                  <input type="number" className="w-16 rounded bg-zinc-700 p-2" placeholder="A" value={scoreInputs[m.id]?.a ?? ""} disabled={m.completed && !editingMatchIds[m.id]} onChange={(e) => setScoreInputs((prev) => ({ ...prev, [m.id]: { a: e.target.value === "" ? "" : Number(e.target.value), b: prev[m.id]?.b ?? "" } }))} />
                  <span>-</span>
                  <input type="number" className="w-16 rounded bg-zinc-700 p-2" placeholder="B" value={scoreInputs[m.id]?.b ?? ""} disabled={m.completed && !editingMatchIds[m.id]} onChange={(e) => setScoreInputs((prev) => ({ ...prev, [m.id]: { a: prev[m.id]?.a ?? "", b: e.target.value === "" ? "" : Number(e.target.value) } }))} />
                  <button className="rounded bg-accent px-3 py-2 text-black disabled:bg-zinc-600 disabled:text-zinc-300" onClick={() => saveScore(m.id)} disabled={(m.completed && !editingMatchIds[m.id]) || eventStatus === "closed"}>{m.completed && !editingMatchIds[m.id] ? "完了" : eventStatus === "closed" ? "終了済み" : "保存"}</button>
                  {m.completed && eventStatus !== "closed" && (
                    <button className="rounded border border-zinc-500 px-2 py-2 text-xs" onClick={() => setEditingMatchIds((prev) => ({ ...prev, [m.id]: true }))}>編集</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <button className="w-full rounded-xl border border-zinc-600 py-2 text-sm" onClick={() => setShowAllRounds((v) => !v)}>
            {showAllRounds ? "閉じる" : "すべて表示"}
          </button>
        </div>
          {showAllRounds && <p className="mt-2 text-xs text-zinc-400">下にスクロールして全試合を確認できます</p>}

      </Card>


      

{eventStatus === "closed" ? (
        <button className="w-full rounded-2xl bg-zinc-700 py-3 font-semibold text-zinc-300" disabled>次Round生成（終了済み）</button>
      ) : (
        <ActionButton onClick={generateRound}>次Round生成</ActionButton>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {showCourtWarning && (
        <p className="text-xs text-amber-300">※ {courtCount}面設定ですが、現在の参加人数では{maxPlayableCourts}面まで生成可能です（1試合につき4人必要です）</p>
      )}

      

<Card title="参加者">
        <ul className="space-y-2">
          {participants.map((p) => (
            <li key={p.id} className="rounded-xl bg-zinc-800 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span>{p.display_name ?? (p.participant_type === "guest" ? (p.guest_name ?? "ゲスト（名称未設定）") : "メンバー名未設定")}</span>
                <button
                  type="button"
                  aria-label="参加状態切替"
                  onClick={() => updateStatus(p.id, p.status !== "active")}
                  className={`relative h-8 w-20 rounded-full px-1 transition ${p.status === "active" ? "bg-lime-500" : "bg-zinc-300"}`}
                >
                  <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition ${p.status === "active" ? "right-1" : "left-1"}`} />
                  <span className={`absolute inset-0 flex items-center justify-center text-xs font-semibold ${p.status === "active" ? "text-white" : "text-zinc-700"}`}>
                    {p.status === "active" ? "参加中" : "休み"}
                  </span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      

<Card title="参加者追加">
        <div className="flex gap-2">
          <input className="w-full rounded-xl bg-zinc-800 p-3" placeholder="ゲスト名" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
          <button className="min-w-16 whitespace-nowrap rounded-xl bg-accent px-4 py-2 text-black" onClick={addGuest}>追加</button>
        </div>
      </Card>
      

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
